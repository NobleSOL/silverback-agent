/**
 * x402 Discovery Test Script
 *
 * This script:
 * 1. Makes a test payment to trigger facilitator cataloging
 * 2. Queries the Bazaar discovery endpoint to verify listing
 *
 * Usage: npx ts-node src/x402/test-discovery.ts
 */

import dotenv from 'dotenv';
import { SignJWT } from 'jose';
import * as crypto from 'crypto';

dotenv.config();

const X402_SERVICE_URL = process.env.X402_SERVICE_URL || 'https://x402.silverbackdefi.app';
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

/**
 * Generate CDP JWT for API authentication
 */
async function generateCdpJwt(method: string, host: string, path: string): Promise<string> {
    if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
        throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET required');
    }

    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    let pemKey = CDP_API_KEY_SECRET;
    if (pemKey.includes('\\n')) {
        pemKey = pemKey.replace(/\\n/g, '\n');
    }
    if (!pemKey.includes('-----BEGIN')) {
        pemKey = `-----BEGIN EC PRIVATE KEY-----\n${pemKey}\n-----END EC PRIVATE KEY-----`;
    }

    const keyObject = crypto.createPrivateKey({ key: pemKey, format: 'pem' });

    const jwt = await new SignJWT({
        sub: CDP_API_KEY_ID,
        iss: 'cdp',
        nbf: now,
        exp: now + 120,
        uris: [`${method.toUpperCase()} ${host}${path}`],
    })
        .setProtectedHeader({ alg: 'ES256', kid: CDP_API_KEY_ID, nonce, typ: 'JWT' })
        .sign(keyObject);

    return jwt;
}

/**
 * Query Bazaar discovery endpoint
 */
async function queryDiscovery(): Promise<void> {
    console.log('\n📡 Querying Bazaar discovery endpoint...\n');

    try {
        const host = 'api.cdp.coinbase.com';
        const path = '/platform/v2/x402/discovery/resources';
        const jwt = await generateCdpJwt('GET', host, path);

        const response = await fetch(`https://${host}${path}?type=http&limit=50`, {
            headers: {
                'Authorization': `Bearer ${jwt}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`❌ Discovery query failed: ${response.status}`);
            console.error(text);
            return;
        }

        const data = await response.json();
        console.log(`✅ Found ${data.resources?.length || 0} resources in Bazaar:\n`);

        // Check if our service is listed
        const ourService = data.resources?.find((r: any) =>
            r.url?.includes('silverback') || r.url?.includes(X402_SERVICE_URL)
        );

        if (ourService) {
            console.log('🦍 SILVERBACK SERVICE FOUND:');
            console.log(JSON.stringify(ourService, null, 2));
        } else {
            console.log('⚠️  Silverback service not found in discovery results');
            console.log('\nAll discovered resources:');
            data.resources?.forEach((r: any, i: number) => {
                console.log(`  ${i + 1}. ${r.url} (${r.type})`);
            });
        }

        console.log(`\nTotal: ${data.total || data.resources?.length || 0} resources`);

    } catch (err: any) {
        console.error('❌ Error querying discovery:', err.message);
    }
}

/**
 * Test payment flow to trigger discovery cataloging
 */
async function testPaymentFlow(): Promise<void> {
    console.log('\n💰 Testing x402 payment flow...\n');
    console.log(`   Service URL: ${X402_SERVICE_URL}`);

    try {
        // Step 1: Make unpaid request to get 402 response with payment requirements
        console.log('\n1️⃣  Making unpaid request to get payment requirements...');

        const unpaidResponse = await fetch(`${X402_SERVICE_URL}/api/v1/swap-quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tokenIn: '0x4200000000000000000000000000000000000006',
                tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
                amountIn: '1.0'
            })
        });

        console.log(`   Status: ${unpaidResponse.status}`);

        if (unpaidResponse.status === 402) {
            console.log('   ✅ Got 402 Payment Required (expected)');

            // Parse payment requirements
            const paymentHeader = unpaidResponse.headers.get('x-payment');
            const wwwAuth = unpaidResponse.headers.get('www-authenticate');

            console.log('\n   Payment Requirements:');
            if (paymentHeader) {
                try {
                    const requirements = JSON.parse(paymentHeader);
                    console.log(`   - Scheme: ${requirements.scheme || requirements[0]?.scheme}`);
                    console.log(`   - Network: ${requirements.network || requirements[0]?.network}`);
                    console.log(`   - Price: ${requirements.maxAmountRequired || requirements[0]?.maxAmountRequired}`);
                    console.log(`   - PayTo: ${requirements.payTo || requirements[0]?.payTo}`);
                } catch {
                    console.log(`   - Raw: ${paymentHeader.substring(0, 200)}...`);
                }
            }
            if (wwwAuth) {
                console.log(`   - WWW-Authenticate: ${wwwAuth.substring(0, 100)}...`);
            }

            console.log('\n2️⃣  To complete payment and trigger discovery:');
            console.log('   - Use an x402-enabled client/agent to pay and call the endpoint');
            console.log('   - Or manually construct and sign a payment transaction');
            console.log('   - The facilitator catalogs the service when processing the payment');

        } else if (unpaidResponse.status === 200) {
            console.log('   ⚠️  Got 200 OK - endpoint may not have x402 middleware active');
            const body = await unpaidResponse.json();
            console.log('   Response:', JSON.stringify(body).substring(0, 200));
        } else {
            console.log(`   ⚠️  Unexpected status: ${unpaidResponse.status}`);
            const text = await unpaidResponse.text();
            console.log('   Response:', text.substring(0, 200));
        }

    } catch (err: any) {
        console.error('❌ Error testing payment flow:', err.message);
    }
}

/**
 * Check x402 service health
 */
async function checkHealth(): Promise<boolean> {
    console.log('\n🏥 Checking x402 service health...');

    try {
        const response = await fetch(`${X402_SERVICE_URL}/health`);
        const data = await response.json();

        console.log(`   Status: ${data.status}`);
        console.log(`   Version: ${data.version}`);
        console.log(`   Server Initialized: ${data.serverInitialized}`);
        console.log(`   Wallet Configured: ${data.walletConfigured}`);

        return data.status === 'ok' && data.serverInitialized;
    } catch (err: any) {
        console.error('❌ Health check failed:', err.message);
        return false;
    }
}

/**
 * Main
 */
async function main() {
    console.log('🦍 x402 Discovery Test\n');
    console.log('='.repeat(50));

    // Check requirements
    if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
        console.error('❌ Missing CDP credentials');
        console.error('   Set CDP_API_KEY_ID and CDP_API_KEY_SECRET');
        process.exit(1);
    }

    // Check service health
    const healthy = await checkHealth();
    if (!healthy) {
        console.error('\n⚠️  Service not healthy, discovery test may fail');
    }

    // Test payment flow
    await testPaymentFlow();

    // Query discovery
    await queryDiscovery();

    console.log('\n' + '='.repeat(50));
    console.log('Done!\n');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
