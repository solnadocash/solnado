/**
 * Example: Sending SOL Privately
 * 
 * This demonstrates the complete flow for sending SOL privately.
 * Run with: npx tsx examples/send-example.ts
 */

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { PrivateSendClient } from '../src/client/PrivateSend.js';

async function main() {
  console.log('🔐 Solana Private Send Example\n');
  
  // In a real app, load this from secure storage or wallet adapter
  const senderKeypair = Keypair.generate();
  console.log('Sender (demo):', senderKeypair.publicKey.toBase58());
  
  // The receiver's normal Solana wallet address
  const receiverAddress = 'DemoReceiverAddress111111111111111111111111';
  
  // Create the private send client
  const client = new PrivateSendClient();
  
  // Estimate the cost first
  const estimate = client.estimateCost(1.5);
  console.log('\n📊 Cost Estimate:');
  console.log(`   Amount: ${estimate.amount} SOL`);
  console.log(`   Fee:    ${estimate.relayerFee} SOL`);
  console.log(`   Total:  ${estimate.total} SOL`);
  
  // Send privately
  console.log('\n📤 Sending 1.5 SOL privately...');
  
  const result = await client.send(
    senderKeypair,
    1.5,
    receiverAddress
  );
  
  if (result.success) {
    console.log('\n✅ Success!');
    console.log(`   Transaction: ${result.transactionSignature}`);
    console.log(`   Commitment:  ${result.commitment}`);
    console.log('\n   The receiver will see this in their shielded balance.');
    console.log('   They do NOT need to click withdraw - it appears automatically!');
  } else {
    console.log('\n❌ Failed:', result.error);
  }
}

main().catch(console.error);

