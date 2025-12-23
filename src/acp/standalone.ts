/**
 * Standalone ACP Worker Service
 *
 * Dedicated background worker for processing ACP jobs.
 * Runs independently of the main Twitter/GAME agent for better scalability.
 *
 * Start with: npm run start:acp
 */

import { initializeAcp, isAcpConfigured, getAcpPlugin, getAcpClient } from './index';
import { getQueueStats } from './job-queue';
import dotenv from 'dotenv';

dotenv.config();

// Configuration
const ACP_POLL_INTERVAL_MS = parseInt(process.env.ACP_POLL_INTERVAL_MS || '10000'); // 10 seconds
const MAX_CONSECUTIVE_ERRORS = parseInt(process.env.MAX_ERRORS || '10');

async function main() {
    console.log("🦍 Silverback ACP Worker Starting...\n");

    // Check configuration
    if (!isAcpConfigured()) {
        console.error("❌ ACP not configured. Required environment variables:");
        console.error("   Core:");
        console.error("   - ACP_AGENT_WALLET_ADDRESS (smart account)");
        console.error("   - ACP_PRIVATE_KEY or WHITELISTED_WALLET_PRIVATE_KEY");
        console.error("   - ACP_ENTITY_ID");
        console.error("   - API_KEY (GAME API key)");
        console.error("");
        console.error("   For Swap Execution:");
        console.error("   - ACP_SWAP_WALLET_ADDRESS (EOA for receiving funds)");
        console.error("   - SWAP_EXECUTOR_PRIVATE_KEY (private key for swap wallet)");
        process.exit(1);
    }

    // Log configuration status
    const swapWallet = process.env.ACP_SWAP_WALLET_ADDRESS || process.env.ACP_AGENT_WALLET_ADDRESS;
    const hasSwapKey = !!(process.env.SWAP_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ACP_PRIVATE_KEY);
    const hasCdpApi = !!(process.env.CDP_API_KEY && process.env.CDP_API_SECRET);

    console.log("📋 Configuration:");
    console.log(`   Agent Wallet: ${process.env.ACP_AGENT_WALLET_ADDRESS}`);
    console.log(`   Swap Wallet: ${swapWallet}`);
    console.log(`   Swap Key: ${hasSwapKey ? '✅ configured' : '❌ missing'}`);
    console.log(`   Entity ID: ${process.env.ACP_ENTITY_ID}`);
    console.log(`   Cluster: ${process.env.ACP_CLUSTER || 'defi'}`);
    console.log(`   CDP API: ${hasCdpApi ? '✅ configured (swaps via CDP)' : '⚠️ missing (will use OpenOcean fallback)'}\n`);

    // Initialize ACP
    console.log("🔗 Initializing ACP...");
    const acpPlugin = await initializeAcp();

    if (!acpPlugin) {
        console.error("❌ Failed to initialize ACP plugin");
        process.exit(1);
    }

    console.log("✅ ACP Worker initialized successfully!");
    console.log(`🔄 Polling interval: ${ACP_POLL_INTERVAL_MS / 1000}s\n`);

    // Main polling loop
    let consecutiveErrors = 0;
    let pollCount = 0;

    while (true) {
        try {
            pollCount++;

            // Get ACP state and check for jobs
            const acpState = await acpPlugin.getAcpState();

            // Extract job counts
            const sellerJobs = acpState.jobs?.active?.asASeller || [];
            const buyerJobs = acpState.jobs?.active?.asABuyer || [];
            const queueStats = await getQueueStats();

            // Log status periodically (every 6 polls = ~1 minute at 10s interval)
            if (pollCount % 6 === 0 || sellerJobs.length > 0) {
                console.log(`📊 [Poll ${pollCount}] Active: ${sellerJobs.length} seller, ${buyerJobs.length} buyer | Queue: ${queueStats.processing} processing, ${queueStats.pending} pending`);
            }

            // Process any pending seller jobs
            if (sellerJobs.length > 0) {
                for (const job of sellerJobs) {
                    const j = job as any;
                    const jobId = j.id || j.jobId;
                    const phase = j.phase;

                    console.log(`   📥 Job ${jobId}: phase=${phase}`);

                    // Jobs are handled by the onNewTask callback in initializeAcp
                    // Just log that we see them here for monitoring
                }
            }

            // Reset error counter on success
            consecutiveErrors = 0;

            // Wait before next poll
            await new Promise(r => setTimeout(r, ACP_POLL_INTERVAL_MS));

        } catch (error: any) {
            consecutiveErrors++;
            console.error(`⚠️ Poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, error.message);

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error("❌ Too many consecutive errors, shutting down");
                process.exit(1);
            }

            // Exponential backoff on errors
            const waitTime = Math.min(60000, 5000 * consecutiveErrors);
            console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
            await new Promise(r => setTimeout(r, waitTime));
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log("\n🛑 Shutting down ACP worker...");
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log("\n🛑 Received SIGTERM, shutting down...");
    process.exit(0);
});

// Start the worker
main().catch(error => {
    console.error("❌ Fatal error:", error);
    process.exit(1);
});
