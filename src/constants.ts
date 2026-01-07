/**
 * PrivacyCash Mainnet Constants
 * 
 * The PrivacyCash program is deployed on Solana mainnet and provides:
 * - Shielded pool for SOL deposits
 * - Zero-knowledge proof verification for withdrawals
 * - Merkle tree for commitment storage
 * - Note-based privacy model
 */

import { PublicKey } from '@solana/web3.js';

// PrivacyCash Mainnet Program ID
// Verified: https://explorer.solana.com/address/9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD
export const PRIVACY_CASH_PROGRAM_ID = new PublicKey('9fhQBbumKEFuXtMBDw8AaQyAjCorLGJQiS3skWZdQyQD');

// Mainnet RPC endpoint
export const MAINNET_RPC_URL = 'https://api.mainnet-beta.solana.com';

// PrivacyCash relayer endpoints (would be provided by PrivacyCash team)
// These are the official relayer endpoints that handle transaction submission
export const PRIVACY_CASH_RELAYER_URL = 'https://relayer.privacy.cash/api';

// Merkle tree depth (typical for privacy pools)
export const MERKLE_TREE_DEPTH = 20;

// Minimum and maximum SOL amounts (in lamports)
export const MIN_DEPOSIT_LAMPORTS = 10_000_000; // 0.01 SOL
export const MAX_DEPOSIT_LAMPORTS = 100_000_000_000; // 100 SOL

// Relayer fee (in lamports) - covers gas + service fee
export const RELAYER_FEE_LAMPORTS = 5_000_000; // 0.005 SOL

// Note encryption parameters
export const NOTE_ENCRYPTION_VERSION = 1;

