/**
 * Solnado Private Send Server
 * 
 * Flow:
 * 1. User signs deposit to pool address
 * 2. Server receives funds and does PrivacyCash deposit+withdraw
 * 3. Recipient gets funds with no on-chain link to sender
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

// @ts-ignore
import { PrivacyCash } from 'privacycash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=da8de8e3-afd3-457e-9820-a62102ca3c9b';

// Relayer wallet - receives user deposits, does PrivacyCash flow
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
let relayerKeypair: Keypair | null = null;

if (RELAYER_KEY) {
  try {
    relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_KEY));
    console.log(`Relayer: ${relayerKeypair.publicKey.toBase58()}`);
  } catch (e) {
    console.error('Invalid RELAYER_PRIVATE_KEY');
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
  step: 'pending' | 'depositing' | 'withdrawing' | 'complete' | 'failed';
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

/**
 * POST /api/prepare-deposit
 * Build unsigned transaction for user to sign
 */
app.post('/api/prepare-deposit', async (req, res) => {
  const { senderAddress, recipientAddress, amountSol } = req.body;

  if (!senderAddress || !recipientAddress || !amountSol) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  try {
    new PublicKey(recipientAddress);
  } catch {
    return res.status(400).json({ error: 'Invalid recipient' });
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (amountLamports < 10_000_000) {
    return res.status(400).json({ error: 'Minimum 0.01 SOL' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const sender = new PublicKey(senderAddress);

    // User sends to relayer pool address
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

    // Create session
    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessions.set(sessionId, {
      senderAddress,
      recipientAddress,
      amountLamports,
      step: 'pending'
    });

    // Clean up after 10 min
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
 * Submit signed transaction and start privacy flow
 */
app.post('/api/submit-deposit', async (req, res) => {
  const { signedTx, sessionId } = req.body;

  if (!signedTx || !sessionId) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const session = sessions.get(sessionId);
  if (!session) {
    return res.status(400).json({ error: 'Session expired' });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const txBuffer = Buffer.from(signedTx, 'base64');

    // Submit user's deposit to relayer
    session.step = 'depositing';
    console.log(`[${sessionId}] Submitting user deposit...`);

    const depositTx = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });

    await connection.confirmTransaction(depositTx, 'confirmed');
    session.depositTx = depositTx;
    console.log(`[${sessionId}] User deposit confirmed: ${depositTx}`);

    // Start async privacy flow
    processPrivacyFlow(sessionId, session, relayerKeypair);

    res.json({ success: true, depositTx });

  } catch (err: any) {
    console.error(`[${sessionId}] Submit error:`, err);
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
  if (!session) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json({
    step: session.step,
    depositTx: session.depositTx,
    withdrawTx: session.withdrawTx,
    error: session.error
  });
});

/**
 * Process the PrivacyCash deposit+withdraw flow
 */
async function processPrivacyFlow(
  sessionId: string,
  session: typeof sessions extends Map<string, infer V> ? V : never,
  relayer: Keypair
) {
  try {
    console.log(`[${sessionId}] Starting PrivacyCash flow...`);
    session.step = 'withdrawing';

    // Initialize PrivacyCash with relayer's key
    const privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(relayer.secretKey),
      enableDebug: false
    });

    // Relayer deposits to pool
    console.log(`[${sessionId}] Relayer depositing to pool...`);
    const depositResult = await privacyCash.deposit({
      lamports: session.amountLamports
    });
    console.log(`[${sessionId}] Pool deposit: ${depositResult?.tx}`);

    // Wait for pool state
    await new Promise(r => setTimeout(r, 5000));

    // Withdraw to recipient with ZK proof
    console.log(`[${sessionId}] Withdrawing to ${session.recipientAddress}...`);
    const relayerFee = 2_000_000; // 0.002 SOL
    const withdrawAmount = session.amountLamports - relayerFee;

    const withdrawResult = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: session.recipientAddress
    });

    session.withdrawTx = withdrawResult?.tx;
    session.step = 'complete';
    console.log(`[${sessionId}] Complete! Withdraw: ${withdrawResult?.tx}`);

  } catch (err: any) {
    console.error(`[${sessionId}] Privacy flow error:`, err);
    session.step = 'failed';
    session.error = err.message;
  }
}

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`
  Solnado Server
  --------------
  Port: ${PORT}
  RPC:  ${RPC_URL.slice(0, 50)}...
  Relayer: ${relayerKeypair?.publicKey.toBase58() || 'NOT CONFIGURED'}
  
  Set RELAYER_PRIVATE_KEY env var for private transfers.
  `);
});
