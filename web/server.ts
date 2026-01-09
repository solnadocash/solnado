/**
 * Solnado Server
 * Private SOL transfers using PrivacyCash shielded pool
 * Fresh wallet per transaction for maximum privacy
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

// @ts-ignore - privacycash types
import { PrivacyCash } from 'privacycash';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'https://mainnet.helius-rpc.com/?api-key=da8de8e3-afd3-457e-9820-a62102ca3c9b';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'solnado-admin-2024';

// Main relayer wallet - this funds the pool operations and receives swept funds
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
let relayerKeypair: Keypair | null = null;
let privacyCash: any = null;

// Temp wallet storage file
const TEMP_WALLETS_FILE = path.join(__dirname, '../data/temp-wallets.json');

// Ensure data directory exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Temp wallet storage structure
interface TempWallet {
  publicKey: string;
  secretKey: string; // base58 encoded
  sessionId: string;
  createdAt: number;
  status: 'pending' | 'received' | 'swept' | 'failed';
  amountLamports?: number;
  recipientAddress?: string;
}

// Load temp wallets from file
function loadTempWallets(): Map<string, TempWallet> {
  try {
    if (fs.existsSync(TEMP_WALLETS_FILE)) {
      const data = JSON.parse(fs.readFileSync(TEMP_WALLETS_FILE, 'utf-8'));
      return new Map(Object.entries(data));
    }
  } catch (e) {
    console.error('Failed to load temp wallets:', e);
  }
  return new Map();
}

// Save temp wallets to file
function saveTempWallets(wallets: Map<string, TempWallet>) {
  try {
    const obj = Object.fromEntries(wallets);
    fs.writeFileSync(TEMP_WALLETS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Failed to save temp wallets:', e);
  }
}

// In-memory temp wallet storage (persisted to file)
const tempWallets = loadTempWallets();

// Generate fresh wallet for a transaction
function generateTempWallet(sessionId: string, amountLamports: number, recipientAddress: string): TempWallet {
  const keypair = Keypair.generate();
  const wallet: TempWallet = {
    publicKey: keypair.publicKey.toBase58(),
    secretKey: bs58.encode(keypair.secretKey),
    sessionId,
    createdAt: Date.now(),
    status: 'pending',
    amountLamports,
    recipientAddress
  };
  tempWallets.set(wallet.publicKey, wallet);
  saveTempWallets(tempWallets);
  console.log(`[${sessionId}] Generated temp wallet: ${wallet.publicKey}`);
  return wallet;
}

// Get keypair from temp wallet
function getTempKeypair(publicKey: string): Keypair | null {
  const wallet = tempWallets.get(publicKey);
  if (!wallet) return null;
  return Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
}

// Update temp wallet status
function updateTempWallet(publicKey: string, updates: Partial<TempWallet>) {
  const wallet = tempWallets.get(publicKey);
  if (wallet) {
    Object.assign(wallet, updates);
    tempWallets.set(publicKey, wallet);
    saveTempWallets(tempWallets);
  }
}

if (RELAYER_KEY) {
  try {
    relayerKeypair = Keypair.fromSecretKey(bs58.decode(RELAYER_KEY));
    console.log(`Main Relayer: ${relayerKeypair.publicKey.toBase58()}`);
    
    // Initialize PrivacyCash with main relayer's key
    privacyCash = new PrivacyCash({
      RPC_url: RPC_URL,
      owner: Array.from(relayerKeypair.secretKey),
      enableDebug: true
    });
    console.log('PrivacyCash SDK initialized');
    console.log(`Temp wallets loaded: ${tempWallets.size}`);
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
  tempWalletPubkey?: string; // Fresh wallet for this tx
  depositTx?: string;
  withdrawTx?: string;
  error?: string;
}>();

// Fee constants - PrivacyCash takes ~3% from withdrawal
const PROTOCOL_FEE_RATE = 0.03; // ~3% PrivacyCash protocol fee
const RELAYER_FEE_LAMPORTS = 1_000_000; // 0.001 SOL relayer fee (minimal)

/**
 * Calculate what recipient will receive after fees
 * Simple model: sender pays X, recipient gets X minus fees
 */
function calculateRecipientAmount(sendAmountLamports: number): {
  recipientLamports: number;
  protocolFee: number;
  relayerFee: number;
} {
  const protocolFee = Math.ceil(sendAmountLamports * PROTOCOL_FEE_RATE);
  const recipientLamports = sendAmountLamports - protocolFee - RELAYER_FEE_LAMPORTS;
  
  return {
    recipientLamports,
    protocolFee,
    relayerFee: RELAYER_FEE_LAMPORTS
  };
}

/**
 * POST /api/prepare-deposit
 * Step 1: User sends SOL to a FRESH temp wallet (max privacy)
 * Simple model: sender pays X, recipient gets X minus ~3% fees
 */
app.post('/api/prepare-deposit', async (req, res) => {
  const { senderAddress, recipientAddress, amountSol } = req.body;

  if (!senderAddress || !recipientAddress || !amountSol) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  if (!relayerKeypair || !privacyCash) {
    return res.status(500).json({ error: 'Relayer not configured' });
  }

  // This is what the SENDER is sending
  const sendAmountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  
  // Calculate what recipient will get after fees
  const fees = calculateRecipientAmount(sendAmountLamports);

  if (fees.recipientLamports < 5_000_000) { // Min 0.005 SOL to recipient
    return res.status(400).json({ error: 'Amount too small after fees' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const sender = new PublicKey(senderAddress);

    const sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Generate FRESH wallet for this transaction (max privacy)
    const tempWallet = generateTempWallet(sessionId, sendAmountLamports, recipientAddress);

    // User sends exactly what they entered (fees deducted from this)
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: sender,
        toPubkey: new PublicKey(tempWallet.publicKey),
        lamports: sendAmountLamports
      })
    );

    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = sender;

    const serialized = tx.serialize({ requireAllSignatures: false });
    const base64Tx = Buffer.from(serialized).toString('base64');

    sessions.set(sessionId, {
      senderAddress,
      recipientAddress,
      amountLamports: sendAmountLamports, // What sender is sending
      tempWalletPubkey: tempWallet.publicKey,
      step: 'pending'
    });

    setTimeout(() => sessions.delete(sessionId), 10 * 60 * 1000);

    console.log(`[${sessionId}] Prepared: ${amountSol} SOL → recipient gets ~${fees.recipientLamports / LAMPORTS_PER_SOL} SOL`);
    res.json({ 
      sessionId, 
      unsignedTx: base64Tx,
      // Send fee breakdown to frontend
      fees: {
        sendAmount: sendAmountLamports / LAMPORTS_PER_SOL,
        recipientReceives: fees.recipientLamports / LAMPORTS_PER_SOL,
        protocolFee: fees.protocolFee / LAMPORTS_PER_SOL,
        relayerFee: fees.relayerFee / LAMPORTS_PER_SOL
      }
    });

  } catch (err: any) {
    console.error('Prepare error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/submit-deposit
 * Step 2: After user signs, submit their tx, sweep temp wallet, then do pool deposit + withdraw
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

  const tempWalletPubkey = session.tempWalletPubkey;
  if (!tempWalletPubkey) {
    return res.status(500).json({ error: 'Session missing temp wallet' });
  }

  const tempKeypair = getTempKeypair(tempWalletPubkey);
  if (!tempKeypair) {
    return res.status(500).json({ error: 'Temp wallet not found' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const txBuffer = Buffer.from(signedTx, 'base64');

    // Step 1: Submit user's deposit to temp wallet
    session.step = 'depositing';
    console.log(`[${sessionId}] Submitting user deposit to temp wallet...`);
    
    const userDepositTx = await connection.sendRawTransaction(txBuffer);
    await connection.confirmTransaction(userDepositTx, 'confirmed');
    session.depositTx = userDepositTx;
    updateTempWallet(tempWalletPubkey, { status: 'received' });
    console.log(`[${sessionId}] User deposit confirmed: ${userDepositTx}`);

    // Step 1.5: Sweep temp wallet to main relayer
    session.step = 'sweeping';
    console.log(`[${sessionId}] Sweeping temp wallet to main relayer...`);
    
    const tempBalance = await connection.getBalance(tempKeypair.publicKey);
    const sweepFee = 5000; // Gas for sweep tx
    const sweepAmount = tempBalance - sweepFee;
    
    if (sweepAmount <= 0) {
      throw new Error('Temp wallet has no funds to sweep');
    }
    
    const sweepTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: tempKeypair.publicKey,
        toPubkey: relayerKeypair.publicKey,
        lamports: sweepAmount
      })
    );
    await sendAndConfirmTransaction(connection, sweepTx, [tempKeypair]);
    updateTempWallet(tempWalletPubkey, { status: 'swept' });
    console.log(`[${sessionId}] Swept ${sweepAmount / LAMPORTS_PER_SOL} SOL to main relayer`);

    // Take small relayer fee, deposit the rest
    const depositAmount = sweepAmount - RELAYER_FEE_LAMPORTS;
    
    if (depositAmount < 5_000_000) { // Min 0.005 SOL deposit
      throw new Error('Amount too small after relayer fee');
    }
    
    console.log(`[${sessionId}] Relayer fee: ${RELAYER_FEE_LAMPORTS / LAMPORTS_PER_SOL} SOL, Depositing: ${depositAmount / LAMPORTS_PER_SOL} SOL`);

    // Step 2: Deposit to PrivacyCash shielded pool
    session.step = 'shielding';
    console.log(`[${sessionId}] Depositing to shielded pool...`);
    
    const depositResult = await privacyCash.deposit({
      lamports: depositAmount
    });
    console.log(`[${sessionId}] Pool deposit TX: ${depositResult?.tx || 'done'}`);

    // Wait for pool state to update (longer wait to let Merkle tree settle)
    await new Promise(r => setTimeout(r, 8000));

    // Step 3: Withdraw 100% from pool to recipient (NO CHANGE LEFT!)
    session.step = 'withdrawing';
    
    // Get exact pool balance - SDK returns object with lamports property
    const balanceResult = await privacyCash.getPrivateBalance();
    const poolBalance = typeof balanceResult === 'number' ? balanceResult : 
                        (balanceResult?.lamports || balanceResult?.balance || depositAmount);
    
    console.log(`[${sessionId}] Pool balance: ${poolBalance} lamports (${poolBalance / LAMPORTS_PER_SOL} SOL)`);
    
    // Withdraw full balance - SDK will calculate its own fee
    const withdrawAmountSol = poolBalance / LAMPORTS_PER_SOL;
    
    console.log(`[${sessionId}] Withdrawing ${withdrawAmountSol} SOL to recipient...`);

    let withdrawResult: any = null;
    let lastError: any = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[${sessionId}] Withdraw attempt ${attempt}/${maxRetries}...`);
        // Try with lamports and recipientAddress (matching SDK internal names)
        withdrawResult = await privacyCash.withdraw({
          lamports: poolBalance,
          recipientAddress: session.recipientAddress
        });
        break; // Success, exit loop
      } catch (retryErr: any) {
        lastError = retryErr;
        console.log(`[${sessionId}] Withdraw attempt ${attempt} failed: ${retryErr.message}`);
        if (attempt < maxRetries) {
          // Wait before retry, with increasing delay
          const delay = 5000 * attempt;
          console.log(`[${sessionId}] Waiting ${delay/1000}s before retry...`);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    
    if (!withdrawResult) {
      throw new Error(`Withdrawal failed after ${maxRetries} attempts: ${lastError?.message}`);
    }
    
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
    updateTempWallet(tempWalletPubkey, { status: 'failed' });
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

/**
 * GET /api/admin/temp-wallets
 * List all temp wallets and their status (admin only)
 */
app.get('/api/admin/temp-wallets', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const wallets = Array.from(tempWallets.values()).map(w => ({
    publicKey: w.publicKey,
    sessionId: w.sessionId,
    createdAt: new Date(w.createdAt).toISOString(),
    status: w.status,
    amountLamports: w.amountLamports
  }));

  res.json({ count: wallets.length, wallets });
});

/**
 * POST /api/admin/sweep-all
 * Emergency sweep all temp wallets to main relayer (admin only)
 */
app.post('/api/admin/sweep-all', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: 'Main relayer not configured' });
  }

  const connection = new Connection(RPC_URL, 'confirmed');
  const results: { publicKey: string; swept: number; error?: string }[] = [];

  for (const [pubkey, wallet] of tempWallets) {
    try {
      const keypair = Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
      const balance = await connection.getBalance(keypair.publicKey);
      
      if (balance > 5000) { // More than just rent
        const sweepAmount = balance - 5000;
        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: keypair.publicKey,
            toPubkey: relayerKeypair.publicKey,
            lamports: sweepAmount
          })
        );
        await sendAndConfirmTransaction(connection, tx, [keypair]);
        updateTempWallet(pubkey, { status: 'swept' });
        results.push({ publicKey: pubkey, swept: sweepAmount / LAMPORTS_PER_SOL });
        console.log(`[SWEEP] ${pubkey.slice(0, 8)}... → ${sweepAmount / LAMPORTS_PER_SOL} SOL`);
      } else {
        results.push({ publicKey: pubkey, swept: 0 });
      }
    } catch (err: any) {
      results.push({ publicKey: pubkey, swept: 0, error: err.message });
    }
  }

  const totalSwept = results.reduce((sum, r) => sum + r.swept, 0);
  res.json({ 
    success: true, 
    totalSwept,
    walletsProcessed: results.length,
    results 
  });
});

/**
 * POST /api/admin/sweep-one
 * Sweep a specific temp wallet (admin only)
 */
app.post('/api/admin/sweep-one', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { publicKey } = req.body;
  if (!publicKey) {
    return res.status(400).json({ error: 'publicKey required' });
  }

  if (!relayerKeypair) {
    return res.status(500).json({ error: 'Main relayer not configured' });
  }

  const wallet = tempWallets.get(publicKey);
  if (!wallet) {
    return res.status(404).json({ error: 'Wallet not found' });
  }

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const keypair = Keypair.fromSecretKey(bs58.decode(wallet.secretKey));
    const balance = await connection.getBalance(keypair.publicKey);

    if (balance <= 5000) {
      return res.json({ success: true, swept: 0, message: 'Wallet empty' });
    }

    const sweepAmount = balance - 5000;
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: relayerKeypair.publicKey,
        lamports: sweepAmount
      })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [keypair]);
    updateTempWallet(publicKey, { status: 'swept' });
    
    console.log(`[SWEEP] ${publicKey.slice(0, 8)}... → ${sweepAmount / LAMPORTS_PER_SOL} SOL (${sig})`);
    res.json({ success: true, swept: sweepAmount / LAMPORTS_PER_SOL, signature: sig });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/admin/cleanup
 * Remove old swept wallets from storage (admin only)
 */
app.delete('/api/admin/cleanup', (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const maxAge = 24 * 60 * 60 * 1000; // 24 hours
  const now = Date.now();
  let removed = 0;

  for (const [pubkey, wallet] of tempWallets) {
    if (wallet.status === 'swept' && (now - wallet.createdAt) > maxAge) {
      tempWallets.delete(pubkey);
      removed++;
    }
  }
  saveTempWallets(tempWallets);

  res.json({ success: true, removed, remaining: tempWallets.size });
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
