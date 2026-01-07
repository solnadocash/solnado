/**
 * Solnado Server
 * Simple SOL transfer server - privacy features coming soon
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=da8de8e3-afd3-457e-9820-a62102ca3c9b';

// Relayer wallet
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
  step: string;
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

/**
 * POST /api/prepare-deposit
 */
app.post('/api/prepare-deposit', async (req, res) => {
  const { senderAddress, recipientAddress, amountSol } = req.body;

  if (!senderAddress || !recipientAddress || !amountSol) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const sender = new PublicKey(senderAddress);

    // User sends to relayer
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/submit-deposit
 */
app.post('/api/submit-deposit', async (req, res) => {
  const { signedTx, sessionId } = req.body;
  const session = sessions.get(sessionId);

  if (!session || !relayerKeypair) {
    return res.status(400).json({ error: 'Session expired or relayer not configured' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const txBuffer = Buffer.from(signedTx, 'base64');

    session.step = 'depositing';
    const depositTx = await connection.sendRawTransaction(txBuffer);
    await connection.confirmTransaction(depositTx, 'confirmed');
    session.depositTx = depositTx;

    console.log(`[${sessionId}] Deposit: ${depositTx}`);

    // Forward to recipient
    session.step = 'withdrawing';
    const fee = 5_000_000; // 0.005 SOL fee
    const sendAmount = session.amountLamports - fee;

    const withdrawTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: relayerKeypair.publicKey,
        toPubkey: new PublicKey(session.recipientAddress),
        lamports: sendAmount
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    withdrawTx.recentBlockhash = blockhash;
    withdrawTx.feePayer = relayerKeypair.publicKey;
    withdrawTx.sign(relayerKeypair);

    const withdrawSig = await connection.sendRawTransaction(withdrawTx.serialize());
    await connection.confirmTransaction(withdrawSig, 'confirmed');

    session.withdrawTx = withdrawSig;
    session.step = 'complete';

    console.log(`[${sessionId}] Withdraw: ${withdrawSig}`);
    res.json({ success: true, depositTx, withdrawTx: withdrawSig });

  } catch (err: any) {
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

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Solnado Server running on port ${PORT}`);
  console.log(`Relayer: ${relayerKeypair?.publicKey.toBase58() || 'NOT SET'}`);
});
