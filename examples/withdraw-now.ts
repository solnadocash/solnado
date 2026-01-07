/**
 * Withdraw from PrivacyCash pool - FIXED
 * 
 * The SDK's getPrivateBalance() has a bug returning NaN.
 * But the UTXO is there with 0.01 SOL (10000000 lamports).
 * 
 * Run with:
 * $env:SENDER_PRIVATE_KEY="your-key"; npx tsx examples/withdraw-now.ts <recipient-address>
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
  console.log('🔐 Withdraw from PrivacyCash Pool');
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
  
  // Get recipient address (default to self)
  const recipientAddress = process.argv[2] || keypair.publicKey.toBase58();
  console.log(`\n📬 Recipient: ${recipientAddress}`);
  
  // We KNOW there's 0.01 SOL in the pool from the logs
  // Debug showed: "Total unspent UTXO balance before: 10000000 lamports (0.01 SOL)"
  // Let's withdraw a smaller amount to account for fees
  const withdrawAmountLamports = 9_000_000; // 0.009 SOL (leaving room for fees)
  
  console.log(`\n📤 Withdrawing ${withdrawAmountLamports / LAMPORTS_PER_SOL} SOL...`);
  console.log(`   (Your shielded pool has ~0.01 SOL)`);
  
  try {
    const result = await privacyCash.withdraw({
      lamports: withdrawAmountLamports,
      recipientAddress: recipientAddress
    });
    
    console.log('\n✅ Withdraw successful!');
    console.log(`   TX: ${result?.tx || result?.signature || JSON.stringify(result)}`);
    
    // Verify
    await new Promise(r => setTimeout(r, 3000));
    const newBalance = await connection.getBalance(new PublicKey(recipientAddress));
    console.log(`\n💰 Recipient balance: ${newBalance / LAMPORTS_PER_SOL} SOL`);
    
  } catch (e: any) {
    console.log(`\n❌ Error: ${e.message}`);
    
    // Check if it's the NaN issue
    if (e.message.includes('extAmount') || e.message.includes('fee')) {
      console.log('\n⚠️ The SDK has a bug with amount calculation.');
      console.log('   Trying alternative approach...');
      
      // Try with fee explicitly set
      try {
        const result = await privacyCash.withdraw({
          lamports: withdrawAmountLamports,
          recipientAddress: recipientAddress,
          fee: 1_000_000 // 0.001 SOL fee
        });
        console.log('\n✅ Withdraw successful (with explicit fee)!');
        console.log(`   Result: ${JSON.stringify(result)}`);
      } catch (e2: any) {
        console.log(`   Still failed: ${e2.message}`);
      }
    }
  }
}

main();

