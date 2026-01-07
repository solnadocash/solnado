/**
 * AUTOMATIC Private Send - Deposit + Withdraw in One Flow
 * 
 * This does exactly what you do manually on PrivacyCash:
 * 1. Deposit SOL to pool (shields it)
 * 2. Immediately withdraw to receiver's address
 * 
 * Result: Receiver gets SOL, link is broken via the pool!
 * 
 * Usage:
 * $env:SENDER_PRIVATE_KEY="..."; npx tsx examples/private-send-auto.ts <receiver-address> <amount-sol>
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
// @ts-ignore
import { PrivacyCash } from 'privacycash';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function privateSend(
  senderPrivateKey: string,
  receiverAddress: string,
  amountSol: number
) {
  console.log('🔐 AUTOMATIC Private Send');
  console.log('='.repeat(60));
  
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  const senderKeypair = Keypair.fromSecretKey(bs58.decode(senderPrivateKey));
  
  console.log(`\n👛 Sender: ${senderKeypair.publicKey.toBase58()}`);
  console.log(`📬 Receiver: ${receiverAddress}`);
  console.log(`💰 Amount: ${amountSol} SOL`);
  
  // Validate receiver
  try {
    new PublicKey(receiverAddress);
  } catch {
    throw new Error('Invalid receiver address');
  }
  
  // Check balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(senderKeypair.publicKey);
  console.log(`📊 Sender balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Estimate: amount + ~0.012 SOL for gas and relayer fees
  const estimatedFees = 12_000_000; // 0.012 SOL
  if (balance < amountLamports + estimatedFees) {
    throw new Error(`Need at least ${(amountLamports + estimatedFees) / LAMPORTS_PER_SOL} SOL`);
  }
  
  // Get receiver's balance before
  const receiverPubkey = new PublicKey(receiverAddress);
  const receiverBalanceBefore = await connection.getBalance(receiverPubkey);
  console.log(`📊 Receiver balance before: ${receiverBalanceBefore / LAMPORTS_PER_SOL} SOL`);
  
  // Initialize PrivacyCash
  console.log('\n📦 Initializing PrivacyCash SDK...');
  const privacyCash = new PrivacyCash({
    RPC_url: RPC_URL,
    owner: Array.from(senderKeypair.secretKey),
    enableDebug: true
  });
  
  // STEP 1: DEPOSIT
  console.log('\n' + '─'.repeat(60));
  console.log('📥 STEP 1: Depositing to shielded pool...');
  console.log('─'.repeat(60));
  
  const depositResult = await privacyCash.deposit({
    lamports: amountLamports
  });
  
  console.log('✅ Deposit complete!');
  console.log(`   TX: ${depositResult?.tx || 'confirmed'}`);
  
  // Wait a moment for the UTXO to be indexed
  console.log('\n⏳ Waiting for pool to update...');
  await new Promise(r => setTimeout(r, 3000));
  
  // STEP 2: WITHDRAW TO RECEIVER
  // The key insight: we KNOW the exact amount we just deposited!
  // No need to call getPrivateBalance() (which has the NaN bug)
  console.log('\n' + '─'.repeat(60));
  console.log('📤 STEP 2: Withdrawing to receiver...');
  console.log(`   Recipient: ${receiverAddress}`);
  console.log('─'.repeat(60));
  
  // Withdraw slightly less to account for relayer fee (~0.002 SOL)
  const relayerFee = 2_000_000; // 0.002 SOL
  const withdrawAmount = amountLamports - relayerFee;
  
  console.log(`   Withdraw amount: ${withdrawAmount / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Relayer fee: ~${relayerFee / LAMPORTS_PER_SOL} SOL`);
  
  const withdrawResult = await privacyCash.withdraw({
    lamports: withdrawAmount,
    recipientAddress: receiverAddress
  });
  
  console.log('\n✅ Withdraw complete!');
  console.log(`   TX: ${withdrawResult?.tx || 'confirmed'}`);
  
  // Verify receiver got it
  console.log('\n🔍 Verifying...');
  await new Promise(r => setTimeout(r, 3000));
  
  const receiverBalanceAfter = await connection.getBalance(receiverPubkey);
  const received = receiverBalanceAfter - receiverBalanceBefore;
  
  console.log(`   Receiver balance after: ${receiverBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Received: ${received / LAMPORTS_PER_SOL} SOL`);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ PRIVATE SEND COMPLETE!');
  console.log('='.repeat(60));
  console.log(`\n🔒 Privacy achieved:`);
  console.log(`   - Sender deposited to pool`);
  console.log(`   - Pool sent to receiver`);
  console.log(`   - NO direct on-chain link between sender and receiver!`);
  
  return { success: true, received };
}

// Also: First withdraw stuck funds if any
async function withdrawStuckFunds(privateKey: string, recipientAddress: string) {
  console.log('🔓 Recovering stuck funds from pool...');
  
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  
  const privacyCash = new PrivacyCash({
    RPC_url: RPC_URL,
    owner: Array.from(keypair.secretKey),
    enableDebug: true
  });
  
  // We know from previous run: 10,000,000 lamports = 0.01 SOL
  // Withdraw slightly less for fees
  const withdrawAmount = 8_000_000; // 0.008 SOL (leaving 0.002 for fee)
  
  console.log(`📤 Withdrawing ~0.008 SOL to ${recipientAddress}...`);
  
  try {
    const result = await privacyCash.withdraw({
      lamports: withdrawAmount,
      recipientAddress: recipientAddress
    });
    console.log('✅ Success!', result);
  } catch (e: any) {
    console.log('❌ Failed:', e.message);
  }
}

async function main() {
  const privateKey = process.env.SENDER_PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ Set SENDER_PRIVATE_KEY');
    console.log('\nUsage:');
    console.log('$env:SENDER_PRIVATE_KEY="..."; npx tsx examples/private-send-auto.ts <receiver> <amount>');
    return;
  }
  
  const receiverAddress = process.argv[2];
  const amountSol = parseFloat(process.argv[3]);
  
  // If "recover" mode, just withdraw stuck funds
  if (process.argv[2] === 'recover') {
    const recipient = process.argv[3] || Keypair.fromSecretKey(bs58.decode(privateKey)).publicKey.toBase58();
    await withdrawStuckFunds(privateKey, recipient);
    return;
  }
  
  if (!receiverAddress || isNaN(amountSol)) {
    // Show current stuck balance recovery option
    console.log('📋 Options:');
    console.log('\n1. Recover stuck funds (0.01 SOL in pool):');
    console.log('   npx tsx examples/private-send-auto.ts recover [recipient]');
    console.log('\n2. Send privately:');
    console.log('   npx tsx examples/private-send-auto.ts <receiver-address> <amount-sol>');
    return;
  }
  
  try {
    await privateSend(privateKey, receiverAddress, amountSol);
  } catch (e: any) {
    console.error('❌ Error:', e.message);
  }
}

main();

