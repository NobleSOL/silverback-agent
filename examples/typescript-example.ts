/**
 * Silverback DEX Intelligence API - TypeScript Example
 *
 * This example shows how to use the Silverback API with the SDK
 * and with raw fetch for x402 payment handling.
 */

// Using the SDK (when published to npm)
// import { SilverbackClient, BASE_TOKENS } from '@silverback/defi-client';

const BASE_URL = 'https://x402.silverbackdefi.app';

// Common Base token addresses
const BASE_TOKENS = {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    BACK: '0x558881c4959e9cf961a7E1815FCD6586906babd2',
};

/**
 * Example 1: Free Endpoints (No Payment Required)
 */
async function freeEndpointsExample() {
    console.log('=== FREE ENDPOINTS ===\n');

    // Health check
    const health = await fetch(`${BASE_URL}/health`).then(r => r.json());
    console.log('Health:', health);

    // Get pricing info
    const pricing = await fetch(`${BASE_URL}/api/v1/pricing`).then(r => r.json());
    console.log('\nService:', pricing.service);
    console.log('Endpoints:', pricing.endpoints.length, 'paid,', pricing.freeEndpoints.length, 'free');

    // Get token price (FREE)
    const btcPrice = await fetch(`${BASE_URL}/api/v1/price/bitcoin`).then(r => r.json());
    console.log('\nBitcoin Price:', btcPrice.data?.price?.usd ? `$${btcPrice.data.price.usd}` : 'Error');
}

/**
 * Example 2: Paid Endpoints (Require x402 Payment)
 *
 * These will return 402 Payment Required with payment details.
 * You need an x402-compatible wallet/client to complete payment.
 */
async function paidEndpointsExample() {
    console.log('\n=== PAID ENDPOINTS ===\n');

    // Swap Quote ($0.02)
    console.log('Requesting swap quote (WETH -> USDC)...');
    const quoteResponse = await fetch(`${BASE_URL}/api/v1/swap-quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            tokenIn: BASE_TOKENS.WETH,
            tokenOut: BASE_TOKENS.USDC,
            amountIn: '1.0'
        })
    });

    if (quoteResponse.status === 402) {
        console.log('Payment Required (402)');
        const paymentDetails = await quoteResponse.json();
        console.log('Payment Details:', JSON.stringify(paymentDetails, null, 2));
        console.log('\nTo complete this request:');
        console.log('1. Pay', paymentDetails.price || '$0.02', 'USDC on Base');
        console.log('2. Include payment proof in x-payment header');
        console.log('3. Retry the request');
    } else {
        const quote = await quoteResponse.json();
        console.log('Swap Quote:', quote);
    }
}

/**
 * Example 3: Using x402 client library (coming soon)
 *
 * This shows how the flow will work with automatic payments.
 */
async function x402ClientExample() {
    console.log('\n=== X402 CLIENT EXAMPLE (Pseudocode) ===\n');

    console.log(`
// Install x402 client
// npm install x402

import { wrapFetch } from 'x402';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';

// Create wallet for payments
const account = privateKeyToAccount(process.env.PRIVATE_KEY as \`0x\${string}\`);
const wallet = createWalletClient({
    account,
    chain: base,
    transport: http()
});

// Wrap fetch with x402 payment handling
const x402Fetch = wrapFetch(fetch, wallet);

// Now all paid requests are handled automatically!
const quote = await x402Fetch('${BASE_URL}/api/v1/swap-quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        tokenIn: '${BASE_TOKENS.WETH}',
        tokenOut: '${BASE_TOKENS.USDC}',
        amountIn: '1.0'
    })
}).then(r => r.json());

console.log('Quote received:', quote);
// Payment was automatically made in USDC on Base!
`);
}

/**
 * Example 4: Technical Analysis
 */
async function technicalAnalysisExample() {
    console.log('\n=== TECHNICAL ANALYSIS EXAMPLE ===\n');

    const response = await fetch(`${BASE_URL}/api/v1/technical-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: 'bitcoin',
            timeframe: '7'
        })
    });

    if (response.status === 402) {
        console.log('Payment of $0.25 USDC required');
        console.log('After payment, you would receive:');
        console.log({
            success: true,
            rsi: 55.2,
            trend: 'bullish',
            momentum: 'positive',
            recommendation: 'HOLD',
            indicators: {
                sma20: 95000,
                sma50: 92000,
                macd: { signal: 'bullish' },
                bollingerBands: { position: 'middle' }
            }
        });
    } else {
        const analysis = await response.json();
        console.log('Technical Analysis:', analysis);
    }
}

/**
 * Example 5: Yield Opportunities
 */
async function yieldExample() {
    console.log('\n=== YIELD OPPORTUNITIES EXAMPLE ===\n');

    const response = await fetch(`${BASE_URL}/api/v1/defi-yield`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            token: 'USDC',
            riskTolerance: 'medium'
        })
    });

    if (response.status === 402) {
        console.log('Payment of $0.05 USDC required');
        console.log('After payment, you would receive yield opportunities for USDC on Base');
    } else {
        const yields = await response.json();
        console.log('Yield Opportunities:', yields);
    }
}

// Run examples
async function main() {
    try {
        await freeEndpointsExample();
        await paidEndpointsExample();
        await x402ClientExample();
        await technicalAnalysisExample();
        await yieldExample();

        console.log('\n=== SUMMARY ===');
        console.log('API Docs: https://x402.silverbackdefi.app/api-docs');
        console.log('OpenAPI Spec: https://x402.silverbackdefi.app/api/v1/openapi.json');
        console.log('Payment: USDC on Base chain');
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
