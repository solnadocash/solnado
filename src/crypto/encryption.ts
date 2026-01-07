/**
 * Note encryption utilities
 * 
 * Notes are encrypted using NaCl box (X25519 + XSalsa20 + Poly1305).
 * This allows the sender to encrypt data that only the receiver can decrypt.
 */

import nacl from 'tweetnacl';
import { EncryptedNote, ShieldedNote } from '../types.js';
import { NOTE_ENCRYPTION_VERSION } from '../constants.js';

/**
 * Serializes a shielded note for encryption
 */
function serializeNote(note: ShieldedNote): Uint8Array {
  // Format: rho (32) + r (32) + amount (8) + ownerPubkey (32) = 104 bytes
  const buffer = new ArrayBuffer(104);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  
  bytes.set(note.rho, 0);
  bytes.set(note.r, 32);
  view.setBigUint64(64, note.amount, true); // little-endian
  bytes.set(note.ownerPubkey, 72);
  
  return bytes;
}

/**
 * Deserializes a shielded note from decrypted data
 */
function deserializeNote(data: Uint8Array, commitment: Uint8Array): ShieldedNote {
  if (data.length !== 104) {
    throw new Error('Invalid note data length');
  }
  
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  
  return {
    rho: data.slice(0, 32),
    r: data.slice(32, 64),
    amount: view.getBigUint64(64, true),
    ownerPubkey: data.slice(72, 104),
    commitment
  };
}

/**
 * Encrypts a shielded note for a receiver
 * 
 * @param note - The shielded note to encrypt
 * @param receiverViewingPubkey - The receiver's X25519 public key
 * @returns Encrypted note data
 */
export function encryptNote(
  note: ShieldedNote,
  receiverViewingPubkey: Uint8Array
): EncryptedNote {
  // Generate ephemeral keypair for this encryption
  const ephemeralKeypair = nacl.box.keyPair();
  
  // Generate random nonce
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  
  // Serialize the note
  const plaintext = serializeNote(note);
  
  // Encrypt using NaCl box
  const ciphertext = nacl.box(
    plaintext,
    nonce,
    receiverViewingPubkey,
    ephemeralKeypair.secretKey
  );
  
  return {
    ciphertext,
    ephemeralPubkey: ephemeralKeypair.publicKey,
    nonce,
    version: NOTE_ENCRYPTION_VERSION
  };
}

/**
 * Attempts to decrypt a note using the receiver's viewing key
 * 
 * @param encryptedNote - The encrypted note data
 * @param viewingSecretKey - The receiver's X25519 secret key
 * @param commitment - The note's commitment (from on-chain)
 * @returns The decrypted note, or null if decryption fails
 */
export function decryptNote(
  encryptedNote: EncryptedNote,
  viewingSecretKey: Uint8Array,
  commitment: Uint8Array
): ShieldedNote | null {
  try {
    // Decrypt using NaCl box.open
    const plaintext = nacl.box.open(
      encryptedNote.ciphertext,
      encryptedNote.nonce,
      encryptedNote.ephemeralPubkey,
      viewingSecretKey
    );
    
    if (!plaintext) {
      return null; // Decryption failed - not our note
    }
    
    // Deserialize the note
    return deserializeNote(plaintext, commitment);
  } catch {
    return null; // Any error means this note isn't for us
  }
}

/**
 * Serializes an encrypted note for transmission/storage
 */
export function serializeEncryptedNote(note: EncryptedNote): Uint8Array {
  // Format: version (1) + nonce (24) + ephemeralPubkey (32) + ciphertext (variable)
  const buffer = new Uint8Array(1 + 24 + 32 + note.ciphertext.length);
  
  buffer[0] = note.version;
  buffer.set(note.nonce, 1);
  buffer.set(note.ephemeralPubkey, 25);
  buffer.set(note.ciphertext, 57);
  
  return buffer;
}

/**
 * Deserializes an encrypted note from bytes
 */
export function deserializeEncryptedNote(data: Uint8Array): EncryptedNote {
  if (data.length < 58) {
    throw new Error('Invalid encrypted note data');
  }
  
  return {
    version: data[0],
    nonce: data.slice(1, 25),
    ephemeralPubkey: data.slice(25, 57),
    ciphertext: data.slice(57)
  };
}

