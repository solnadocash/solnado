/**
 * Hashing utilities for commitments and nullifiers
 */

import { createHash } from 'crypto';

/**
 * SHA-256 hash function
 */
export function sha256(data: Buffer | Uint8Array): Uint8Array {
  const hash = createHash('sha256');
  hash.update(data);
  return new Uint8Array(hash.digest());
}

/**
 * Poseidon hash placeholder
 * 
 * NOTE: PrivacyCash likely uses Poseidon hash for ZK-friendly operations.
 * This is a placeholder that should be replaced with the actual Poseidon
 * implementation from PrivacyCash SDK.
 */
export function poseidonHash(inputs: Uint8Array[]): Uint8Array {
  // Placeholder: concatenate and SHA-256
  // Real implementation would use ZK-friendly Poseidon hash
  const combined = Buffer.concat(inputs.map(i => Buffer.from(i)));
  return sha256(combined);
}

/**
 * Creates a commitment from note data
 * 
 * commitment = hash(amount, ownerPubkey, rho, r)
 */
export function createCommitment(
  amount: bigint,
  ownerPubkey: Uint8Array,
  rho: Uint8Array,
  r: Uint8Array
): Uint8Array {
  const amountBytes = Buffer.alloc(8);
  amountBytes.writeBigUInt64LE(amount);
  
  return poseidonHash([
    amountBytes,
    ownerPubkey,
    rho,
    r
  ]);
}

/**
 * Creates a nullifier from note data and spending key
 * 
 * nullifier = hash(spendingKey, rho, leafIndex)
 */
export function createNullifier(
  spendingKey: Uint8Array,
  rho: Uint8Array,
  leafIndex: number
): Uint8Array {
  const indexBytes = Buffer.alloc(4);
  indexBytes.writeUInt32LE(leafIndex);
  
  return poseidonHash([
    spendingKey,
    rho,
    indexBytes
  ]);
}

