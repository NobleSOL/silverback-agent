import { createSilverbackAgent } from './agent';
import { stateManager } from './state/state-manager';
import { initializeAcp, isAcpConfigured, getAcpPlugin } from './acp';
import { startX402Server, isX402Configured } from './x402';
import { GameWorker } from '@virtuals-protocol/game';

// Rate limiting configuration - IMPORTANT: Keep this high to avoid tweet spam
const STEP_INTERVAL_MS = parseInt(process.env.STEP_INTERVAL_MS || '300000'); // Default: 5 minutes between steps
const MAX_CONSECUTIVE_ERRORS = parseInt(process.env.MAX_ERRORS || '5');

async function main() {
    try {
        console.log("🦍 Initializing Silverback...\n");

        // Load state before agent starts
        console.log("📊 Loading agent state...");
        await stateManager.load();
        const state = stateManager.getState();
        console.log(`   Phase: ${state.phase}`);
        console.log(`   Total Trades: ${state.metrics.totalTrades}`);
        console.log(`   Win Rate: ${(state.metrics.winRate * 100).toFixed(1)}%`);
        console.log(`   Total PnL: $${state.metrics.totalPnL.toFixed(2)}\n`);

        // Start x402 server if configured
        if (isX402Configured()) {
            startX402Server();
        }

        // Initialize ACP if configured and get worker
        let acpWorker: GameWorker | undefined;
        if (isAcpConfigured()) {
            console.log("🔗 ACP credentials detected, initializing...");
            const acpPlugin = await initializeAcp();
            if (acpPlugin) {
                acpWorker = acpPlugin.getWorker({
                    getEnvironment: async () => ({
                        silverback_services: [
                            { name: "getSwapQuote", price: "$0.02 USDC", description: "Get optimal swap route with price impact" },
                            { name: "getPoolAnalysis", price: "$0.10 USDC", description: "Comprehensive liquidity pool analysis" },
                            { name: "getTechnicalAnalysis", price: "$0.25 USDC", description: "Full TA with indicators and patterns" },
                            { name: "executeSwap", price: "$0.50 USDC", description: "Execute swap on Silverback DEX" }
                        ],
                        chains_supported: ["Base", "Keeta"],
                        dex_url: "https://silverbackdefi.app",
                        router: "0x565cBf0F3eAdD873212Db91896e9a548f6D64894"
                    })
                });
                console.log("📦 ACP worker created successfully");
            }
        } else {
            console.log("ℹ️  ACP not configured - skipping ACP integration");
            console.log("   To enable: Set ACP_AGENT_WALLET_ADDRESS, ACP_PRIVATE_KEY, ACP_ENTITY_ID\n");
        }

        // Create the agent with ACP worker if available
        const silverback_agent = createSilverbackAgent(acpWorker);

        // Initialize the agent with retry for rate limits
        let initRetries = 0;
        while (initRetries < 3) {
            try {
                await silverback_agent.init();
                break;
            } catch (initError: any) {
                initRetries++;
                if (initError.message?.includes('Too Many Requests') || initError.message?.includes('429')) {
                    const waitTime = 60000 * initRetries; // 1 min, 2 min, 3 min
                    console.log(`⏳ Rate limited during init, waiting ${waitTime/1000}s (attempt ${initRetries}/3)...`);
                    await new Promise(r => setTimeout(r, waitTime));
                } else {
                    throw initError;
                }
            }
        }

        console.log("✅ Silverback initialized successfully!");
        console.log(`🔄 Running with ${STEP_INTERVAL_MS/1000}s interval between steps...`);
        if (acpWorker) {
            console.log("🔗 ACP Provider mode: ACTIVE - Ready to accept jobs\n");
        } else {
            console.log("")
        }

        // ACP polling interval - check for jobs every 30 seconds when ACP is enabled
        const ACP_POLL_INTERVAL_MS = 30000;

        // Run the agent with rate limiting and retry logic
        let consecutiveErrors = 0;
        let stepCount = 0;
        let lastFullStep = Date.now();

        while (true) {
            try {
                const now = Date.now();
                const timeSinceLastStep = now - lastFullStep;

                // Check if ACP has pending jobs - if so, run a quick step
                let hasAcpJobs = false;
                if (acpWorker) {
                    try {
                        const acpPlugin = getAcpPlugin();
                        if (acpPlugin) {
                            console.log(`🔍 Polling ACP for jobs...`);
                            const acpState = await acpPlugin.getAcpState();

                            // Log ACP state for debugging
                            const sellerJobs = acpState.jobs?.active?.asASeller || [];
                            const buyerJobs = acpState.jobs?.active?.asABuyer || [];
                            const completedJobs = acpState.jobs?.completed || [];
                            const cancelledJobs = acpState.jobs?.cancelled || [];
                            console.log(`   Active: ${sellerJobs.length} seller, ${buyerJobs.length} buyer | Completed: ${completedJobs.length} | Cancelled: ${cancelledJobs.length}`);

                            if (sellerJobs.length > 0) {
                                console.log(`   Seller jobs:`, sellerJobs.map((j: any) => ({ id: j.id, phase: j.phase, service: j.serviceRequirement?.substring(0, 50) })));
                            }
                            hasAcpJobs = sellerJobs.length > 0;
                        }
                    } catch (acpErr) {
                        console.log(`⚠️ ACP state check error:`, acpErr);
                    }
                }

                // Run step if: time for scheduled step OR we have ACP jobs waiting
                if (timeSinceLastStep >= STEP_INTERVAL_MS || hasAcpJobs) {
                    stepCount++;
                    console.log(`\n📍 Step ${stepCount} starting...${hasAcpJobs ? ' (ACP job trigger)' : ''}`);
                    await silverback_agent.step({ verbose: true });
                    consecutiveErrors = 0;
                    lastFullStep = Date.now();

                    // Normal wait after step
                    if (!hasAcpJobs) {
                        console.log(`⏳ Waiting ${STEP_INTERVAL_MS/1000}s before next step...`);
                    }
                }

                // Wait before next check - shorter if ACP is active
                const waitTime = acpWorker ? ACP_POLL_INTERVAL_MS : STEP_INTERVAL_MS;
                await new Promise(r => setTimeout(r, hasAcpJobs ? 5000 : waitTime));
            } catch (stepError: any) {
                consecutiveErrors++;
                const isRateLimit = stepError.message?.includes('Too Many Requests') || stepError.message?.includes('429');

                console.error(`\n⚠️  Step error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}):`, stepError.message || stepError);

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    console.error("❌ Too many consecutive errors, shutting down");
                    throw stepError;
                }

                // Wait before retry (longer for rate limits)
                const baseWait = isRateLimit ? 60000 : 5000; // 60s for rate limits, 5s for others
                const waitTime = Math.min(300000, baseWait * consecutiveErrors);
                console.log(`⏳ Waiting ${waitTime/1000}s before retry...${isRateLimit ? ' (rate limited)' : ''}\n`);
                await new Promise(r => setTimeout(r, waitTime));
            }
        }
    } catch (error) {
        console.error("❌ Error running Silverback:", error);
        // Close database connection before exiting
        stateManager.close();
        process.exit(1);
    }
}

main(); 