/**
 * Vercel Serverless API
 */

import { VercelRequest, VercelResponse } from '@vercel/node';
import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.split('?')[0];

  try {
    // GET /api/balance/:address
    if (req.method === 'GET' && path?.startsWith('/api/balance/')) {
      const address = path.replace('/api/balance/', '');
      const connection = new Connection(RPC_URL, 'confirmed');
      const lamports = await connection.getBalance(new PublicKey(address));
      return res.json({ 
        address,
        balance: lamports / LAMPORTS_PER_SOL,
        lamports
      });
    }

    // POST /api/prepare-send
    if (req.method === 'POST' && path === '/api/prepare-send') {
      const { senderAddress, recipientAddress, amountLamports } = req.body;

      if (!senderAddress || !recipientAddress || !amountLamports) {
        return res.status(400).json({ error: 'Missing required fields' });
      }

      const connection = new Connection(RPC_URL, 'confirmed');
      
      // Build transaction
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: new PublicKey(senderAddress),
          toPubkey: new PublicKey(recipientAddress),
          lamports: amountLamports
        })
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = new PublicKey(senderAddress);

      const serialized = tx.serialize({ requireAllSignatures: false });
      const base64Tx = Buffer.from(serialized).toString('base64');

      return res.json({
        unsignedTx: base64Tx,
        blockhash,
        lastValidBlockHeight
      });
    }

    // POST /api/submit-send
    if (req.method === 'POST' && path === '/api/submit-send') {
      const { signedTx } = req.body;

      if (!signedTx) {
        return res.status(400).json({ error: 'Missing signedTx' });
      }

      const connection = new Connection(RPC_URL, 'confirmed');
      const txBuffer = Buffer.from(signedTx, 'base64');

      const txHash = await connection.sendRawTransaction(txBuffer, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });

      await connection.confirmTransaction(txHash, 'confirmed');

      return res.json({
        success: true,
        txHash
      });
    }

    // Health check
    if (path === '/api' || path === '/api/') {
      return res.json({ status: 'ok', rpc: RPC_URL });
    }

    return res.status(404).json({ error: 'Not found' });

  } catch (err: any) {
    console.error('API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}

