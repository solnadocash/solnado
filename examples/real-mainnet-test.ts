/**
 * REAL Mainnet Test using Official PrivacyCash SDK
 * 
 * This uses the official privacycash SDK to make real transactions on mainnet.
 * 
 * BEFORE RUNNING:
 * 1. Set SENDER_PRIVATE_KEY environment variable with your base58 private key
 * 2. Ensure wallet has at least 0.02 SOL
 * 
 * Run with: npx tsx examples/real-mainnet-test.ts
 */

import { Keypair, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';
// @ts-ignore - SDK types
import { PrivacyCash } from 'privacycash';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
const DEPOSIT_AMOUNT_LAMPORTS = 10_000_000; // 0.01 SOL

async function main() {
  console.log('🔐 REAL Mainnet Test: PrivacyCash SDK');
  console.log('='.repeat(60));
  console.log(`\n📡 Network: Solana Mainnet-Beta`);
  console.log(`📍 RPC: ${RPC_URL}`);
  
  // Get wallet from environment
  const privateKey = process.env.SENDER_PRIVATE_KEY;
  if (!privateKey) {
    console.log('\n❌ No private key provided!');
    console.log('   Set SENDER_PRIVATE_KEY environment variable');
    console.log('\n   Example:');
    console.log('   $env:SENDER_PRIVATE_KEY="your-base58-private-key"');
    console.log('   npx tsx examples/real-mainnet-test.ts');
    return;
  }
  
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  } catch (e) {
    console.log('\n❌ Invalid private key format');
    return;
  }
  
  console.log(`\n👛 Wallet: ${keypair.publicKey.toBase58()}`);
  
  // Check balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(keypair.publicKey);
  const balanceSol = balance / LAMPORTS_PER_SOL;
  console.log(`💰 Public Balance: ${balanceSol.toFixed(4)} SOL`);
  
  if (balance < DEPOSIT_AMOUNT_LAMPORTS + 5_000_000) {
    console.log(`\n❌ Insufficient balance for test`);
    console.log(`   Need at least 0.015 SOL (0.01 deposit + fees)`);
    return;
  }
  
  // Initialize PrivacyCash SDK
  console.log('\n📦 Initializing PrivacyCash SDK...');
  // SDK expects the secret key bytes directly
  const privacyCash = new PrivacyCash({
    RPC_url: RPC_URL,
    owner: Array.from(keypair.secretKey), // Pass as number array
    enableDebug: true // Show debug output
  });
  
  // Check current shielded balance
  console.log('\n💰 Checking current shielded balance...');
  try {
    const shieldedBalance = await privacyCash.getPrivateBalance();
    console.log(`   Shielded Balance: ${shieldedBalance / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) {
    console.log(`   Error checking balance: ${e.message}`);
  }
  
  // Deposit SOL (shield)
  console.log(`\n📥 Depositing ${DEPOSIT_AMOUNT_LAMPORTS / LAMPORTS_PER_SOL} SOL to shielded pool...`);
  console.log('   This will shield your SOL for privacy.');
  
  try {
    const depositResult = await privacyCash.deposit({
      lamports: DEPOSIT_AMOUNT_LAMPORTS
    });
    
    console.log('\n✅ Deposit successful!');
    console.log(`   Result: ${JSON.stringify(depositResult, null, 2)}`);
    
    // Check new shielded balance
    console.log('\n💰 New shielded balance:');
    const newBalance = await privacyCash.getPrivateBalance();
    console.log(`   ${newBalance / LAMPORTS_PER_SOL} SOL`);
    
    // Check public balance
    const newPublicBalance = await connection.getBalance(keypair.publicKey);
    console.log(`\n💰 New public balance: ${newPublicBalance / LAMPORTS_PER_SOL} SOL`);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ REAL MAINNET DEPOSIT COMPLETED!');
    console.log('='.repeat(60));
    console.log('\nYour SOL is now shielded in the PrivacyCash pool.');
    console.log('You can withdraw it anytime with:');
    console.log('   privacyCash.withdraw({ lamports: amount, recipientAddress: "..." })');
    
  } catch (e: any) {
    console.log(`\n❌ Deposit failed: ${e.message}`);
    console.log('\nFull error:');
    console.log(e);
  }
}

main().catch(console.error);

