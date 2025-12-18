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
import AcpClient, { AcpContractClient, baseAcpConfig, AcpJob } from "@virtuals-protocol/acp-node";
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

        // Create ACP client with job handlers
        const acpClient = new AcpClient({
            acpContractClient,
            // Handler for new incoming job requests
            onNewTask: async (job: AcpJob) => {
                console.log(`\n📥 New ACP job received: ${job.id}`);
                console.log(`   Service: ${job.serviceRequirement?.substring(0, 100)}...`);
                console.log(`   From: ${job.clientEntityId}`);
                console.log(`   Price: ${job.price} USDC`);

                try {
                    // Auto-accept jobs - we're a service provider
                    console.log(`   ✅ Accepting job ${job.id}...`);
                    await job.respond(true);
                    console.log(`   ✅ Job accepted, processing...`);

                    // Process the service request
                    const result = await processServiceRequest(
                        job.serviceRequirement || '',
                        job.serviceRequirement || ''
                    );

                    // Submit the deliverable
                    console.log(`   📤 Submitting deliverable for job ${job.id}...`);
                    await job.submit(result.deliverable);
                    console.log(`   ✅ Deliverable submitted for job ${job.id}`);

                } catch (error) {
                    console.error(`   ❌ Failed to process job ${job.id}:`, error);
                    try {
                        // Try to reject if we failed to process
                        await job.respond(false);
                    } catch {
                        // Ignore rejection errors
                    }
                }
            },
            // Handler for evaluation phase (when we're the buyer)
            onEvaluate: async (job: AcpJob) => {
                console.log(`\n📋 Evaluating job ${job.id}...`);
                console.log(`   Deliverable: ${job.deliverable?.substring(0, 100)}...`);

                try {
                    // Parse the deliverable to check if it was successful
                    const result = JSON.parse(job.deliverable || '{}');

                    if (result.success) {
                        await job.evaluate(true, "Deliverable meets requirements - service completed successfully");
                    } else {
                        await job.evaluate(false, `Service failed: ${result.error || 'Unknown error'}`);
                    }
                } catch (e) {
                    // If we can't parse, accept if there's any content
                    if (job.deliverable && job.deliverable.length > 10) {
                        await job.evaluate(true, "Deliverable received");
                    } else {
                        await job.evaluate(false, "Invalid or empty deliverable");
                    }
                }
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
