/**
 * Mainnet Test: Real Private Send on Solana Mainnet
 * 
 * This script tests against the real PrivacyCash program on mainnet.
 * 
 * BEFORE RUNNING:
 * 1. Set your private key in SENDER_PRIVATE_KEY environment variable
 *    OR the script will generate a new wallet for you to fund
 * 
 * 2. Ensure you have at least 0.1 SOL in the wallet
 * 
 * Run with: npx tsx examples/mainnet-test.ts
 */

import { 
  Keypair, 
  Connection, 
  LAMPORTS_PER_SOL,
  PublicKey,
  clusterApiUrl
} from '@solana/web3.js';
import bs58 from 'bs58';
import { PrivateSendClient } from '../src/client/PrivateSend.js';
import { ReceiverScanner } from '../src/scanner/index.js';
import { PRIVACY_CASH_PROGRAM_ID, MAINNET_RPC_URL } from '../src/constants.js';

// Configuration
const RPC_URL = process.env.RPC_URL || MAINNET_RPC_URL;
const AMOUNT_TO_SEND = 0.01; // SOL - small amount for testing

async function main() {
  console.log('🔐 Mainnet Test: Solana Private Send');
  console.log('='.repeat(60));
  console.log(`\n📡 Network: Solana Mainnet-Beta`);
  console.log(`📍 RPC: ${RPC_URL}`);
  console.log(`🏛️ PrivacyCash Program: ${PRIVACY_CASH_PROGRAM_ID.toBase58()}`);
  
  const connection = new Connection(RPC_URL, 'confirmed');
  
  // Get or create sender wallet
  let senderKeypair: Keypair;
  
  if (process.env.SENDER_PRIVATE_KEY) {
    try {
      const secretKey = bs58.decode(process.env.SENDER_PRIVATE_KEY);
      senderKeypair = Keypair.fromSecretKey(secretKey);
      console.log(`\n✓ Using provided wallet`);
    } catch (e) {
      console.error('Invalid SENDER_PRIVATE_KEY format. Use base58 encoded secret key.');
      process.exit(1);
    }
  } else {
    // Generate a new wallet for testing
    senderKeypair = Keypair.generate();
    console.log(`\n⚠️  No wallet provided. Generated new test wallet.`);
    console.log(`\n📋 To use this wallet, set environment variable:`);
    console.log(`   SENDER_PRIVATE_KEY=${bs58.encode(senderKeypair.secretKey)}`);
  }
  
  console.log(`\n👛 Sender Wallet: ${senderKeypair.publicKey.toBase58()}`);
  
  // Check balance
  const balance = await connection.getBalance(senderKeypair.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Balance: ${balanceSol.toFixed(4)} SOL`);
  
  const requiredBalance = AMOUNT_TO_SEND + 0.01; // Amount + fees
  
  if (balanceSol < requiredBalance) {
    console.log(`\n❌ Insufficient balance!`);
    console.log(`   Required: ${requiredBalance} SOL`);
    console.log(`   Current:  ${balanceSol.toFixed(4)} SOL`);
    console.log(`\n📥 Please send at least ${requiredBalance} SOL to:`);
    console.log(`   ${senderKeypair.publicKey.toBase58()}`);
    console.log(`\n   Then run this script again.`);
    
    // Show QR-friendly address
    console.log(`\n🔗 Solana Explorer:`);
    console.log(`   https://explorer.solana.com/address/${senderKeypair.publicKey.toBase58()}`);
    
    return;
  }
  
  console.log(`\n✓ Sufficient balance for test`);
  
  // Generate receiver wallet
  const receiverKeypair = Keypair.generate();
  console.log(`\n📬 Receiver Wallet: ${receiverKeypair.publicKey.toBase58()}`);
  console.log(`   (Generated for this test - save the key if you want to receive)`);
  console.log(`   Receiver Private Key: ${bs58.encode(receiverKeypair.secretKey)}`);
  
  // Verify PrivacyCash program exists
  console.log(`\n🔍 Verifying PrivacyCash program...`);
  try {
    const programInfo = await connection.getAccountInfo(PRIVACY_CASH_PROGRAM_ID);
    if (programInfo && programInfo.executable) {
      console.log(`   ✓ Program exists and is executable`);
      console.log(`   Size: ${programInfo.data.length} bytes`);
    } else {
      console.log(`   ⚠️ Program account found but may not be executable`);
    }
  } catch (e) {
    console.log(`   ❌ Could not verify program: ${e}`);
  }
  
  // Create private send client
  console.log(`\n📤 Initiating Private Send...`);
  console.log(`   Amount: ${AMOUNT_TO_SEND} SOL`);
  console.log(`   To: ${receiverKeypair.publicKey.toBase58().slice(0, 20)}...`);
  
  const client = new PrivateSendClient({
    rpcUrl: RPC_URL,
    // Use official PrivacyCash relayer or local
    relayerUrl: process.env.RELAYER_URL || 'http://localhost:3001/api',
  });
  
  // Estimate costs
  const estimate = client.estimateCost(AMOUNT_TO_SEND);
  console.log(`\n💵 Cost Breakdown:`);
  console.log(`   Amount:      ${estimate.amount} SOL`);
  console.log(`   Relayer Fee: ${estimate.relayerFee} SOL`);
  console.log(`   Total:       ${estimate.total} SOL`);
  
  // Execute the private send
  console.log(`\n⏳ Executing private send...`);
  
  const startTime = Date.now();
  const result = await client.send(
    senderKeypair,
    AMOUNT_TO_SEND,
    receiverKeypair.publicKey.toBase58()
  );
  const duration = Date.now() - startTime;
  
  console.log(`\n📊 Result (${duration}ms):`);
  
  if (result.success) {
    console.log(`   ✅ SUCCESS!`);
    console.log(`   Transaction: ${result.transactionSignature}`);
    console.log(`   Commitment:  ${result.commitment}`);
    
    if (result.transactionSignature && !result.transactionSignature.startsWith('simulated')) {
      console.log(`\n🔗 View on Solana Explorer:`);
      console.log(`   https://explorer.solana.com/tx/${result.transactionSignature}`);
    }
    
    // Start receiver scanner
    console.log(`\n🔍 Starting receiver scanner...`);
    const scanner = new ReceiverScanner(receiverKeypair, {
      rpcUrl: RPC_URL,
      pollInterval: 5000,
    });
    
    let noteFound = false;
    
    scanner.on((event) => {
      if (event.type === 'new_note') {
        console.log(`\n💰 NOTE RECEIVED!`);
        console.log(`   Amount: ${Number(event.note.amount) / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Commitment: ${event.note.commitment}`);
        noteFound = true;
      } else if (event.type === 'balance_updated') {
        const bal = Number(event.balance.availableBalance) / LAMPORTS_PER_SOL;
        if (bal > 0) {
          console.log(`   Shielded Balance: ${bal} SOL`);
        }
      }
    });
    
    await scanner.start();
    
    // Wait for note detection (up to 30 seconds)
    console.log(`   Scanning for incoming notes (30s timeout)...`);
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000));
      if (noteFound) break;
      console.log(`   ... scanning (${(i + 1) * 5}s)`);
    }
    
    scanner.stop();
    
    if (noteFound) {
      console.log(`\n✅ FULL FLOW VERIFIED!`);
      console.log(`   Sender → Shielded Pool → Receiver (auto-detected)`);
    } else {
      console.log(`\n⚠️ Note not detected in 30s`);
      console.log(`   This could mean:`);
      console.log(`   - Transaction is still confirming`);
      console.log(`   - Note encryption/derivation needs adjustment`);
      console.log(`   - Using simulated transaction (no actual on-chain tx)`);
    }
    
  } else {
    console.log(`   ❌ FAILED`);
    console.log(`   Error: ${result.error}`);
    
    if (result.error?.includes('simulating')) {
      console.log(`\n📝 Note: Transaction was simulated.`);
      console.log(`   For real mainnet transactions, ensure:`);
      console.log(`   1. Relayer is running and funded`);
      console.log(`   2. Using official PrivacyCash SDK for proper instructions`);
    }
  }
  
  // Final balance check
  console.log(`\n💰 Final sender balance:`);
  const finalBalance = await connection.getBalance(senderKeypair.publicKey);
  console.log(`   ${(finalBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  
  console.log(`\n` + '='.repeat(60));
  console.log(`Test completed!`);
}

main().catch(console.error);

