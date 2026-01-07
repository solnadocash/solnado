/**
 * Solana Private Send
 * 
 * A privacy-preserving SOL transfer solution using the PrivacyCash
 * shielded pool on Solana mainnet.
 * 
 * Features:
 * - One-click private sends (no deposit/withdraw UX)
 * - Automatic shielding behind the scenes
 * - Receiver gets shielded balance automatically (no action needed)
 * - Gas abstraction via relayer
 * - Full sender ↔ receiver unlinkability
 * 
 * @example
 * ```typescript
 * import { PrivateSendClient, ReceiverScanner } from 'solana-private-send';
 * 
 * // Sender: Send SOL privately
 * const client = new PrivateSendClient();
 * const result = await client.send(senderKeypair, 1.5, receiverAddress);
 * 
 * // Receiver: Automatically receive shielded balance
 * const scanner = new ReceiverScanner(receiverKeypair);
 * scanner.on((event) => {
 *   if (event.type === 'new_note') {
 *     console.log(`Received ${event.note.amount} lamports!`);
 *   }
 * });
 * scanner.start();
 * ```
 */

// Re-export all public APIs
export * from './types.js';
export * from './constants.js';
export * from './client/index.js';
export * from './scanner/index.js';
export * from './crypto/index.js';

// UI components are exported separately (require React)
// import { PrivateSendForm, ShieldedBalanceDisplay } from 'solana-private-send/ui';

