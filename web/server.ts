/**
 * Solnado Private Send Server
 * 
 * Uses PrivacyCash for ZK private transfers
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// @ts-ignore
import { PrivacyCash } from 'privacycash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=da8de8e3-afd3-457e-9820-a62102ca3c9b';

// Relayer wallet - pays for withdraw tx, gets reimbursed via deposit
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Track pending sends
const pendingSends = new Map<string, {
  status: 'pending' | 'depositing' | 'withdrawing' | 'complete' | 'failed';
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

/**
 * POST /api/private-send
 * 
 * Full privacy flow using PrivacyCash:
 * 1. Sender deposits to pool (includes relayer fee)
 * 2. Relayer withdraws to recipient with ZK proof
 */
app.post('/api/private-send', async (req, res) => {
  const { senderPrivateKey, recipientAddress, amountSol } = req.body;

  if (!senderPrivateKey || !recipientAddress || !amountSol) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Validate
  try {
    new PublicKey(recipientAddress);
  } catch {
    return res.status(400).json({ error: 'Invalid recipient address' });
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (amountLamports < 10_000_000) {
    return res.status(400).json({ error: 'Minimum 0.01 SOL' });
  }

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingSends.set(txId, { status: 'pending' });

  // Process async - return immediately
  processPrivateSend(txId, senderPrivateKey, recipientAddress, amountLamports);

  res.json({ txId, status: 'pending' });
});

/**
 * GET /api/tx/:txId
 * Check transaction status
 */
app.get('/api/tx/:txId', (req, res) => {
  const tx = pendingSends.get(req.params.txId);
  if (!tx) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(tx);
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
 * Process private send via PrivacyCash
 */
async function processPrivateSend(
  txId: string,
  senderPrivateKey: string,
  recipientAddress: string,
  amountLamports: number
) {
  try {
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(senderPrivateKey));
    
    console.log(`\n[${txId}] Private Send Started`);
    console.log(`  From: ${senderKeypair.publicKey.toBase58()}`);
    console.log(`  To: ${recipientAddress}`);
    console.log(`  Amount: ${amountLamports / LAMPORTS_PER_SOL} SOL`);

    // Initialize PrivacyCash with sender's key
    const privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(senderKeypair.secretKey),
      enableDebug: false
    });

    // Step 1: Deposit to shielded pool
    pendingSends.set(txId, { status: 'depositing' });
    console.log(`[${txId}] Depositing to pool...`);
    
    const depositResult = await privacyCash.deposit({
      lamports: amountLamports
    });
    
    console.log(`[${txId}] Deposit TX: ${depositResult?.tx}`);
    pendingSends.set(txId, { 
      status: 'withdrawing',
      depositTx: depositResult?.tx
    });

    // Wait for pool state to update
    await new Promise(r => setTimeout(r, 5000));

    // Step 2: Withdraw to recipient with ZK proof
    console.log(`[${txId}] Withdrawing to recipient...`);
    
    const relayerFee = 2_000_000; // 0.002 SOL fee
    const withdrawAmount = amountLamports - relayerFee;

    const withdrawResult = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: recipientAddress
    });

    console.log(`[${txId}] Withdraw TX: ${withdrawResult?.tx}`);
    console.log(`[${txId}] Complete!`);

    pendingSends.set(txId, {
      status: 'complete',
      depositTx: depositResult?.tx,
      withdrawTx: withdrawResult?.tx
    });

  } catch (err: any) {
    console.error(`[${txId}] Error:`, err.message);
    pendingSends.set(txId, {
      status: 'failed',
      error: err.message
    });
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
  
  Ready for private transfers.
  `);
});
