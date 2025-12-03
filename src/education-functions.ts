import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

const DEX_API_URL = process.env.DEX_API_URL || 'https://dexkeeta.onrender.com/api';

/**
 * Explain impermanent loss with real pool data
 */
export const explainImpermanentLossFunction = new GameFunction({
    name: "explain_impermanent_loss",
    description: "Explain impermanent loss concept using real Silverback pool data. Use this when users ask about IL, liquidity provision risks, or why pool returns differ from holding.",
    args: [
        {
            name: "poolAddress",
            description: "Optional: specific pool address to use as example. If not provided, uses highest TVL pool."
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            logger("Explaining impermanent loss with real pool data");

            // Get pool data for educational example
            const response = await fetch(`${DEX_API_URL}/anchor/pools`);
            const pools = await response.json();

            // Use specified pool or highest TVL pool
            const pool = args.poolAddress
                ? pools.find((p: any) => p.poolAddress === args.poolAddress)
                : pools.sort((a: any, b: any) => {
                    const tvlA = parseFloat(a.reserve0USD || '0') + parseFloat(a.reserve1USD || '0');
                    const tvlB = parseFloat(b.reserve0USD || '0') + parseFloat(b.reserve1USD || '0');
                    return tvlB - tvlA;
                  })[0];

            if (!pool) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "No pool data available for impermanent loss example"
                );
            }

            const tvl = parseFloat(pool.reserve0USD || '0') + parseFloat(pool.reserve1USD || '0');

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    concept: "Impermanent Loss",
                    examplePool: `${pool.token0Symbol}/${pool.token1Symbol}`,
                    poolTVL: tvl,
                    simpleExplanation: "When you provide liquidity, token ratios adjust as prices change. If one token's price doubles, you end up with less of the appreciating token than if you just held. This is impermanent loss.",
                    realExample: `In the ${pool.token0Symbol}/${pool.token1Symbol} pool: You deposit equal value of both tokens. If ${pool.token0Symbol} doubles in price, the AMM rebalances to keep equal value, so you'll have less ${pool.token0Symbol} and more ${pool.token1Symbol}. Your total value increases, but less than if you just held ${pool.token0Symbol}.`,
                    mitigation: "Pool fees (creator fee + protocol fee) can offset IL. Higher volume = more fees = better chance of profit despite IL.",
                    poolFee: `${pool.feeBps / 100}%`,
                    educationalNote: "IL is temporary if prices return to original ratio. It becomes permanent when you withdraw."
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
    description: "Explain how Automated Market Makers work using real Silverback data. Use when users ask about swap pricing, slippage, or how DEXs work.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Explaining AMM mechanics with real data");

            const response = await fetch(`${DEX_API_URL}/anchor/pools`);
            const pools = await response.json();

            // Find pool with good liquidity for example
            const pool = pools
                .filter((p: any) => p.status === 'active')
                .sort((a: any, b: any) => {
                    const tvlA = parseFloat(a.reserve0USD || '0') + parseFloat(a.reserve1USD || '0');
                    const tvlB = parseFloat(b.reserve0USD || '0') + parseFloat(b.reserve1USD || '0');
                    return tvlB - tvlA;
                })[0];

            if (!pool) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "No active pools available for AMM example"
                );
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    concept: "Automated Market Maker (AMM)",
                    formula: "x * y = k (constant product)",
                    examplePool: `${pool.token0Symbol}/${pool.token1Symbol}`,
                    reserve0: pool.reserve0Formatted,
                    reserve1: pool.reserve1Formatted,
                    howItWorks: `This pool has ${pool.reserve0Formatted} ${pool.token0Symbol} and ${pool.reserve1Formatted} ${pool.token1Symbol}. Their product (x * y) must stay constant. When you swap, you add one token and remove the other, maintaining this constant product.`,
                    priceCalculation: `Price = reserve1 / reserve0. As you swap, reserves change and so does the price. Larger swaps move the price more (slippage).`,
                    fees: `Each swap charges ${pool.feeBps / 100}% fee. This goes to liquidity providers as compensation for impermanent loss risk.`,
                    keyInsight: "No order books needed. Prices adjust automatically based on supply/demand through the constant product formula."
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
                    education: "Common scam tactics: guaranteed returns, artificial urgency, unverified contracts, anonymous teams with no track record, promises of unrealistic gains."
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
