/**
 * Patch for PrivacyCash SDK - fixes ALT lookup issue in @solana/web3.js 1.98.x
 * The getAddressLookupTable() method returns null even when ALT exists.
 * This patch uses getAccountInfo() + manual deserialization instead.
 */

import { AddressLookupTableAccount } from '@solana/web3.js';
import { logger } from './logger.js';

/**
 * Helper function to use an existing ALT (patched for web3.js 1.98.x)
 * Use create_alt.ts to create the ALT once, then hardcode the address and use this function
 */
export async function useExistingALT(connection, altAddress) {
    logger.debug(`Using existing ALT: ${altAddress.toString()}`);
    
    // Use getAccountInfo instead of broken getAddressLookupTable
    const accountInfo = await connection.getAccountInfo(altAddress);
    
    if (!accountInfo) {
        logger.debug('❌ ALT account not found');
        return { context: {}, value: null };
    }
    
    try {
        const state = AddressLookupTableAccount.deserialize(accountInfo.data);
        const alt = new AddressLookupTableAccount({
            key: altAddress,
            state: state
        });
        logger.debug(`✅ ALT found with ${alt.state.addresses.length} addresses`);
        return { context: {}, value: alt };
    } catch (e) {
        logger.debug(`❌ Failed to deserialize ALT: ${e.message}`);
        return { context: {}, value: null };
    }
}

