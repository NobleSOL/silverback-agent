/**
 * ACP Integration Module
 *
 * Integrates Silverback Agent with Virtuals Agent Commerce Protocol (ACP)
 * to enable agent-to-agent commerce and service offerings.
 *
 * Services Offered:
 * 1. Swap Quote ($0.02) - Get optimal swap route with price impact (service-only)
 * 2. Pool Analysis ($0.10) - Comprehensive liquidity pool analysis (service-only)
 * 3. Technical Analysis ($0.25) - Full TA with indicators and patterns (service-only)
 * 4. Execute Swap - Actual swap execution with buyer's funds (fund-transfer job)
 */

import AcpPlugin, { AcpState } from "@virtuals-protocol/game-acp-plugin";
import AcpClient, {
    AcpContractClientV2,
    AcpJob,
    AcpJobPhases,
    AcpMemo,
    baseAcpConfigV2,
    Fare,
    FareAmount,
    MemoType,
    DeliverablePayload
} from "@virtuals-protocol/acp-node";
import { processServiceRequest, handleExecuteSwapWithFunds, getProvider } from "./services";
import { enqueueJob, completeJob, failJob, getQueueStats, canAcceptJob } from "./job-queue";
import dotenv from "dotenv";
import { Address } from "viem";
import { ethers } from "ethers";

dotenv.config();

// Re-export AcpState type for use in agent.ts
export type { AcpState };

// ACP Configuration from environment
// ACP_AGENT_WALLET_ADDRESS should be the smart account registered on Virtuals (for SDK connection)
// ACP_SWAP_WALLET_ADDRESS is the EOA that receives funds and executes swaps
const ACP_AGENT_WALLET_ADDRESS = process.env.ACP_AGENT_WALLET_ADDRESS;
const ACP_SWAP_WALLET_ADDRESS = process.env.ACP_SWAP_WALLET_ADDRESS || process.env.ACP_AGENT_WALLET_ADDRESS;
const ACP_PRIVATE_KEY = process.env.ACP_PRIVATE_KEY || process.env.WHITELISTED_WALLET_PRIVATE_KEY;
const ACP_ENTITY_ID = process.env.ACP_ENTITY_ID;
const ACP_CLUSTER = process.env.ACP_CLUSTER || 'defi'; // DeFi cluster for AHF integration

// ACP V2 config for fund transfers
const config = baseAcpConfigV2;

let acpPlugin: AcpPlugin | null = null;
let acpClient: AcpClient | null = null;
let acpInitialized = false;

// Job types that require fund transfers
const FUND_TRANSFER_JOBS = ['execute-swap', 'swap', 'trade', 'swap_token'];

// Service-only jobs (no fund transfer)
const SERVICE_ONLY_JOBS = [
    'swapQuote', 'getSwapQuote', 'swap-quote',  // Quote services
    'getPoolAnalysis', 'pool-analysis',          // Pool analysis
    'getTechnicalAnalysis', 'technical-analysis', // Technical analysis
    'defiYield', 'lpAnalysis', 'topPools', 'topProtocols', 'topCoins'  // LP/Yield/Market services
];

/**
 * Check if ACP is properly configured
 */
export function isAcpConfigured(): boolean {
    return !!(ACP_AGENT_WALLET_ADDRESS && ACP_PRIVATE_KEY && ACP_ENTITY_ID);
}

/**
 * Determine if a job requires fund transfer
 */
function isFundTransferJob(jobName: string): boolean {
    const jobLower = jobName.toLowerCase();

    // First check if it's explicitly a service-only job (no funds needed)
    if (SERVICE_ONLY_JOBS.some(name => jobLower === name.toLowerCase())) {
        return false;
    }

    // Then check if it matches fund transfer patterns
    return FUND_TRANSFER_JOBS.some(name =>
        jobLower.includes(name.toLowerCase())
    );
}

/**
 * Initialize the ACP Plugin with V2 support for fund transfers
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
        console.log("🔗 Initializing ACP V2 integration...");

        // Build the ACP contract client
        let privateKey = ACP_PRIVATE_KEY!.trim();

        // Remove 0x prefix if present
        if (privateKey.startsWith('0x')) {
            privateKey = privateKey.slice(2);
        }

        // Validate private key format
        if (privateKey.length !== 64) {
            console.error(`❌ ACP_PRIVATE_KEY invalid length: ${privateKey.length} chars (expected 64)`);
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

        // Use V2 contract client for fund transfer support
        const acpContractClient = await AcpContractClientV2.build(
            privateKeyWithPrefix,
            parseInt(ACP_ENTITY_ID!, 10),
            ACP_AGENT_WALLET_ADDRESS! as `0x${string}`,
            config
        );

        // Create ACP client with WebSocket callbacks for job notifications
        acpClient = new AcpClient({
            acpContractClient,
            onNewTask: handleNewTask,
        });

        // Create the ACP plugin
        // Note: We use 'as any' to bridge version mismatch between game-acp-plugin (v0.2.x)
        // and acp-node (v0.3.x). The underlying functionality is compatible.
        // Set keepCompletedJobs and keepCancelledJobs to 0 to avoid compatibility issues
        // with the v0.3.x API returning paginated results instead of arrays.
        acpPlugin = new AcpPlugin({
            apiKey: process.env.API_KEY!,
            acpClient: acpClient as any,
            cluster: ACP_CLUSTER,
            jobExpiryDurationMins: 1440, // 24 hours
            keepCompletedJobs: 0,  // Disabled due to v0.3.x API incompatibility
            keepCancelledJobs: 0,  // Disabled due to v0.3.x API incompatibility
            keepProducedInventory: 20
        });

        acpInitialized = true;
        console.log("✅ ACP V2 integration initialized successfully!");
        console.log(`   Wallet: ${ACP_AGENT_WALLET_ADDRESS}`);
        console.log(`   Cluster: ${ACP_CLUSTER}`);
        console.log(`   Fund transfers: ENABLED\n`);

        return acpPlugin;

    } catch (error) {
        console.error("❌ Failed to initialize ACP:", error);
        return null;
    }
}

/**
 * Handle incoming ACP job tasks
 */
async function handleNewTask(job: AcpJob, memoToSign?: AcpMemo) {
    const jobId = job.id;
    const jobPhase = job.phase;
    const jobName = job.name || 'unknown';

    console.log(`\n📥 [ACP] Job ${jobId} - Phase: ${AcpJobPhases[jobPhase]}, Service: ${jobName}`);
    console.log(`   Client: ${job.clientAddress}`);
    console.log(`   Requirement:`, JSON.stringify(job.requirement).substring(0, 200));

    if (!memoToSign) {
        console.log(`   ⚠️ No memo to sign`);
        return;
    }

    try {
        // Handle based on job phase
        if (jobPhase === AcpJobPhases.REQUEST) {
            await handleRequestPhase(job, jobName);
        } else if (jobPhase === AcpJobPhases.TRANSACTION) {
            await handleTransactionPhase(job, jobName);
        } else {
            console.log(`   ℹ️ Phase ${AcpJobPhases[jobPhase]} - no action needed`);
        }
    } catch (err: any) {
        console.error(`   ❌ Error handling job:`, err.message);
        // Try to reject the job on error
        try {
            await job.reject(`Error processing job: ${err.message}`);
        } catch (rejectErr) {
            console.error(`   ❌ Failed to reject job:`, rejectErr);
        }
    }
}

/**
 * Handle REQUEST phase - Accept job and request funds if needed
 */
async function handleRequestPhase(job: AcpJob, jobName: string) {
    console.log(`   🔄 REQUEST phase: Evaluating job...`);

    // Check queue capacity before accepting
    if (!canAcceptJob()) {
        const stats = await getQueueStats();
        console.log(`   ⏳ Queue at capacity (${stats.processing} processing, ${stats.pending} pending)`);
        await job.reject("Server busy - please try again in a moment");
        return;
    }

    const requirement = job.requirement as any;

    if (isFundTransferJob(jobName)) {
        // Fund transfer job (swap execution)
        console.log(`   💰 Fund transfer job detected`);

        // Accept the job
        await job.accept("Silverback accepts swap execution request");
        console.log(`   ✅ Job accepted`);

        // Determine the token and amount to request
        const tokenIn = requirement.tokenIn || requirement.fromSymbol || 'USDC';
        const amountIn = parseFloat(requirement.amountIn || requirement.amount || '0');

        if (amountIn <= 0) {
            await job.reject("Invalid swap amount");
            return;
        }

        // Get the token contract address for the fare
        const tokenAddress = await getTokenAddress(tokenIn);
        if (!tokenAddress) {
            await job.reject(`Unknown token: ${tokenIn}`);
            return;
        }

        // Create fare for the requested token
        const fare = await Fare.fromContractAddress(tokenAddress as Address, config);
        const fareAmount = new FareAmount(amountIn, fare);

        // Request funds from buyer using PAYABLE_REQUEST
        // Use ACP_SWAP_WALLET_ADDRESS (EOA) instead of job.providerAddress (smart account)
        // so we can directly execute swaps with the received funds
        const receivingWallet = ACP_SWAP_WALLET_ADDRESS as Address;
        console.log(`   📤 Requesting ${amountIn} ${tokenIn} from buyer to ${receivingWallet}...`);
        await job.createPayableRequirement(
            `Send ${amountIn} ${tokenIn} to execute swap`,
            MemoType.PAYABLE_REQUEST,
            fareAmount,
            receivingWallet // EOA wallet that can execute swaps
        );
        console.log(`   ✅ Payable requirement created`);

    } else {
        // Service-only job (quote, analysis, etc.)
        console.log(`   📋 Service-only job detected`);
        await job.accept("Silverback accepts service request");
        await job.createRequirement("Processing your request...");
        console.log(`   ✅ Job accepted`);
    }
}

/**
 * Handle TRANSACTION phase - Execute service/swap and deliver results
 */
async function handleTransactionPhase(job: AcpJob, jobName: string) {
    console.log(`   🔄 TRANSACTION phase: Executing...`);

    const requirement = job.requirement as any;
    const jobId = job.id?.toString() || `job-${Date.now()}`;

    // Track job in queue
    await enqueueJob(jobId, jobName, requirement);

    if (isFundTransferJob(jobName)) {
        // Fund transfer job - use buyer's funds to execute swap
        const netAmount = job.netPayableAmount || 0;
        console.log(`   💰 Net payable amount received: ${netAmount}`);

        if (netAmount <= 0) {
            console.log(`   ❌ No funds received, rejecting job`);
            await job.reject("No funds received for swap execution");
            return;
        }

        // Execute the swap with the received funds
        const tokenIn = requirement.tokenIn || requirement.fromSymbol || 'USDC';
        const tokenOut = requirement.tokenOut || requirement.toSymbol;
        const slippage = requirement.slippage || '1';

        console.log(`   🔄 Executing swap: ${netAmount} ${tokenIn} -> ${tokenOut}`);

        try {
            // Execute swap and get the output amount
            const swapResult = await handleExecuteSwapWithFunds({
                tokenIn,
                tokenOut,
                amountIn: netAmount.toString(),
                slippage,
                recipientAddress: job.clientAddress // Send swapped tokens to buyer
            });

            if (!swapResult.success) {
                // Refund the buyer on failure
                console.log(`   ❌ Swap failed: ${swapResult.error}`);
                const tokenAddress = await getTokenAddress(tokenIn);
                const fare = await Fare.fromContractAddress(tokenAddress as Address, config);
                await job.rejectPayable(
                    `Swap failed: ${swapResult.error}. Refunding ${netAmount} ${tokenIn}`,
                    new FareAmount(netAmount, fare)
                );
                return;
            }

            // Deliver the swapped tokens to buyer
            const outputAmount = parseFloat(swapResult.data?.actualOutput || '0');
            const tokenOutAddress = await getTokenAddress(tokenOut);
            if (!tokenOutAddress) {
                throw new Error(`Unknown token: ${tokenOut}`);
            }

            // Transfer tokens directly from EOA to buyer
            const SWAP_PRIVATE_KEY = process.env.SWAP_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ACP_PRIVATE_KEY;
            if (!SWAP_PRIVATE_KEY) {
                throw new Error("No private key configured for token transfer");
            }

            const provider = new ethers.JsonRpcProvider('https://mainnet.base.org');
            const wallet = new ethers.Wallet(SWAP_PRIVATE_KEY, provider);

            // Get token contract and check actual balance to transfer
            const tokenContract = new ethers.Contract(
                tokenOutAddress,
                ['function transfer(address to, uint256 amount) returns (bool)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)'],
                wallet
            );
            const decimals = await tokenContract.decimals();

            // Use actual wallet balance instead of reported output to avoid precision issues
            const actualBalance = await tokenContract.balanceOf(wallet.address) as bigint;
            const reportedAmountWei = ethers.parseUnits(swapResult.data?.actualOutput || '0', decimals);

            // Transfer the lesser of reported amount or actual balance (safety check)
            const amountWei = actualBalance < reportedAmountWei ? actualBalance : reportedAmountWei;
            const amountHuman = ethers.formatUnits(amountWei, decimals);

            console.log(`   📤 Transferring ${amountHuman} ${tokenOut} to buyer ${job.clientAddress}...`);
            console.log(`   (Wallet balance: ${ethers.formatUnits(actualBalance, decimals)}, Reported: ${swapResult.data?.actualOutput})`);
            const transferTx = await tokenContract.transfer(job.clientAddress, amountWei);
            const transferReceipt = await transferTx.wait();
            console.log(`   ✅ Transfer to buyer confirmed: ${transferReceipt.hash}`);

            const deliverable: DeliverablePayload = {
                type: "swap_result",
                value: {
                    txHash: transferReceipt.hash,
                    sold: `${netAmount} ${tokenIn}`,
                    received: `${amountHuman} ${tokenOut}`,
                    executionPrice: swapResult.data?.executionPrice,
                    recipient: job.clientAddress
                }
            };

            // Use regular deliver() since we already transferred the tokens
            console.log(`   📤 Marking job as delivered...`);
            await job.deliver(deliverable);
            await completeJob(jobId, deliverable);
            console.log(`   ✅ Swap completed and delivered!`);

        } catch (swapErr: any) {
            console.error(`   ❌ Swap execution error:`, swapErr.message);
            await failJob(jobId, swapErr.message);
            // Try to refund
            try {
                const tokenAddress = await getTokenAddress(tokenIn);
                const fare = await Fare.fromContractAddress(tokenAddress as Address, config);
                await job.rejectPayable(
                    `Swap error: ${swapErr.message}. Refunding ${netAmount} ${tokenIn}`,
                    new FareAmount(netAmount, fare)
                );
            } catch (refundErr) {
                console.error(`   ❌ Refund failed:`, refundErr);
            }
        }

    } else {
        // Service-only job - process and deliver
        try {
            const result = await processServiceRequest(jobName, JSON.stringify(requirement));
            console.log(`   ✅ Processed: ${result.deliverable?.substring(0, 150)}`);

            // Parse the deliverable
            let parsedValue;
            try {
                parsedValue = JSON.parse(result.deliverable);
            } catch {
                parsedValue = result.deliverable;
            }

            const deliverable: DeliverablePayload = {
                type: jobName,
                value: parsedValue
            };

            await job.deliver(deliverable);
            await completeJob(jobId, deliverable);
            console.log(`   ✅ Delivered!`);
        } catch (serviceErr: any) {
            console.error(`   ❌ Service error:`, serviceErr.message);
            await failJob(jobId, serviceErr.message);
            await job.reject(`Service error: ${serviceErr.message}`);
        }
    }
}

/**
 * Get token contract address from symbol
 */
async function getTokenAddress(symbol: string): Promise<string | null> {
    // Common Base tokens
    const tokens: Record<string, string> = {
        'USDC': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
        'WETH': '0x4200000000000000000000000000000000000006',
        'ETH': '0x4200000000000000000000000000000000000006',
        'VIRTUAL': '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
        'BACK': '0x558881c4959e9cf961a7E1815FCD6586906babd2',
        'DAI': '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
        'USDbC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
        'AERO': '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
        'DEGEN': '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
        'BRETT': '0x532f27101965dd16442E59d40670FaF5eBB142E4',
        'TOSHI': '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
        'HIGHER': '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe',
        'WELL': '0xA88594D404727625A9437C3f886C7643872296AE',
        'cbETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
        'cbBTC': '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',
    };

    // Check if it's already an address
    if (symbol.startsWith('0x') && symbol.length === 42) {
        return symbol;
    }

    const address = tokens[symbol.toUpperCase()];
    if (address) {
        return address;
    }

    // Try CoinGecko lookup as fallback
    try {
        const response = await fetch(
            `https://api.coingecko.com/api/v3/coins/${symbol.toLowerCase()}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`
        );
        if (response.ok) {
            const data = await response.json();
            const baseAddress = data.platforms?.base;
            if (baseAddress) {
                console.log(`[getTokenAddress] Found ${symbol} via CoinGecko: ${baseAddress}`);
                return baseAddress;
            }
        }
    } catch (e) {
        // Ignore CoinGecko errors
    }

    return null;
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
 */
export function getAcpWorker() {
    if (!acpPlugin) {
        return null;
    }

    return acpPlugin.getWorker({
        getEnvironment: async () => {
            return {
                silverback_services: [
                    {
                        name: "Swap Quote",
                        description: "Get optimal swap route with price impact, fees, and expected output",
                        price: "$0.02 USDC",
                        requiresFunds: false,
                        input: "{ tokenIn, tokenOut, amountIn }"
                    },
                    {
                        name: "Pool Analysis",
                        description: "Comprehensive liquidity pool analysis with reserves, APY, health metrics",
                        price: "$0.10 USDC",
                        requiresFunds: false,
                        input: "{ poolId } or { tokenA, tokenB }"
                    },
                    {
                        name: "Technical Analysis",
                        description: "Full TA with RSI, MACD, Bollinger, patterns, support/resistance",
                        price: "$0.25 USDC",
                        requiresFunds: false,
                        input: "{ token, timeframe }"
                    },
                    {
                        name: "Execute Swap",
                        description: "Execute token swap using your funds - send tokens, receive swapped tokens",
                        price: "0.5% of trade value",
                        requiresFunds: true,
                        input: "{ tokenIn, tokenOut, amountIn, slippage }"
                    }
                ],
                chains_supported: ["Base"],
                dex_router: "0x565cBf0F3eAdD873212Db91896e9a548f6D64894",
                fund_transfer_enabled: true
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
        const queueStats = await getQueueStats();
        return {
            acp_status: "active",
            queue: queueStats,
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
 * Get the ACP agent description
 */
export function getAcpAgentDescription(): string {
    if (!acpPlugin) {
        return "";
    }
    return acpPlugin.agentDescription;
}

// Export service handlers for direct use
export {
    handleSwapQuote,
    handlePoolAnalysis,
    handleTechnicalAnalysis,
    handleExecuteSwap,
    processServiceRequest
} from "./services";
