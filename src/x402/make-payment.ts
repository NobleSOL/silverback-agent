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

        // Define all endpoints to test (updated pricing)
        const endpoints = [
            {
                name: 'swap-quote',
                path: '/api/v1/swap-quote',
                method: 'POST',
                price: '$0.01',
                body: {
                    tokenIn: '0x4200000000000000000000000000000000000006',  // WETH
                    tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
                    amountIn: '1.0'
                }
            },
            {
                name: 'top-pools',
                path: '/api/v1/top-pools?limit=5',
                method: 'GET',
                price: '$0.01',
                body: null
            },
            {
                name: 'top-protocols',
                path: '/api/v1/top-protocols?limit=5&chain=base',
                method: 'GET',
                price: '$0.01',
                body: null
            },
            {
                name: 'top-coins',
                path: '/api/v1/top-coins?limit=5',
                method: 'GET',
                price: '$0.01',
                body: null
            },
            {
                name: 'defi-yield',
                path: '/api/v1/defi-yield',
                method: 'POST',
                price: '$0.02',
                body: { token: 'USDC', riskTolerance: 'medium' }
            },
            {
                name: 'pool-analysis',
                path: '/api/v1/pool-analysis',
                method: 'POST',
                price: '$0.02',
                body: { tokenA: '0x4200000000000000000000000000000000000006', tokenB: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }
            },
            {
                name: 'lp-analysis',
                path: '/api/v1/lp-analysis',
                method: 'POST',
                price: '$0.02',
                body: { tokenPair: 'USDC/WETH' }
            },
            {
                name: 'technical-analysis',
                path: '/api/v1/technical-analysis',
                method: 'POST',
                price: '$0.25',
                body: { token: 'bitcoin', timeframe: '7' }
            },
            {
                name: 'dex-metrics',
                path: '/api/v1/dex-metrics',
                method: 'GET',
                price: '$0.05',
                body: null
            },
            {
                name: 'swap',
                path: '/api/v1/swap',
                method: 'POST',
                price: '$0.50',
                body: {
                    tokenIn: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', // USDC
                    tokenOut: '0x4200000000000000000000000000000000000006', // WETH
                    amountIn: '0.01',  // Small amount for testing
                    slippage: '1.0'
                }
            }
        ];

        let successCount = 0;
        let totalSpent = 0;

        for (const endpoint of endpoints) {
            console.log(`\n💰 [${endpoint.name}] ${endpoint.method} ${endpoint.path} (${endpoint.price})...`);

            try {
                const options: RequestInit = {
                    method: endpoint.method,
                    headers: { 'Content-Type': 'application/json' }
                };

                if (endpoint.body) {
                    options.body = JSON.stringify(endpoint.body);
                }

                const response = await x402Fetch(`${X402_SERVICE_URL}${endpoint.path}`, options);

                console.log(`   Status: ${response.status}`);

                if (response.ok) {
                    const data = await response.json();
                    // Show aggregator for swap-quote
                    if (endpoint.name === 'swap-quote' && data.data?.aggregator) {
                        console.log(`   ✅ Success! Aggregator: ${data.data.aggregator}`);
                    } else {
                        console.log(`   ✅ Success! Got ${JSON.stringify(data).length} bytes`);
                    }
                    successCount++;
                    // Parse price string like "$0.02" to number
                    totalSpent += parseFloat(endpoint.price.replace('$', ''));
                } else if (response.status === 402) {
                    console.log('   ⚠️  Still 402 - payment failed');
                } else {
                    console.log(`   ⚠️  Unexpected: ${response.status}`);
                }
            } catch (err: any) {
                console.log(`   ❌ Error: ${err.message}`);
            }

            // Small delay between requests
            await new Promise(r => setTimeout(r, 1000));
        }

        console.log('\n' + '='.repeat(50));
        console.log(`\n🎉 Completed ${successCount}/${endpoints.length} payments`);
        console.log(`💵 Total spent: $${totalSpent.toFixed(2)} USDC`);
        console.log('\n   Run "npm run x402:test-discovery" to check Bazaar indexing.\n');

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
