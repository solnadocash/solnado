/**
 * SolnaDoCash Web Server
 * 
 * Handles private send requests from the frontend
 * 
 * Run with: npx tsx web/server.ts
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from '@solana/web3.js';
import * as solanaWeb3 from '@solana/web3.js';
import bs58 from 'bs58';

// @ts-ignore
import { PrivacyCash } from 'privacycash';

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// In-memory store for pending transactions (in production, use Redis/DB)
const pendingTransactions = new Map<string, {
  status: string;
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

/**
 * POST /api/private-send
 * 
 * Request body:
 * - senderPublicKey: string (wallet address)
 * - recipientAddress: string
 * - amountSol: number
 * 
 * Uses SENDER_PRIVATE_KEY env var for signing (testing mode)
 * For production, implement proper wallet signing flow
 */
app.post('/api/private-send', async (req, res) => {
  const { senderPublicKey, recipientAddress, amountSol } = req.body;

  if (!recipientAddress || !amountSol) {
    return res.status(400).json({ 
      error: 'Missing required fields: recipientAddress, amountSol' 
    });
  }

  // For testing: use environment private key
  const senderPrivateKey = process.env.SENDER_PRIVATE_KEY;
  if (!senderPrivateKey) {
    return res.status(400).json({ 
      error: 'Server not configured. Set SENDER_PRIVATE_KEY environment variable.' 
    });
  }

  try {
    // Validate recipient
    new PublicKey(recipientAddress);
  } catch {
    return res.status(400).json({ error: 'Invalid recipient address' });
  }

  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  if (amountLamports < 10_000_000) { // 0.01 SOL minimum
    return res.status(400).json({ error: 'Minimum amount is 0.01 SOL' });
  }

  const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingTransactions.set(txId, { status: 'processing' });

  // Process async
  processPrivateSend(txId, senderPrivateKey, recipientAddress, amountLamports)
    .catch(err => {
      pendingTransactions.set(txId, { status: 'failed', error: err.message });
    });

  res.json({ txId, status: 'processing' });
});

/**
 * GET /api/tx/:txId
 * Check transaction status
 */
app.get('/api/tx/:txId', (req, res) => {
  const { txId } = req.params;
  const tx = pendingTransactions.get(txId);
  
  if (!tx) {
    return res.status(404).json({ error: 'Transaction not found' });
  }

  res.json(tx);
});

/**
 * POST /api/private-send-direct
 * 
 * Direct send with private key (for testing/CLI usage)
 * In production, use proper wallet signing
 */
app.post('/api/private-send-direct', async (req, res) => {
  const { senderPrivateKey, recipientAddress, amountSol } = req.body;

  if (!senderPrivateKey || !recipientAddress || !amountSol) {
    return res.status(400).json({ 
      error: 'Missing required fields' 
    });
  }

  try {
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(senderPrivateKey));
    const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    console.log(`\n🔐 Private Send Request`);
    console.log(`   From: ${senderKeypair.publicKey.toBase58()}`);
    console.log(`   To: ${recipientAddress}`);
    console.log(`   Amount: ${amountSol} SOL`);

    // Initialize PrivacyCash
    const privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(senderKeypair.secretKey),
      enableDebug: false
    });

    // Step 1: Deposit
    console.log(`\n📥 Step 1: Depositing to pool...`);
    const depositResult = await privacyCash.deposit({
      lamports: amountLamports
    });
    console.log(`   ✅ Deposit TX: ${depositResult?.tx}`);

    // Wait for pool to update
    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Withdraw to recipient
    console.log(`\n📤 Step 2: Withdrawing to recipient...`);
    const relayerFee = 2_000_000; // ~0.002 SOL
    const withdrawAmount = amountLamports - relayerFee;

    const withdrawResult = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: recipientAddress
    });
    console.log(`   ✅ Withdraw TX: ${withdrawResult?.tx || 'confirmed'}`);

    // Get final amounts
    const connection = new Connection(RPC_URL, 'confirmed');
    const recipientBalance = await connection.getBalance(new PublicKey(recipientAddress));

    res.json({
      success: true,
      depositTx: depositResult?.tx,
      withdrawTx: withdrawResult?.tx,
      recipientBalance: recipientBalance / LAMPORTS_PER_SOL
    });

  } catch (err: any) {
    console.error('❌ Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Store pending transactions
const walletTxStore = new Map<string, {
  recipientAddress: string;
  amountLamports: number;
  senderAddress: string;
  blockhash: string;
}>();

/**
 * POST /api/prepare-send
 * 
 * Step 1: Build unsigned transaction with fresh blockhash
 */
app.post('/api/prepare-send', async (req, res) => {
  const { senderAddress, recipientAddress, amountLamports } = req.body;

  if (!senderAddress || !recipientAddress || !amountLamports) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    console.log(`\n[Prepare] From: ${senderAddress}`);
    console.log(`[Prepare] To: ${recipientAddress}`);
    console.log(`[Prepare] Amount: ${amountLamports / LAMPORTS_PER_SOL} SOL`);

    const connection = new Connection(RPC_URL, 'confirmed');
    
    // For demo: User sends to relayer, relayer forwards to recipient
    // In production: This would be the PrivacyCash pool address
    const relayerKey = process.env.RELAYER_PRIVATE_KEY || process.env.SENDER_PRIVATE_KEY;
    if (!relayerKey) {
      return res.status(500).json({ error: 'Relayer not configured' });
    }
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(relayerKey));
    const poolAddress = relayerKeypair.publicKey; // User sends to relayer

    // Build transaction
    const tx = new Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: new PublicKey(senderAddress),
        toPubkey: poolAddress,
        lamports: amountLamports
      })
    );

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = new PublicKey(senderAddress);

    // Serialize unsigned transaction
    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64Tx = serialized.toString('base64');

    // Store for later
    const txId = `tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    walletTxStore.set(txId, {
      recipientAddress,
      amountLamports,
      senderAddress,
      blockhash
    });

    // Clean up old entries after 5 minutes
    setTimeout(() => walletTxStore.delete(txId), 5 * 60 * 1000);

    res.json({
      txId,
      unsignedTx: base64Tx,
      blockhash,
      lastValidBlockHeight
    });

  } catch (err: any) {
    console.error('[Prepare] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/submit-send
 * 
 * Step 2: Submit signed transaction and process withdraw
 */
app.post('/api/submit-send', async (req, res) => {
  const { signedTx, txId } = req.body;

  if (!signedTx || !txId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const txData = walletTxStore.get(txId);
  if (!txData) {
    return res.status(400).json({ error: 'Transaction expired or not found' });
  }

  const { recipientAddress, amountLamports, senderAddress } = txData;

  try {
    console.log(`\n[Submit] Processing tx: ${txId}`);

    const connection = new Connection(RPC_URL, 'confirmed');
    const txBuffer = Buffer.from(signedTx, 'base64');

    // Submit the signed transaction
    console.log('[Submit] Submitting deposit transaction...');
    const depositTx = await connection.sendRawTransaction(txBuffer, {
      skipPreflight: false,
      preflightCommitment: 'confirmed'
    });
    console.log(`[Submit] Deposit TX: ${depositTx}`);

    // Wait for confirmation
    await connection.confirmTransaction(depositTx, 'confirmed');
    console.log('[Submit] Deposit confirmed');

    // Clean up
    walletTxStore.delete(txId);

    // Process withdraw via relayer
    const relayerKey = process.env.RELAYER_PRIVATE_KEY || process.env.SENDER_PRIVATE_KEY;
    
    if (!relayerKey) {
      return res.json({
        success: true,
        depositTx: depositTx,
        withdrawTx: null,
        message: 'Deposit complete. Configure RELAYER_PRIVATE_KEY for auto-withdraw.'
      });
    }

    // For demo: Direct transfer from relayer to recipient
    // In production: Use PrivacyCash withdraw with ZK proofs
    const relayerKeypair = Keypair.fromSecretKey(bs58.decode(relayerKey));
    
    console.log(`[Submit] Transferring to recipient: ${recipientAddress}`);
    
    const transferTx = new Transaction().add(
      solanaWeb3.SystemProgram.transfer({
        fromPubkey: relayerKeypair.publicKey,
        toPubkey: new PublicKey(recipientAddress),
        lamports: amountLamports - 5_000_000 // Subtract fees
      })
    );

    transferTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    transferTx.feePayer = relayerKeypair.publicKey;
    transferTx.sign(relayerKeypair);

    const withdrawTx = await connection.sendRawTransaction(transferTx.serialize());
    await connection.confirmTransaction(withdrawTx, 'confirmed');

    console.log(`[Submit] Withdraw TX: ${withdrawTx}`);

    res.json({
      success: true,
      depositTx: depositTx,
      withdrawTx: withdrawTx
    });

  } catch (err: any) {
    console.error('[Submit] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/balance/:address
 * Get SOL balance for an address
 */
app.get('/api/balance/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const connection = new Connection(RPC_URL, 'confirmed');
    const lamports = await connection.getBalance(new PublicKey(address));
    res.json({ 
      address,
      balance: lamports / LAMPORTS_PER_SOL,
      lamports
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Async process for private send
 */
async function processPrivateSend(
  txId: string,
  senderPrivateKey: string,
  recipientAddress: string,
  amountLamports: number
) {
  try {
    const senderKeypair = Keypair.fromSecretKey(bs58.decode(senderPrivateKey));

    // Initialize PrivacyCash
    const privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(senderKeypair.secretKey),
      enableDebug: false
    });

    // Step 1: Deposit
    pendingTransactions.set(txId, { status: 'depositing' });
    const depositResult = await privacyCash.deposit({
      lamports: amountLamports
    });

    pendingTransactions.set(txId, { 
      status: 'deposited',
      depositTx: depositResult?.tx
    });

    // Wait for pool
    await new Promise(r => setTimeout(r, 3000));

    // Step 2: Withdraw
    pendingTransactions.set(txId, { 
      status: 'withdrawing',
      depositTx: depositResult?.tx
    });

    const relayerFee = 2_000_000;
    const withdrawAmount = amountLamports - relayerFee;

    const withdrawResult = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: recipientAddress
    });

    pendingTransactions.set(txId, {
      status: 'complete',
      depositTx: depositResult?.tx,
      withdrawTx: withdrawResult?.tx
    });

  } catch (err: any) {
    pendingTransactions.set(txId, {
      status: 'failed',
      error: err.message
    });
  }
}

// Serve the frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   🔒 SolnaDoCash Server                                  ║
║                                                          ║
║   Local:  http://localhost:${PORT}                         ║
║   RPC:    ${RPC_URL.slice(0, 40)}...          ║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
  `);
});

