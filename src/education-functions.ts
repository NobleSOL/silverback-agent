import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { ethers } from 'ethers';

// Base Chain Configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';

const FACTORY_ABI = [
    'function allPairsLength() view returns (uint256)',
    'function allPairs(uint256) view returns (address)',
];

const PAIR_ABI = [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
];

const ERC20_ABI = [
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
];

/**
 * Get a sample pool from Silverback V2 on Base for educational examples
 */
async function getSamplePool(): Promise<{
    pairAddress: string;
    token0Symbol: string;
    token1Symbol: string;
    reserve0: string;
    reserve1: string;
    fee: string;
} | null> {
    try {
        const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
        const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

        const pairCount = await factory.allPairsLength();
        if (Number(pairCount) === 0) return null;

        // Get first pair as example
        const pairAddress = await factory.allPairs(0);
        const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

        const [reserves, token0Addr, token1Addr] = await Promise.all([
            pair.getReserves(),
            pair.token0(),
            pair.token1(),
        ]);

        // Get token symbols
        const token0 = new ethers.Contract(token0Addr, ERC20_ABI, provider);
        const token1 = new ethers.Contract(token1Addr, ERC20_ABI, provider);

        let token0Symbol = 'TOKEN0';
        let token1Symbol = 'TOKEN1';
        let decimals0 = 18;
        let decimals1 = 18;

        try {
            [token0Symbol, token1Symbol, decimals0, decimals1] = await Promise.all([
                token0.symbol(),
                token1.symbol(),
                token0.decimals(),
                token1.decimals(),
            ]);
        } catch {
            // Use defaults if symbol lookup fails
        }

        return {
            pairAddress,
            token0Symbol,
            token1Symbol,
            reserve0: ethers.formatUnits(reserves[0], decimals0),
            reserve1: ethers.formatUnits(reserves[1], decimals1),
            fee: '0.3%'
        };
    } catch {
        return null;
    }
}

/**
 * Explain impermanent loss with real pool data
 */
export const explainImpermanentLossFunction = new GameFunction({
    name: "explain_impermanent_loss",
    description: "Explain impermanent loss concept using real Silverback pool data on Base. Use this when users ask about IL, liquidity provision risks, or why pool returns differ from holding.",
    args: [
        {
            name: "poolAddress",
            description: "Optional: specific pool address to use as example. If not provided, uses first available pool."
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            logger("Explaining impermanent loss with real Base chain pool data");

            const pool = await getSamplePool();

            if (!pool) {
                // Fall back to generic example if no pools available
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        concept: "Impermanent Loss",
                        examplePool: "ETH/USDC (hypothetical)",
                        simpleExplanation: "When you provide liquidity, token ratios adjust as prices change. If one token's price doubles, you end up with less of the appreciating token than if you just held. This is impermanent loss.",
                        realExample: "Example: You deposit $500 ETH + $500 USDC. If ETH doubles, the AMM rebalances. You might have $700 ETH + $700 USDC ($1400 total), but if you just held you'd have $1000 ETH + $500 USDC ($1500). That's $100 IL.",
                        mitigation: "Pool fees (0.3% on Silverback) can offset IL. Higher volume = more fees = better chance of profit despite IL.",
                        poolFee: "0.3%",
                        educationalNote: "IL is temporary if prices return to original ratio. It becomes permanent when you withdraw.",
                        network: "Base",
                        dex: "Silverback DEX"
                    })
                );
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    concept: "Impermanent Loss",
                    examplePool: `${pool.token0Symbol}/${pool.token1Symbol}`,
                    pairAddress: pool.pairAddress,
                    currentReserves: {
                        [pool.token0Symbol]: pool.reserve0,
                        [pool.token1Symbol]: pool.reserve1
                    },
                    simpleExplanation: "When you provide liquidity, token ratios adjust as prices change. If one token's price doubles, you end up with less of the appreciating token than if you just held. This is impermanent loss.",
                    realExample: `In the ${pool.token0Symbol}/${pool.token1Symbol} pool: You deposit equal value of both tokens. If ${pool.token0Symbol} doubles in price, the AMM rebalances to keep equal value, so you'll have less ${pool.token0Symbol} and more ${pool.token1Symbol}. Your total value increases, but less than if you just held ${pool.token0Symbol}.`,
                    mitigation: "Pool fees (0.3% on Silverback) can offset IL. Higher volume = more fees = better chance of profit despite IL.",
                    poolFee: pool.fee,
                    educationalNote: "IL is temporary if prices return to original ratio. It becomes permanent when you withdraw.",
                    network: "Base",
                    dex: "Silverback DEX"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to explain impermanent loss: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Explain AMM mechanics with real swap example
 */
export const explainAMMFunction = new GameFunction({
    name: "explain_amm",
    description: "Explain how Automated Market Makers work using real Silverback data on Base. Use when users ask about swap pricing, slippage, or how DEXs work.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Explaining AMM mechanics with real Base chain data");

            const pool = await getSamplePool();

            if (!pool) {
                // Fall back to generic example
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        concept: "Automated Market Maker (AMM)",
                        formula: "x * y = k (constant product)",
                        examplePool: "ETH/USDC (hypothetical)",
                        howItWorks: "AMMs hold two tokens in a pool. Their product (x * y) must stay constant. When you swap, you add one token and remove the other, maintaining this constant product.",
                        priceCalculation: "Price = reserve1 / reserve0. As you swap, reserves change and so does the price. Larger swaps move the price more (slippage).",
                        fees: "Each swap charges 0.3% fee on Silverback. This goes to liquidity providers as compensation for impermanent loss risk.",
                        keyInsight: "No order books needed. Prices adjust automatically based on supply/demand through the constant product formula.",
                        network: "Base",
                        dex: "Silverback DEX"
                    })
                );
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    concept: "Automated Market Maker (AMM)",
                    formula: "x * y = k (constant product)",
                    examplePool: `${pool.token0Symbol}/${pool.token1Symbol}`,
                    pairAddress: pool.pairAddress,
                    reserve0: `${pool.reserve0} ${pool.token0Symbol}`,
                    reserve1: `${pool.reserve1} ${pool.token1Symbol}`,
                    howItWorks: `This pool has ${pool.reserve0} ${pool.token0Symbol} and ${pool.reserve1} ${pool.token1Symbol}. Their product (x * y) must stay constant. When you swap, you add one token and remove the other, maintaining this constant product.`,
                    priceCalculation: `Price = reserve1 / reserve0. As you swap, reserves change and so does the price. Larger swaps move the price more (slippage).`,
                    fees: `Each swap charges ${pool.fee} fee. This goes to liquidity providers as compensation for impermanent loss risk.`,
                    keyInsight: "No order books needed. Prices adjust automatically based on supply/demand through the constant product formula.",
                    network: "Base",
                    dex: "Silverback DEX"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to explain AMM: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Identify potential scam characteristics in DeFi projects
 */
export const identifyScamSignalsFunction = new GameFunction({
    name: "identify_scam_signals",
    description: "Analyze DeFi project characteristics to identify potential scam red flags. Use when evaluating unknown projects or warning community about risks.",
    args: [
        {
            name: "projectInfo",
            description: "Information about the project to analyze (contract details, tokenomics, team, etc.)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.projectInfo || !args.projectInfo.trim()) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Project information is required to analyze scam signals"
                );
            }

            logger(`Analyzing project for scam signals: ${args.projectInfo.substring(0, 100)}...`);

            // Common scam patterns
            const redFlags = [];
            const yellowFlags = [];
            const greenFlags = [];

            const info = args.projectInfo.toLowerCase();

            // Critical red flags
            if (info.includes('guarantee') || info.includes('risk-free')) {
                redFlags.push("🚩 Promises guaranteed returns (nothing in DeFi is guaranteed)");
            }
            if (info.includes('100x') || info.includes('1000x') || info.includes('moon')) {
                redFlags.push("🚩 Unrealistic return promises (classic pump scheme)");
            }
            if (info.includes('limited time') || info.includes('presale ending')) {
                redFlags.push("🚩 Artificial urgency tactics (FOMO manipulation)");
            }
            if (info.includes('dm') || info.includes('telegram') && info.includes('exclusive')) {
                redFlags.push("🚩 Directing to private channels (common scam tactic)");
            }
            if (info.includes('unverified') || info.includes('not audited')) {
                redFlags.push("🚩 Unaudited smart contracts (extreme risk)");
            }

            // Warning signs
            if (!info.includes('audit') && !info.includes('verified')) {
                yellowFlags.push("⚠️ No mention of audit or verification");
            }
            if (!info.includes('team') && !info.includes('developer')) {
                yellowFlags.push("⚠️ Anonymous team (not always bad, but risky)");
            }
            if (info.includes('airdrop') && info.includes('wallet')) {
                yellowFlags.push("⚠️ Airdrop requiring wallet connection (potential drain)");
            }

            // Positive signals
            if (info.includes('audit') && !info.includes('not audited')) {
                greenFlags.push("✅ Mentions audit (verify the auditor is reputable)");
            }
            if (info.includes('open source') || info.includes('verified contract')) {
                greenFlags.push("✅ Open source/verified (transparency is good)");
            }
            if (info.includes('liquidity locked')) {
                greenFlags.push("✅ Locked liquidity (prevents rug pull)");
            }

            const riskLevel = redFlags.length >= 2 ? "EXTREME RISK - LIKELY SCAM" :
                            redFlags.length >= 1 ? "HIGH RISK - Exercise Caution" :
                            yellowFlags.length >= 3 ? "MEDIUM RISK - Do Your Research" :
                            "LOW RISK - But Always DYOR";

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    riskAssessment: riskLevel,
                    redFlags: redFlags,
                    warningFlags: yellowFlags,
                    positiveSignals: greenFlags,
                    recommendation: redFlags.length > 0
                        ? "DO NOT ENGAGE. These are classic scam patterns. Protect the pack."
                        : "Proceed with caution. Always verify contracts, check audits, and never invest more than you can afford to lose.",
                    education: "Common scam tactics: guaranteed returns, artificial urgency, unverified contracts, anonymous teams with no track record, promises of unrealistic gains.",
                    tip: "Use Base block explorer (basescan.org) to verify contracts before interacting."
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to analyze scam signals: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
