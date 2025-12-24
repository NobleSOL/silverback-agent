/**
 * x402 Test Payment Script
 *
 * Makes a real USDC payment to trigger Bazaar discovery cataloging.
 * This script uses your wallet to pay for a $0.02 swap-quote endpoint.
 *
 * Usage: npx ts-node src/x402/make-payment.ts
 *
 * Required env vars:
 *   - WALLET_PRIVATE_KEY or ACP_PRIVATE_KEY (for signing payments)
 *   - X402_SERVICE_URL (optional, defaults to https://x402.silverbackdefi.app)
 */

import dotenv from 'dotenv';
// @ts-ignore
import { wrapFetchWithPayment, x402Client } from '@x402/fetch';
// @ts-ignore
import { registerExactEvmScheme } from '@x402/evm/exact/client';
import { privateKeyToAccount } from 'viem/accounts';

dotenv.config();

const X402_SERVICE_URL = process.env.X402_SERVICE_URL || 'https://x402.silverbackdefi.app';
const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY || process.env.ACP_PRIVATE_KEY || process.env.SWAP_EXECUTOR_PRIVATE_KEY;

async function main() {
    console.log('🦍 x402 Test Payment\n');
    console.log('='.repeat(50));

    if (!PRIVATE_KEY) {
        console.error('❌ Missing wallet private key');
        console.error('   Set WALLET_PRIVATE_KEY, ACP_PRIVATE_KEY, or SWAP_EXECUTOR_PRIVATE_KEY');
        process.exit(1);
    }

    // Format private key
    let pk = PRIVATE_KEY.trim();
    if (!pk.startsWith('0x')) {
        pk = `0x${pk}`;
    }

    console.log(`\n📍 Service: ${X402_SERVICE_URL}`);

    try {
        // Create EVM signer from private key
        const signer = privateKeyToAccount(pk as `0x${string}`);
        console.log(`💳 Wallet: ${signer.address}`);

        // Create x402 client and register EVM scheme for Base
        const client = new x402Client();
        registerExactEvmScheme(client, { signer });

        // Wrap fetch with x402 payment handling
        const x402Fetch = wrapFetchWithPayment(fetch, client);

        console.log('\n💰 Making paid request to /api/v1/swap-quote ($0.02)...\n');

        // Make the paid request
        const response = await x402Fetch(`${X402_SERVICE_URL}/api/v1/swap-quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tokenIn: '0x4200000000000000000000000000000000000006',  // WETH
                tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
                amountIn: '1.0'
            })
        });

        console.log(`   Status: ${response.status}`);

        if (response.ok) {
            const data = await response.json();
            console.log('\n✅ Payment successful! Service responded:\n');
            console.log(JSON.stringify(data, null, 2));
            console.log('\n🎉 Your service should now be cataloged in Bazaar!');
            console.log('   Run "npm run x402:test-discovery" to verify.\n');
        } else if (response.status === 402) {
            console.log('\n⚠️  Still getting 402 - payment may have failed');
            const text = await response.text();
            console.log('   Response:', text.substring(0, 500));
            console.log('\n   Possible issues:');
            console.log('   - Insufficient USDC balance in wallet');
            console.log('   - USDC not approved for x402 facilitator');
            console.log('   - Network/RPC issues');
        } else {
            console.log(`\n⚠️  Unexpected response: ${response.status}`);
            const text = await response.text();
            console.log('   Response:', text.substring(0, 500));
        }

    } catch (err: any) {
        console.error('\n❌ Error:', err.message);
        if (err.message?.includes('insufficient')) {
            console.log('\n   💡 Make sure your wallet has USDC on Base');
            console.log('   Wallet needs at least $0.02 USDC + gas');
        }
    }

    console.log('='.repeat(50));
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
