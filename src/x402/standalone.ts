/**
 * Standalone x402 Server Entry Point
 *
 * Run this as a separate service on Render to accept x402 payments.
 *
 * Required env vars:
 *   X402_ENABLED=true
 *   X402_WALLET_ADDRESS=0x...
 *   PORT (Render sets this automatically)
 */

import dotenv from 'dotenv';
dotenv.config();

// Use Render's PORT if available, otherwise X402_PORT, otherwise 3402
if (!process.env.X402_PORT && process.env.PORT) {
    process.env.X402_PORT = process.env.PORT;
}

import { startX402Server, isX402Configured } from './server';

console.log('🦍 Starting Silverback x402 Payment Server...\n');

if (!isX402Configured()) {
    console.error('❌ x402 not configured!');
    console.error('   Required env vars:');
    console.error('   - X402_ENABLED=true');
    console.error('   - X402_WALLET_ADDRESS=0x...');
    process.exit(1);
}

startX402Server();
