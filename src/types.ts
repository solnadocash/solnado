/**
 * Type definitions for the private send flow
 */

import { PublicKey } from '@solana/web3.js';

/**
 * A shielded note represents a private balance in the pool.
 * This is the core data structure for privacy.
 */
export interface ShieldedNote {
  // Unique random value for this note
  rho: Uint8Array;
  
  // Blinding factor for the commitment
  r: Uint8Array;
  
  // Amount in lamports
  amount: bigint;
  
  // Owner's viewing key (derived from their wallet)
  ownerPubkey: Uint8Array;
  
  // Nullifier hash (for spending)
  nullifierHash?: Uint8Array;
  
  // Commitment (for Merkle tree)
  commitment: Uint8Array;
  
  // Index in the Merkle tree (assigned after deposit)
  leafIndex?: number;
}

/**
 * Encrypted note data that can be stored on-chain or transmitted
 */
export interface EncryptedNote {
  // Encrypted payload
  ciphertext: Uint8Array;
  
  // Ephemeral public key for decryption
  ephemeralPubkey: Uint8Array;
  
  // Nonce used for encryption
  nonce: Uint8Array;
  
  // Version for forward compatibility
  version: number;
}

/**
 * Private send intent - what the user submits
 */
export interface PrivateSendIntent {
  // Amount in SOL (will be converted to lamports)
  amountSol: number;
  
  // Receiver's normal Solana wallet address
  receiverAddress: string;
  
  // Sender's signature authorizing the send
  senderSignature: string;
  
  // Sender's public key
  senderPubkey: string;
  
  // Timestamp for expiry
  timestamp: number;
}

/**
 * Relayer request payload
 */
export interface RelayerRequest {
  // The private send intent
  intent: PrivateSendIntent;
  
  // Encrypted note for the receiver
  encryptedNote: EncryptedNote;
  
  // Deposit transaction (partially signed)
  depositTxBase64: string;
}

/**
 * Relayer response
 */
export interface RelayerResponse {
  success: boolean;
  transactionSignature?: string;
  error?: string;
  commitment?: string;
}

/**
 * Scanned note (decrypted by receiver)
 */
export interface ScannedNote {
  amount: bigint;
  commitment: string;
  leafIndex: number;
  timestamp: number;
  spent: boolean;
}

/**
 * Receiver's shielded balance state
 */
export interface ShieldedBalance {
  // Total available balance (unspent notes)
  availableBalance: bigint;
  
  // Pending notes (not yet confirmed)
  pendingBalance: bigint;
  
  // List of unspent notes
  notes: ScannedNote[];
  
  // Last scanned block
  lastScannedSlot: number;
}

/**
 * Withdrawal request (optional for receiver)
 */
export interface WithdrawalRequest {
  // Note to spend
  noteCommitment: string;
  
  // Amount to withdraw
  amount: bigint;
  
  // Recipient public address
  recipientAddress: string;
  
  // Zero-knowledge proof
  proof: Uint8Array;
}

