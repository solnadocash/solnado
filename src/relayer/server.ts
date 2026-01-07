/**
 * Relayer Service
 * 
 * The relayer is a critical component that:
 * 1. Accepts signed transaction intents from senders
 * 2. Pays the gas fees on behalf of users
 * 3. Submits transactions to the PrivacyCash program
 * 4. Ensures transaction privacy is maintained
 * 
 * The relayer sees the encrypted note but CANNOT decrypt it.
 * Only the receiver can decrypt their incoming notes.
 */

import express, { Request, Response } from 'express';
import {
  Connection,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  PublicKey,
} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';

import {
  MAINNET_RPC_URL,
  PRIVACY_CASH_PROGRAM_ID,
  RELAYER_FEE_LAMPORTS,
} from '../constants.js';
import {
  RelayerRequest,
  RelayerResponse,
  PrivateSendIntent,
} from '../types.js';

const app = express();
app.use(express.json({ limit: '1mb' }));

// Configuration
const PORT = process.env.RELAYER_PORT || 3001;
const connection = new Connection(MAINNET_RPC_URL);

// Relayer keypair (funded account for paying gas)
// In production, this would be loaded from secure storage
let relayerKeypair: Keypair;

if (process.env.RELAYER_PRIVATE_KEY) {
  relayerKeypair = Keypair.fromSecretKey(
    bs58.decode(process.env.RELAYER_PRIVATE_KEY)
  );
} else {
  // Development: generate a new keypair (won't work on mainnet without funding)
  relayerKeypair = Keypair.generate();
  console.warn('⚠️  Using generated relayer keypair. Fund this address for mainnet:');
  console.warn(`   ${relayerKeypair.publicKey.toBase58()}`);
}

/**
 * Validates the sender's signature on the intent
 */
function validateIntent(intent: PrivateSendIntent): boolean {
  try {
    const message = Buffer.from(
      JSON.stringify({
        action: 'private_send',
        amount: intent.amountSol,
        receiver: intent.receiverAddress,
        timestamp: intent.timestamp,
      })
    );
    
    const signature = bs58.decode(intent.senderSignature);
    const publicKey = bs58.decode(intent.senderPubkey);
    
    // Verify the signature
    return nacl.sign.detached.verify(message, signature, publicKey);
  } catch {
    return false;
  }
}

/**
 * Validates the intent hasn't expired
 */
function validateTimestamp(timestamp: number): boolean {
  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutes
  return timestamp > now - maxAge && timestamp < now + 60 * 1000;
}

/**
 * Main submission endpoint
 */
app.post('/api/submit', async (req: Request, res: Response) => {
  try {
    const request = req.body as RelayerRequest;
    
    // 1. Validate the intent signature
    if (!validateIntent(request.intent)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid sender signature',
      } as RelayerResponse);
    }
    
    // 2. Validate timestamp
    if (!validateTimestamp(request.intent.timestamp)) {
      return res.status(400).json({
        success: false,
        error: 'Intent expired or invalid timestamp',
      } as RelayerResponse);
    }
    
    // 3. Deserialize the transaction
    const transactionBuffer = Buffer.from(request.depositTxBase64, 'base64');
    const transaction = Transaction.from(transactionBuffer);
    
    // 4. Verify the transaction hasn't been tampered with
    // (Check it matches the intent)
    const senderPubkey = new PublicKey(request.intent.senderPubkey);
    if (!transaction.signatures.some(s => s.publicKey.equals(senderPubkey))) {
      return res.status(400).json({
        success: false,
        error: 'Transaction not signed by sender',
      } as RelayerResponse);
    }
    
    // 5. Add relayer signature and submit
    // NOTE: In a real implementation, the relayer would:
    // - Verify the deposit amount matches the intent
    // - Check its balance is sufficient for gas
    // - Add its signature to finalize the transaction
    
    // For now, we sign and submit
    transaction.partialSign(relayerKeypair);
    
    try {
      const signature = await sendAndConfirmTransaction(
        connection,
        transaction,
        [relayerKeypair],
        { commitment: 'confirmed' }
      );
      
      console.log(`✓ Transaction submitted: ${signature}`);
      
      return res.json({
        success: true,
        transactionSignature: signature,
      } as RelayerResponse);
      
    } catch (txError) {
      console.error('Transaction failed:', txError);
      return res.status(500).json({
        success: false,
        error: 'Transaction submission failed',
      } as RelayerResponse);
    }
    
  } catch (error) {
    console.error('Request processing error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    } as RelayerResponse);
  }
});

/**
 * Health check endpoint
 */
app.get('/api/health', async (_req: Request, res: Response) => {
  const balance = await connection.getBalance(relayerKeypair.publicKey);
  
  res.json({
    status: 'healthy',
    relayerAddress: relayerKeypair.publicKey.toBase58(),
    balanceLamports: balance,
    feePerTransaction: RELAYER_FEE_LAMPORTS,
  });
});

/**
 * Get fee information
 */
app.get('/api/fee', (_req: Request, res: Response) => {
  res.json({
    feeLamports: RELAYER_FEE_LAMPORTS,
    feeSol: RELAYER_FEE_LAMPORTS / 1e9,
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🔐 Privacy Relayer running on port ${PORT}`);
  console.log(`   Relayer address: ${relayerKeypair.publicKey.toBase58()}`);
});

export { app };

