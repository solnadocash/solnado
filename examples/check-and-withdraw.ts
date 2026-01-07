/**
 * Check Shielded Balance and Withdraw
 * 
 * Use this to recover stuck funds from the shielded pool.
 * 
 * Run with:
 * $env:SENDER_PRIVATE_KEY="your-key"; npx tsx examples/check-and-withdraw.ts [recipient-address]
 */

import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
// @ts-ignore
import { PrivacyCash } from 'privacycash';

const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

async function main() {
  const privateKey = process.env.SENDER_PRIVATE_KEY;
  if (!privateKey) {
    console.log('❌ Set SENDER_PRIVATE_KEY environment variable');
    return;
  }
  
  const keypair = Keypair.fromSecretKey(bs58.decode(privateKey));
  console.log('🔐 Check & Withdraw Shielded Balance');
  console.log('='.repeat(60));
  console.log(`\n👛 Wallet: ${keypair.publicKey.toBase58()}`);
  
  // Check public balance
  const connection = new Connection(RPC_URL, 'confirmed');
  const publicBalance = await connection.getBalance(keypair.publicKey);
  console.log(`💰 Public Balance: ${publicBalance / LAMPORTS_PER_SOL} SOL`);
  
  // Initialize PrivacyCash
  console.log('\n📦 Initializing PrivacyCash...');
  const privacyCash = new PrivacyCash({
    RPC_url: RPC_URL,
    owner: Array.from(keypair.secretKey),
    enableDebug: true
  });
  
  // Check shielded balance
  console.log('\n💰 Checking shielded balance...');
  try {
    const shieldedBalance = await privacyCash.getPrivateBalance();
    console.log(`🔒 Shielded Balance: ${shieldedBalance / LAMPORTS_PER_SOL} SOL`);
    
    if (shieldedBalance === 0) {
      console.log('\n✅ No funds in shielded pool.');
      return;
    }
    
    // Get recipient address (default to self)
    const recipientAddress = process.argv[2] || keypair.publicKey.toBase58();
    console.log(`\n📬 Recipient: ${recipientAddress}`);
    
    // Withdraw all
    console.log(`\n📤 Withdrawing ${shieldedBalance / LAMPORTS_PER_SOL} SOL...`);
    
    const result = await privacyCash.withdraw({
      lamports: shieldedBalance,
      recipientAddress: recipientAddress
    });
    
    console.log('\n✅ Withdraw successful!');
    console.log(`   Amount: ${result.amount_in_lamports / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Fee: ${result.fee_in_lamports / LAMPORTS_PER_SOL} SOL`);
    
    // Verify
    await new Promise(r => setTimeout(r, 2000));
    const newBalance = await connection.getBalance(new PublicKey(recipientAddress));
    console.log(`\n💰 Recipient balance: ${newBalance / LAMPORTS_PER_SOL} SOL`);
    
  } catch (e: any) {
    console.log(`\n❌ Error: ${e.message}`);
    console.log(e);
  }
}

main();

