/**
 * Receiver Scanner
 * 
 * The scanner continuously monitors the PrivacyCash shielded pool for
 * incoming notes. When a new commitment is detected, it attempts to
 * decrypt it using the receiver's viewing key.
 * 
 * If decryption succeeds, the note belongs to us and we update our
 * shielded balance. The receiver does NOT need to click "withdraw"
 * to receive funds - the balance updates automatically.
 * 
 * Withdrawing is OPTIONAL and only needed when converting shielded
 * SOL back to public SOL.
 */

import {
  Connection,
  PublicKey,
  Keypair,
} from '@solana/web3.js';
import bs58 from 'bs58';

import {
  PRIVACY_CASH_PROGRAM_ID,
  MAINNET_RPC_URL,
} from '../constants.js';
import {
  ShieldedNote,
  ScannedNote,
  ShieldedBalance,
} from '../types.js';
import { deriveViewingKeypair } from '../crypto/keys.js';
import { decryptNote, deserializeEncryptedNote } from '../crypto/encryption.js';

/**
 * Scanner configuration
 */
export interface ScannerConfig {
  /** RPC URL */
  rpcUrl?: string;
  
  /** Program ID */
  programId?: PublicKey;
  
  /** Polling interval in ms */
  pollInterval?: number;
  
  /** Start from this slot (default: scan last 24 hours) */
  startSlot?: number;
}

/**
 * Event types emitted by the scanner
 */
export type ScannerEvent = 
  | { type: 'new_note'; note: ScannedNote }
  | { type: 'balance_updated'; balance: ShieldedBalance }
  | { type: 'error'; error: Error };

/**
 * Event listener type
 */
export type ScannerEventListener = (event: ScannerEvent) => void;

/**
 * Receiver Scanner
 * 
 * Usage:
 * ```typescript
 * const scanner = new ReceiverScanner(walletKeypair);
 * scanner.on((event) => {
 *   if (event.type === 'new_note') {
 *     console.log(`Received ${event.note.amount} lamports!`);
 *   }
 * });
 * scanner.start();
 * ```
 */
export class ReceiverScanner {
  private connection: Connection;
  private programId: PublicKey;
  private pollInterval: number;
  private walletKeypair: Keypair;
  private viewingKeypair: ReturnType<typeof deriveViewingKeypair>;
  
  private isRunning = false;
  private lastScannedSlot = 0;
  private notes: Map<string, ScannedNote> = new Map();
  private listeners: ScannerEventListener[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  
  constructor(walletKeypair: Keypair, config: ScannerConfig = {}) {
    this.connection = new Connection(config.rpcUrl || MAINNET_RPC_URL);
    this.programId = config.programId || PRIVACY_CASH_PROGRAM_ID;
    this.pollInterval = config.pollInterval || 5000; // 5 seconds
    this.walletKeypair = walletKeypair;
    this.lastScannedSlot = config.startSlot || 0;
    
    // Derive viewing keypair from wallet
    this.viewingKeypair = deriveViewingKeypair(walletKeypair);
  }
  
  /**
   * Register an event listener
   */
  on(listener: ScannerEventListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  /**
   * Emit an event to all listeners
   */
  private emit(event: ScannerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Listener error:', error);
      }
    }
  }
  
  /**
   * Start scanning for incoming notes
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🔍 Scanner started');
    console.log(`   Watching for notes to: ${this.walletKeypair.publicKey.toBase58()}`);
    
    // Initial scan
    await this.scan();
    
    // Start polling
    this.pollTimer = setInterval(() => {
      this.scan().catch(error => {
        this.emit({ type: 'error', error });
      });
    }, this.pollInterval);
  }
  
  /**
   * Stop scanning
   */
  stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('🛑 Scanner stopped');
  }
  
  /**
   * Perform a scan for new commitments
   */
  private async scan(): Promise<void> {
    try {
      // Get current slot
      const currentSlot = await this.connection.getSlot();
      
      // If no start slot, start from ~24 hours ago
      if (this.lastScannedSlot === 0) {
        // Roughly 2 slots/second = ~172800 slots/day
        this.lastScannedSlot = Math.max(0, currentSlot - 172800);
      }
      
      // Fetch program accounts (commitment accounts)
      // NOTE: In real implementation, you would query specific account types
      const commitmentAccounts = await this.fetchNewCommitments(
        this.lastScannedSlot,
        currentSlot
      );
      
      // Try to decrypt each commitment
      for (const account of commitmentAccounts) {
        await this.tryDecryptCommitment(account);
      }
      
      // Update last scanned slot
      this.lastScannedSlot = currentSlot;
      
    } catch (error) {
      console.error('Scan error:', error);
      this.emit({ type: 'error', error: error as Error });
    }
  }
  
  /**
   * Fetches new commitment accounts from the program
   */
  private async fetchNewCommitments(
    _fromSlot: number,
    _toSlot: number
  ): Promise<CommitmentAccountData[]> {
    // NOTE: This is a simplified implementation.
    // The real PrivacyCash SDK would provide proper account fetching.
    
    try {
      // Get all commitment accounts for the program
      const accounts = await this.connection.getProgramAccounts(this.programId, {
        filters: [
          // Filter for commitment accounts (by size or discriminator)
          { dataSize: 200 }, // Approximate size of commitment account
        ],
      });
      
      return accounts.map(({ pubkey, account }) => ({
        pubkey,
        data: account.data,
        slot: 0, // Would be available from transaction history
      }));
      
    } catch (error) {
      console.error('Failed to fetch commitments:', error);
      return [];
    }
  }
  
  /**
   * Attempts to decrypt a commitment account
   */
  private async tryDecryptCommitment(account: CommitmentAccountData): Promise<void> {
    const commitmentKey = account.pubkey.toBase58();
    
    // Skip if already processed
    if (this.notes.has(commitmentKey)) {
      return;
    }
    
    try {
      // Parse the account data
      // Format depends on PrivacyCash account structure
      // Typically: commitment (32) + encrypted_note (variable) + leaf_index (4)
      
      const data = account.data;
      if (data.length < 90) return; // Minimum expected size
      
      const commitment = data.slice(0, 32);
      const encryptedNoteData = data.slice(32, -4);
      const leafIndex = data.readUInt32LE(data.length - 4);
      
      // Deserialize the encrypted note
      const encryptedNote = deserializeEncryptedNote(encryptedNoteData);
      
      // Try to decrypt
      const note = decryptNote(
        encryptedNote,
        this.viewingKeypair.secretKey,
        commitment
      );
      
      if (note) {
        // Success! This note belongs to us
        const scannedNote: ScannedNote = {
          amount: note.amount,
          commitment: bs58.encode(commitment),
          leafIndex,
          timestamp: Date.now(),
          spent: false,
        };
        
        // Store the note
        this.notes.set(commitmentKey, scannedNote);
        
        // Emit event
        console.log(`💰 New note received: ${Number(note.amount) / 1e9} SOL`);
        this.emit({ type: 'new_note', note: scannedNote });
        this.emit({ type: 'balance_updated', balance: this.getBalance() });
      }
      
    } catch {
      // Decryption failed - not our note, ignore
    }
  }
  
  /**
   * Get current shielded balance
   */
  getBalance(): ShieldedBalance {
    let availableBalance = 0n;
    const unspentNotes: ScannedNote[] = [];
    
    for (const note of this.notes.values()) {
      if (!note.spent) {
        availableBalance += note.amount;
        unspentNotes.push(note);
      }
    }
    
    return {
      availableBalance,
      pendingBalance: 0n, // Would track unconfirmed notes
      notes: unspentNotes,
      lastScannedSlot: this.lastScannedSlot,
    };
  }
  
  /**
   * Get a specific note by commitment
   */
  getNote(commitment: string): ScannedNote | undefined {
    for (const note of this.notes.values()) {
      if (note.commitment === commitment) {
        return note;
      }
    }
    return undefined;
  }
  
  /**
   * Mark a note as spent (after withdrawal)
   */
  markSpent(commitment: string): void {
    for (const [key, note] of this.notes.entries()) {
      if (note.commitment === commitment) {
        this.notes.set(key, { ...note, spent: true });
        this.emit({ type: 'balance_updated', balance: this.getBalance() });
        return;
      }
    }
  }
}

/**
 * Internal type for commitment account data
 */
interface CommitmentAccountData {
  pubkey: PublicKey;
  data: Buffer;
  slot: number;
}

/**
 * Convenience function to create and start a scanner
 */
export function startScanner(
  walletKeypair: Keypair,
  config?: ScannerConfig
): ReceiverScanner {
  const scanner = new ReceiverScanner(walletKeypair, config);
  scanner.start();
  return scanner;
}

