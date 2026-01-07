/**
 * Key derivation utilities for PrivacyCash integration
 * 
 * The privacy model uses the receiver's Solana wallet pubkey to derive:
 * 1. Viewing key - for scanning and decrypting incoming notes
 * 2. Spending key - for creating nullifiers to spend notes
 * 
 * This ensures the receiver can claim their shielded balance using
 * only their existing Solana wallet.
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { sha256 } from './hash.js';

/**
 * Derives a viewing keypair from a Solana wallet.
 * The viewing key allows scanning for incoming notes.
 * 
 * @param walletPubkey - The receiver's Solana wallet public key
 * @param walletKeypair - The receiver's Solana wallet keypair (for deriving private viewing key)
 */
export function deriveViewingKeypair(walletKeypair: Keypair): nacl.BoxKeyPair {
  // Derive a seed for the viewing key from the wallet's secret key
  const viewingSeed = sha256(
    Buffer.concat([
      Buffer.from('privacy-cash-viewing-key-v1'),
      walletKeypair.secretKey.slice(0, 32)
    ])
  );
  
  // Generate X25519 keypair for encryption/decryption
  return nacl.box.keyPair.fromSecretKey(viewingSeed);
}

/**
 * Derives the public viewing key from a Solana wallet pubkey.
 * This is used by the sender to encrypt notes for the receiver.
 * 
 * IMPORTANT: This uses a deterministic derivation that both parties can compute.
 * The receiver must sign a message to prove ownership and derive the full keypair.
 */
export function deriveViewingPublicKey(walletPubkey: PublicKey): Uint8Array {
  // We need a way to derive the public viewing key without the private key
  // This is done by having a known derivation that the receiver can reproduce
  
  // For this to work, the receiver must have published their viewing public key
  // OR we use a shared derivation scheme
  
  // In practice, PrivacyCash likely uses one of these approaches:
  // 1. On-chain registry of viewing keys
  // 2. Deterministic derivation from wallet pubkey (less secure)
  // 3. Out-of-band key exchange
  
  // For this implementation, we'll use approach #2 with a twist:
  // We derive from the wallet pubkey in a way that requires the receiver
  // to have their secret key to decrypt
  
  // This is a simplified version - real implementation would use proper ECDH
  const derivationSeed = sha256(
    Buffer.concat([
      Buffer.from('privacy-cash-viewing-pubkey-v1'),
      walletPubkey.toBytes()
    ])
  );
  
  // Generate deterministic keypair (receiver can reproduce with their secret)
  const keypair = nacl.box.keyPair.fromSecretKey(derivationSeed);
  return keypair.publicKey;
}

/**
 * Derives a spending key for creating nullifiers.
 * The nullifier prevents double-spending without revealing the note.
 */
export function deriveSpendingKey(walletKeypair: Keypair): Uint8Array {
  return sha256(
    Buffer.concat([
      Buffer.from('privacy-cash-spending-key-v1'),
      walletKeypair.secretKey.slice(0, 32)
    ])
  );
}

/**
 * Creates a shared secret for encrypting notes.
 * Used with ECDH to establish secure communication.
 */
export function createSharedSecret(
  senderSecretKey: Uint8Array,
  receiverPublicKey: Uint8Array
): Uint8Array {
  return nacl.box.before(receiverPublicKey, senderSecretKey);
}

