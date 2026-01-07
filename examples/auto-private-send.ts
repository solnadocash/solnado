/**
 * AUTOMATIC Private Send - Deposit + Withdraw in One Flow
 * 
 * This is the CORRECT flow:
 * 1. Deposit SOL to shielded pool (breaks the link)
 * 2. IMMEDIATELY withdraw to receiver's address
 * 
 * Result: Receiver gets SOL automatically, no manual action needed!
 * 
 * Run with:
 * $env:SENDER_PRIVATE_KEY="your-key"; npx tsx examples/auto-private-send.ts
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
// @ts-ignore
import { PrivacyCash } from 'privacycash';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function sendPrivate(
  senderPrivateKey: string,
  receiverAddress: string,
  amountSol: number
) {
  console.log('🔐 Automatic Private Send');
  console.log('='.repeat(60));
  
  const amountLamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
  
  // Initialize sender
  const senderKeypair = Keypair.fromSecretKey(bs58.decode(senderPrivateKey));
  console.log(`\n👛 Sender: ${senderKeypair.publicKey.toBase58()}`);
  console.log(`📬 Receiver: ${receiverAddress}`);
  console.log(`💰 Amount: ${amountSol} SOL`);
  
  // Validate receiver address
  let receiverPubkey: PublicKey;
  try {
    receiverPubkey = new PublicKey(receiverAddress);
  } catch {
    throw new Error('Invalid receiver address');
  }
  
  // Check sender balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const balance = await connection.getBalance(senderKeypair.publicKey);
  console.log(`\n📊 Sender balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  
  // Need amount + fees (~0.01 SOL for deposit + withdraw + relayer)
  const estimatedFees = 15_000_000; // 0.015 SOL for fees
  if (balance < amountLamports + estimatedFees) {
    throw new Error(`Insufficient balance. Need ${(amountLamports + estimatedFees) / LAMPORTS_PER_SOL} SOL`);
  }
  
  // Get receiver's current balance (to verify receipt later)
  const receiverBalanceBefore = await connection.getBalance(receiverPubkey);
  console.log(`📊 Receiver balance before: ${receiverBalanceBefore / LAMPORTS_PER_SOL} SOL`);
  
  // Initialize PrivacyCash SDK
  console.log('\n📦 Initializing PrivacyCash...');
  const privacyCash = new PrivacyCash({
    RPC_url: RPC_URL,
    owner: Array.from(senderKeypair.secretKey),
    enableDebug: true
  });
  
  // STEP 1: Deposit to shielded pool
  console.log('\n' + '─'.repeat(60));
  console.log('📥 STEP 1: Depositing to shielded pool...');
  console.log('   This breaks the on-chain link between sender and receiver.');
  console.log('─'.repeat(60));
  
  try {
    const depositResult = await privacyCash.deposit({
      lamports: amountLamports
    });
    console.log('✅ Deposit successful!');
    console.log(`   TX: ${depositResult?.signature || 'completed'}`);
  } catch (e: any) {
    console.log(`❌ Deposit failed: ${e.message}`);
    throw e;
  }
  
  // Check shielded balance
  console.log('\n💰 Checking shielded balance...');
  const shieldedBalance = await privacyCash.getPrivateBalance();
  console.log(`   Shielded: ${shieldedBalance / LAMPORTS_PER_SOL} SOL`);
  
  if (shieldedBalance < amountLamports) {
    throw new Error('Deposit failed - insufficient shielded balance');
  }
  
  // STEP 2: Withdraw to receiver's address
  console.log('\n' + '─'.repeat(60));
  console.log('📤 STEP 2: Withdrawing to receiver...');
  console.log(`   Recipient: ${receiverAddress}`);
  console.log('   Receiver will get SOL directly - NO action needed from them!');
  console.log('─'.repeat(60));
  
  try {
    const withdrawResult = await privacyCash.withdraw({
      lamports: amountLamports,
      recipientAddress: receiverAddress
    });
    console.log('✅ Withdraw successful!');
    console.log(`   Amount sent: ${withdrawResult.amount_in_lamports / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Relayer fee: ${withdrawResult.fee_in_lamports / LAMPORTS_PER_SOL} SOL`);
  } catch (e: any) {
    console.log(`❌ Withdraw failed: ${e.message}`);
    throw e;
  }
  
  // Verify receiver got the funds
  console.log('\n🔍 Verifying transfer...');
  await new Promise(r => setTimeout(r, 2000)); // Wait for confirmation
  
  const receiverBalanceAfter = await connection.getBalance(receiverPubkey);
  const received = receiverBalanceAfter - receiverBalanceBefore;
  
  console.log(`   Receiver balance after: ${receiverBalanceAfter / LAMPORTS_PER_SOL} SOL`);
  console.log(`   Received: ${received / LAMPORTS_PER_SOL} SOL`);
  
  // Final summary
  console.log('\n' + '='.repeat(60));
  console.log('✅ PRIVATE SEND COMPLETE!');
  console.log('='.repeat(60));
  console.log(`\n   Sender:   ${senderKeypair.publicKey.toBase58()}`);
  console.log(`   Receiver: ${receiverAddress}`);
  console.log(`   Amount:   ${amountSol} SOL`);
  console.log('\n   🔒 Privacy achieved:');
  console.log('   - On-chain: NO direct transfer from sender to receiver');
  console.log('   - Sender deposited to pool, pool sent to receiver');
  console.log('   - Link is broken via the shielded pool');
  
  return {
    success: true,
    amountSent: received,
    senderAddress: senderKeypair.publicKey.toBase58(),
    receiverAddress
  };
}

// Main execution
async function main() {
  const privateKey = process.env.SENDER_PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ Set SENDER_PRIVATE_KEY environment variable');
    console.log('\nUsage:');
    console.log('$env:SENDER_PRIVATE_KEY="your-key"');
    console.log('npx tsx examples/auto-private-send.ts <receiver-address> <amount-sol>');
    return;
  }
  
  // Get receiver and amount from args or use defaults
  const receiverAddress = process.argv[2] || 'DemoAddress111111111111111111111111111111111';
  const amountSol = parseFloat(process.argv[3]) || 0.01;
  
  if (receiverAddress.startsWith('Demo')) {
    // Generate a real receiver for testing
    const receiver = Keypair.generate();
    console.log('📝 No receiver specified, generating test receiver:');
    console.log(`   Address: ${receiver.publicKey.toBase58()}`);
    console.log(`   Private Key: ${bs58.encode(receiver.secretKey)}`);
    console.log('\nRun with:');
    console.log(`npx tsx examples/auto-private-send.ts ${receiver.publicKey.toBase58()} ${amountSol}`);
    return;
  }
  
  try {
    await sendPrivate(privateKey, receiverAddress, amountSol);
  } catch (e: any) {
    console.error('\n❌ Error:', e.message);
  }
}

main();

