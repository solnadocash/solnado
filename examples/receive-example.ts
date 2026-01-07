/**
 * Example: Receiving SOL Privately
 * 
 * This demonstrates how the receiver automatically gets their shielded balance.
 * Run with: npx tsx examples/receive-example.ts
 */

import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ReceiverScanner } from '../src/scanner/index.js';

async function main() {
  console.log('🔐 Solana Private Receive Example\n');
  
  // In a real app, load this from the wallet
  const walletKeypair = Keypair.generate();
  console.log('Wallet (demo):', walletKeypair.publicKey.toBase58());
  
  // Create the scanner
  console.log('\n🔍 Starting scanner...');
  const scanner = new ReceiverScanner(walletKeypair, {
    pollInterval: 3000, // Check every 3 seconds
  });
  
  // Listen for events
  scanner.on((event) => {
    switch (event.type) {
      case 'new_note':
        console.log(`\n💰 NEW FUNDS RECEIVED!`);
        console.log(`   Amount: ${Number(event.note.amount) / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Commitment: ${event.note.commitment.slice(0, 16)}...`);
        console.log(`\n   ✓ Automatically added to your shielded balance`);
        console.log(`   ✓ No withdraw action needed!`);
        break;
        
      case 'balance_updated':
        console.log(`\n📊 Balance Updated:`);
        console.log(`   Available: ${Number(event.balance.availableBalance) / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Notes: ${event.balance.notes.length}`);
        break;
        
      case 'error':
        console.error(`\n❌ Scanner error:`, event.error.message);
        break;
    }
  });
  
  // Start scanning
  await scanner.start();
  
  // Show initial balance
  const initialBalance = scanner.getBalance();
  console.log(`\nInitial shielded balance: ${Number(initialBalance.availableBalance) / LAMPORTS_PER_SOL} SOL`);
  console.log('\nWaiting for incoming private transactions...');
  console.log('(Press Ctrl+C to stop)\n');
  
  // Keep running
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping scanner...');
    scanner.stop();
    process.exit(0);
  });
}

main().catch(console.error);

