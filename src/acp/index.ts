/**
 * ACP Integration Module
 *
 * Integrates Silverback Agent with Virtuals Agent Commerce Protocol (ACP)
 * to enable agent-to-agent commerce and service offerings.
 *
 * Services Offered:
 * 1. Swap Quote ($0.02) - Get optimal swap route with price impact
 * 2. Pool Analysis ($0.10) - Comprehensive liquidity pool analysis
 * 3. Technical Analysis ($0.25) - Full TA with indicators and patterns
 * 4. Execute Swap (Phase 2) - Actual swap execution
 */

import AcpPlugin, { AcpState } from "@virtuals-protocol/game-acp-plugin";
import AcpClient, { AcpContractClient, baseAcpConfig } from "@virtuals-protocol/acp-node";
import { processServiceRequest } from "./services";
import dotenv from "dotenv";

dotenv.config();

// Re-export AcpState type for use in agent.ts
export type { AcpState };

// ACP Configuration from environment
const ACP_AGENT_WALLET_ADDRESS = process.env.ACP_AGENT_WALLET_ADDRESS;
const ACP_PRIVATE_KEY = process.env.ACP_PRIVATE_KEY || process.env.WHITELISTED_WALLET_PRIVATE_KEY;
const ACP_ENTITY_ID = process.env.ACP_ENTITY_ID;
const ACP_CLUSTER = process.env.ACP_CLUSTER || 'defi'; // DeFi cluster for AHF integration

let acpPlugin: AcpPlugin | null = null;
let acpClient: AcpClient | null = null;
let acpInitialized = false;

/**
 * Check if ACP is properly configured
 */
export function isAcpConfigured(): boolean {
    return !!(ACP_AGENT_WALLET_ADDRESS && ACP_PRIVATE_KEY && ACP_ENTITY_ID);
}

/**
 * Initialize the ACP Plugin
 * Call this before initializing the GAME agent
 */
export async function initializeAcp(): Promise<AcpPlugin | null> {
    if (!isAcpConfigured()) {
        console.log("⚠️  ACP not configured - missing environment variables");
        console.log("   Required: ACP_AGENT_WALLET_ADDRESS, ACP_PRIVATE_KEY/WHITELISTED_WALLET_PRIVATE_KEY, ACP_ENTITY_ID");
        console.log("   ACP features will be disabled\n");
        return null;
    }

    if (acpPlugin && acpInitialized) {
        return acpPlugin;
    }

    try {
        console.log("🔗 Initializing ACP integration...");

        // Build the ACP contract client
        // Note: Private key should NOT include the 0x prefix per ACP docs
        let privateKey = ACP_PRIVATE_KEY!.trim();

        // Remove 0x prefix if present
        if (privateKey.startsWith('0x')) {
            privateKey = privateKey.slice(2);
        }

        // Validate private key format
        if (privateKey.length !== 64) {
            console.error(`❌ ACP_PRIVATE_KEY invalid length: ${privateKey.length} chars (expected 64)`);
            console.error(`   First 4 chars: ${privateKey.substring(0, 4)}...`);
            return null;
        }

        if (!/^[a-fA-F0-9]+$/.test(privateKey)) {
            console.error(`❌ ACP_PRIVATE_KEY contains non-hex characters`);
            return null;
        }

        console.log(`   Private key format: OK (64 hex chars)`);
        console.log(`   Entity ID: ${ACP_ENTITY_ID}`);
        console.log(`   Wallet: ${ACP_AGENT_WALLET_ADDRESS}`);

        // Add 0x prefix for the SDK
        const privateKeyWithPrefix = `0x${privateKey}` as `0x${string}`;

        const acpContractClient = await AcpContractClient.build(
            privateKeyWithPrefix,
            parseInt(ACP_ENTITY_ID!, 10),
            ACP_AGENT_WALLET_ADDRESS! as `0x${string}`,
            undefined, // Use default RPC
            baseAcpConfig // Base mainnet
        );

        // Create ACP client with WebSocket callbacks for job notifications
        acpClient = new AcpClient({
            acpContractClient,
            // Called when a new job is assigned to this agent
            onNewTask: async (job: any) => {
                const jobId = job.id || job.jobId;
                const phase = job.phase;
                const memoId = job.memo?.[job.memo?.length - 1]?.id;

                console.log(`\n📥 [ACP WebSocket] Job event!`);
                console.log(`   Job ID: ${jobId}, Phase: ${phase}, MemoId: ${memoId}`);
                console.log(`   Job methods:`, Object.keys(job).filter(k => typeof job[k] === 'function'));

                try {
                    // Get service details - handle various nested structures
                    const desc = job.desc || {};
                    const jobRequirement = desc.requirement || job.serviceRequirement || job.requirement || {};

                    // Service name can be in desc.name or inside the requirement object
                    let serviceName = desc.name || jobRequirement.name || 'unknown';
                    // The actual parameters are in requirement.requirement or just requirement
                    let serviceParams = jobRequirement.requirement || jobRequirement;

                    // If serviceName is still unknown, try to infer from params
                    if (serviceName === 'unknown' && serviceParams.tokenIn && serviceParams.tokenOut) {
                        serviceName = 'getSwapQuote';
                    } else if (serviceName === 'unknown' && serviceParams.tokenA && serviceParams.tokenB) {
                        serviceName = 'getPoolAnalysis';
                    } else if (serviceName === 'unknown' && serviceParams.token) {
                        serviceName = 'getTechnicalAnalysis';
                    }

                    console.log(`   Service: ${serviceName}`);
                    console.log(`   Params: ${JSON.stringify(serviceParams).substring(0, 200)}`);

                    // Phase 0 (REQUEST) - Accept the job
                    if (phase === 0 || phase === 'request') {
                        console.log(`   🔄 Phase 0: Accepting job...`);
                        if (typeof job.respond === 'function') {
                            await job.respond(true);
                            console.log(`   ✅ Job accepted via job.respond()`);
                        } else if (acpClient && memoId) {
                            await (acpClient as any).respondJob(jobId, memoId, true, "Job accepted by Silverback");
                            console.log(`   ✅ Job accepted via acpClient.respondJob()`);
                        } else {
                            console.log(`   ⚠️ Cannot respond - no respond method available`);
                        }
                    }
                    // Phase 2 (TRANSACTION) - Deliver the service
                    else if (phase === 2 || phase === 'transaction') {
                        console.log(`   🔄 Phase 2: Processing and delivering...`);

                        // Process the service request
                        const result = await processServiceRequest(serviceName, JSON.stringify(serviceParams));
                        console.log(`   ✅ Processed: ${result.deliverable?.substring(0, 150)}`);

                        // Deliver the result
                        if (typeof job.deliver === 'function') {
                            await job.deliver(result.deliverable);
                            console.log(`   ✅ Deliverable submitted via job.deliver()`);
                        } else if (acpClient) {
                            await (acpClient as any).deliverJob(jobId, result.deliverable);
                            console.log(`   ✅ Deliverable submitted via acpClient.deliverJob()`);
                        }
                    }
                    else {
                        console.log(`   ℹ️ Phase ${phase} - no action needed from provider`);
                    }
                } catch (err: any) {
                    console.error(`   ❌ Error handling job:`, err.message);
                }
            },
            // Called when we need to evaluate a job (as buyer)
            onEvaluate: async (job: any) => {
                console.log(`\n📋 [ACP WebSocket] Evaluation requested for job ${job.id || job.jobId}`);
            }
        });

        // Create the ACP plugin
        acpPlugin = new AcpPlugin({
            apiKey: process.env.API_KEY!,
            acpClient,
            cluster: ACP_CLUSTER,
            jobExpiryDurationMins: 1440, // 24 hours
            keepCompletedJobs: 10,
            keepCancelledJobs: 5,
            keepProducedInventory: 20
        });

        acpInitialized = true;
        console.log("✅ ACP integration initialized successfully!");
        console.log(`   Wallet: ${ACP_AGENT_WALLET_ADDRESS}`);
        console.log(`   Cluster: ${ACP_CLUSTER}\n`);

        return acpPlugin;

    } catch (error) {
        console.error("❌ Failed to initialize ACP:", error);
        return null;
    }
}

/**
 * Get the ACP plugin instance
 */
export function getAcpPlugin(): AcpPlugin | null {
    return acpPlugin;
}

/**
 * Get the ACP client instance for direct API calls
 */
export function getAcpClient(): AcpClient | null {
    return acpClient;
}

/**
 * Get the ACP worker for the GAME agent
 * Returns null if ACP is not configured
 */
export function getAcpWorker() {
    if (!acpPlugin) {
        return null;
    }

    // Return the worker with custom service functions
    return acpPlugin.getWorker({
        // Additional environment data for the worker
        getEnvironment: async () => {
            return {
                silverback_services: [
                    {
                        name: "Swap Quote",
                        description: "Get optimal swap route with price impact, fees, and expected output",
                        price: "$0.02 USDC",
                        input: "{ tokenIn, tokenOut, amountIn }"
                    },
                    {
                        name: "Pool Analysis",
                        description: "Comprehensive liquidity pool analysis with reserves, APY, health metrics",
                        price: "$0.10 USDC",
                        input: "{ poolId } or { tokenA, tokenB }"
                    },
                    {
                        name: "Technical Analysis",
                        description: "Full TA with RSI, MACD, Bollinger, patterns, support/resistance",
                        price: "$0.25 USDC",
                        input: "{ token, timeframe }"
                    },
                    {
                        name: "Execute Swap",
                        description: "Execute swap on Silverback DEX (Phase 2 - Coming Soon)",
                        price: "0.1% of trade value (min $0.50)",
                        input: "{ tokenIn, tokenOut, amountIn, slippage, walletAddress }"
                    }
                ],
                chains_supported: ["Base", "Keeta"],
                dex_router: "0x565cBf0F3eAdD873212Db91896e9a548f6D64894"
            };
        }
    });
}

/**
 * Get the ACP state for the GAME agent
 */
export async function getAcpState(): Promise<{ acp_status: string; [key: string]: any }> {
    if (!acpPlugin) {
        return {
            acp_status: "not_configured",
            message: "ACP integration is not configured"
        };
    }

    try {
        const state = await acpPlugin.getAcpState();
        return {
            acp_status: "active",
            ...state
        };
    } catch (e) {
        return {
            acp_status: "error",
            error: e instanceof Error ? e.message : "Unknown error"
        };
    }
}

/**
 * Get the ACP agent description to add to the GAME agent
 */
export function getAcpAgentDescription(): string {
    if (!acpPlugin) {
        return "";
    }
    return acpPlugin.agentDescription;
}

/**
 * Process an incoming ACP job request
 * This is called when another agent requests a service from Silverback
 */
export async function processAcpJob(
    serviceType: string,
    serviceRequirements: string
): Promise<string> {
    const result = await processServiceRequest(serviceType, serviceRequirements);
    return result.deliverable;
}

// Export service handlers for direct use
export {
    handleSwapQuote,
    handlePoolAnalysis,
    handleTechnicalAnalysis,
    handleExecuteSwap,
    processServiceRequest
} from "./services";
