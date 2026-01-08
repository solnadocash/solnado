/**
 * Solnado Server
 * Private SOL transfers using PrivacyCash shielded pool
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

// @ts-ignore - privacycash types
import { PrivacyCash } from 'privacycash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=da8de8e3-afd3-457e-9820-a62102ca3c9b';

// Relayer wallet - this funds the pool operations
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
let relayerKeypair: Keypair | null = null;
let privacyCash: any = null;

if (RELAYER_KEY) {
  try {
    relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_KEY));
    console.log(`Relayer: ${relayerKeypair.publicKey.toBase58()}`);
    
    // Initialize PrivacyCash with relayer's key
    privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(relayerKeypair.secretKey),
      enableDebug: true
    });
    console.log('PrivacyCash SDK initialized');
  } catch (e) {
    console.error('Failed to initialize:', e);
  }
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Session storage
const sessions = new Map<string, {
  senderAddress: string;
  recipientAddress: string;
  amountLamports: number;
  step: string;
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

/**
 * POST /api/prepare-deposit
 * Step 1: User sends SOL to relayer, who will deposit to shielded pool
 */
app.post('/api/prepare-deposit', async (req, res) => {
  const { senderAddress, recipientAddress, amountSol } = req.body;

  if (!senderAddress || !recipientAddress || !amountSol) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!relayerKeypair || !privacyCash) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const sender = new PublicKey(senderAddress);

    // User sends to relayer (who will then deposit to shielded pool)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: relayerKeypair.publicKey,
        lamports: amountLamports
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;

    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64Tx = Buffer.from(serialized).toString('base64');

    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(sessionId, {
      senderAddress,
      recipientAddress,
      amountLamports,
      step: 'pending'
    });

    setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000);

    console.log(`[${sessionId}] Prepared: ${amountSol} SOL to ${recipientAddress}`);
    res.json({ sessionId, unsignedTx: base64Tx });

  } catch (err: any) {
    console.error('Prepare error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/submit-deposit
 * Step 2: After user signs, submit their tx, then do pool deposit + withdraw
 */
app.post('/api/submit-deposit', async (req, res) => {
  const { signedTx, sessionId } = req.body;
  const session = sessions.get(sessionId);

  if (!session) {
    return res.status(400).json({ error: 'Session expired' });
  }

  if (!relayerKeypair || !privacyCash) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const txBuffer = Buffer.from(signedTx, 'base64');

    // Step 1: Submit user's deposit to relayer
    session.step = 'depositing';
    console.log(`[${sessionId}] Submitting user deposit...`);
    
    const userDepositTx = await connection.sendRawTransaction(txBuffer);
    await connection.confirmTransaction(userDepositTx, 'confirmed');
    session.depositTx = userDepositTx;
    console.log(`[${sessionId}] User deposit confirmed: ${userDepositTx}`);

    // Step 2: Deposit to PrivacyCash shielded pool
    session.step = 'shielding';
    console.log(`[${sessionId}] Depositing to shielded pool...`);
    
    const depositResult = await privacyCash.deposit({
      lamports: session.amountLamports
    });
    console.log(`[${sessionId}] Pool deposit TX: ${depositResult?.tx || 'done'}`);

    // Wait for pool state to update
    await new Promise(r => setTimeout(r, 5000));

    // Step 3: Withdraw from pool to recipient
    session.step = 'withdrawing';
    console.log(`[${sessionId}] Withdrawing to recipient...`);
    
    const fee = 5_000_000; // 0.005 SOL relayer fee
    const withdrawAmount = session.amountLamports - fee;

    const withdrawResult = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: session.recipientAddress
    });
    
    session.withdrawTx = withdrawResult?.tx || 'confirmed';
    session.step = 'complete';
    console.log(`[${sessionId}] Withdraw TX: ${session.withdrawTx}`);

    res.json({ 
      success: true, 
      depositTx: depositResult?.tx || userDepositTx,
      withdrawTx: session.withdrawTx 
    });

  } catch (err: any) {
    console.error(`[${sessionId}] Error:`, err);
    session.step = 'failed';
    session.error = err.message;
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/status/:sessionId
 */
app.get('/api/status/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Not found' });
  res.json(session);
});

/**
 * GET /api/balance/:address
 */
app.get('/api/balance/:address', async (req, res) => {
  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const balance = await connection.getBalance(new PublicKey(req.params.address));
    res.json({ balance: balance / LAMPORTS_PER_SOL });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/private-balance
 * Get relayer's shielded pool balance
 */
app.get('/api/private-balance', async (req, res) => {
  try {
    if (!privacyCash) {
      return res.json({ balance: 0 });
    }
    const balance = await privacyCash.getPrivateBalance();
    res.json({ balance: (balance || 0) / LAMPORTS_PER_SOL });
  } catch (err: any) {
    res.json({ balance: 0 });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Solnado Server running on port ${PORT}`);
  console.log(`Relayer: ${relayerKeypair?.publicKey.toBase58() || 'NOT SET'}`);
  console.log(`PrivacyCash: ${privacyCash ? 'READY' : 'NOT INITIALIZED'}`);
});
