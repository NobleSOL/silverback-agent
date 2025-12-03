import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { ethers } from "ethers";
import { stateManager } from "./state/state-manager";

// Base Mainnet Configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const SILVERBACK_UNIFIED_ROUTER = '0x565cBf0F3eAdD873212Db91896e9a548f6D64894';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';
const WETH_BASE = '0x4200000000000000000000000000000000000006';

// Standard Uniswap V2 ABIs
const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
    'function allPairsLength() view returns (uint256)',
];

const PAIR_ABI = [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function totalSupply() view returns (uint256)',
];

const ROUTER_ABI = [
    'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
    'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    'function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[] amounts)',
    'function swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) returns (uint256[] amounts)',
    'function factory() view returns (address)',
];

const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
];

// Helper to get provider
function getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(BASE_RPC_URL);
}

// Helper to validate Ethereum address
function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Get swap quote from Silverback DEX
 * Phase 1: Read-only quote
 */
export const getSwapQuoteFunction = new GameFunction({
    name: "get_swap_quote",
    description: "Get a swap quote from Silverback DEX on Base. Returns expected output amount, price impact, and routing information. Use this to analyze trade opportunities before execution.",
    args: [
        {
            name: "tokenIn",
            description: "Input token address (0x format, use 0x4200000000000000000000000000000000000006 for ETH)"
        },
        {
            name: "tokenOut",
            description: "Output token address (0x format)"
        },
        {
            name: "amountIn",
            description: "Amount to swap in human-readable format (e.g., '1.5' for 1.5 tokens)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            // Validate inputs
            if (!args.tokenIn || !args.tokenOut || !args.amountIn) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Missing required parameters: tokenIn, tokenOut, amountIn"
                );
            }

            if (!isValidAddress(args.tokenIn) || !isValidAddress(args.tokenOut)) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token addresses. Must be 0x format (e.g., 0x1234...)"
                );
            }

            logger(`Getting swap quote: ${args.amountIn} ${args.tokenIn} → ${args.tokenOut}`);

            const provider = getProvider();
            const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);

            // Get token decimals
            const tokenInContract = new ethers.Contract(args.tokenIn, ERC20_ABI, provider);
            const decimals = await tokenInContract.decimals();

            // Convert human amount to wei
            const amountInWei = ethers.parseUnits(args.amountIn, decimals);

            // Get quote from router
            const path = [args.tokenIn, args.tokenOut];
            const amounts = await router.getAmountsOut(amountInWei, path);

            const amountOutWei = amounts[1];
            const amountOutHuman = ethers.formatUnits(amountOutWei, decimals);

            // Calculate price impact (simplified)
            const amountInNum = parseFloat(args.amountIn);
            const amountOutNum = parseFloat(amountOutHuman);
            const expectedOut = amountInNum * 0.997; // 0.3% fee
            const priceImpact = ((expectedOut - amountOutNum) / expectedOut) * 100;

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    tokenIn: args.tokenIn,
                    tokenOut: args.tokenOut,
                    amountIn: args.amountIn,
                    amountOut: amountOutHuman,
                    amountOutWei: amountOutWei.toString(),
                    priceImpact: Math.abs(priceImpact).toFixed(2) + '%',
                    fee: '0.3%',
                    route: path,
                    router: SILVERBACK_UNIFIED_ROUTER,
                    chain: 'Base',
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            const error = e as Error;

            // Handle specific errors
            if (error.message.includes('INSUFFICIENT_LIQUIDITY')) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `No liquidity pool exists for this pair. Check if the pair exists using check_liquidity function.`
                );
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get swap quote: ${error.message}`
            );
        }
    }
});

/**
 * Check if liquidity pair exists and get reserves
 * Phase 1: Read-only
 */
export const checkLiquidityFunction = new GameFunction({
    name: "check_liquidity",
    description: "Check if a Silverback liquidity pool exists for a token pair on Base and get reserve information. Use this before attempting swaps to verify liquidity depth.",
    args: [
        {
            name: "tokenA",
            description: "First token address (0x format)"
        },
        {
            name: "tokenB",
            description: "Second token address (0x format)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.tokenA || !args.tokenB) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Both tokenA and tokenB are required"
                );
            }

            if (!isValidAddress(args.tokenA) || !isValidAddress(args.tokenB)) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token addresses"
                );
            }

            logger(`Checking liquidity for ${args.tokenA} / ${args.tokenB}`);

            const provider = getProvider();
            const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

            // Check if pair exists
            const pairAddress = await factory.getPair(args.tokenA, args.tokenB);

            if (pairAddress === ethers.ZeroAddress) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        pairExists: false,
                        tokenA: args.tokenA,
                        tokenB: args.tokenB,
                        message: "No liquidity pool exists for this pair on Silverback DEX",
                        recommendation: "This pair cannot be traded on Silverback. Consider using aggregator routing."
                    })
                );
            }

            // Get pair reserves
            const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
            const [reserve0, reserve1] = await pair.getReserves();
            const token0 = await pair.token0();
            const token1 = await pair.token1();

            // Get token symbols
            const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
            const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
            const symbol0 = await token0Contract.symbol();
            const symbol1 = await token1Contract.symbol();
            const decimals0 = await token0Contract.decimals();
            const decimals1 = await token1Contract.decimals();

            // Format reserves
            const reserve0Formatted = ethers.formatUnits(reserve0, decimals0);
            const reserve1Formatted = ethers.formatUnits(reserve1, decimals1);

            // Calculate liquidity rating
            const reserve0Num = parseFloat(reserve0Formatted);
            const reserve1Num = parseFloat(reserve1Formatted);
            const totalLiquidity = reserve0Num + reserve1Num;

            let liquidityRating = 'VERY LOW';
            if (totalLiquidity > 100000) liquidityRating = 'EXCELLENT';
            else if (totalLiquidity > 50000) liquidityRating = 'GOOD';
            else if (totalLiquidity > 10000) liquidityRating = 'MODERATE';
            else if (totalLiquidity > 1000) liquidityRating = 'LOW';

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    pairExists: true,
                    pairAddress: pairAddress,
                    token0: {
                        address: token0,
                        symbol: symbol0,
                        reserve: reserve0Formatted
                    },
                    token1: {
                        address: token1,
                        symbol: symbol1,
                        reserve: reserve1Formatted
                    },
                    liquidityRating: liquidityRating,
                    totalReserves: `${reserve0Formatted} ${symbol0} + ${reserve1Formatted} ${symbol1}`,
                    recommendation: liquidityRating === 'VERY LOW' || liquidityRating === 'LOW'
                        ? 'Low liquidity - expect high slippage on large trades'
                        : 'Sufficient liquidity for most trade sizes',
                    chain: 'Base'
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to check liquidity: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get token price in USD
 * Phase 1: Read-only (uses WETH pair as reference)
 */
export const getTokenPriceFunction = new GameFunction({
    name: "get_token_price",
    description: "Get the approximate USD price of a token on Base by checking its WETH pair and using ETH price. Use this for portfolio valuation and trade analysis.",
    args: [
        {
            name: "tokenAddress",
            description: "Token address (0x format)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.tokenAddress || !args.tokenAddress.trim()) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Token address is required"
                );
            }

            if (!isValidAddress(args.tokenAddress)) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token address"
                );
            }

            logger(`Getting price for token: ${args.tokenAddress}`);

            const provider = getProvider();
            const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

            // Check if WETH pair exists
            const pairAddress = await factory.getPair(args.tokenAddress, WETH_BASE);

            if (pairAddress === ethers.ZeroAddress) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        tokenAddress: args.tokenAddress,
                        priceUsd: null,
                        message: "No WETH pair exists for this token on Silverback",
                        recommendation: "Cannot determine price - no liquidity pool with WETH"
                    })
                );
            }

            // Get reserves from WETH pair
            const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
            const [reserve0, reserve1] = await pair.getReserves();
            const token0 = await pair.token0();

            // Determine which reserve is WETH
            const isToken0WETH = token0.toLowerCase() === WETH_BASE.toLowerCase();
            const wethReserve = isToken0WETH ? reserve0 : reserve1;
            const tokenReserve = isToken0WETH ? reserve1 : reserve0;

            // Calculate token price in ETH
            const wethPerToken = Number(wethReserve) / Number(tokenReserve);

            // Approximate ETH price (you'd want a real oracle for production)
            const ETH_PRICE_USD = 3000; // Hardcoded for now - should use Chainlink oracle

            const priceUsd = wethPerToken * ETH_PRICE_USD;

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    tokenAddress: args.tokenAddress,
                    priceUsd: priceUsd.toFixed(6),
                    priceInETH: wethPerToken.toFixed(8),
                    pairAddress: pairAddress,
                    note: "Price calculated from WETH pair reserves. ETH price assumed at $3000 USD.",
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get token price: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Execute token swap
 * Phase 2: DISABLED - Requires wallet integration
 */
export const tokenSwapFunction = new GameFunction({
    name: "token_swap",
    description: "[PHASE 2 - NOT YET ENABLED] Execute a token swap on Silverback DEX. This function will be enabled when wallet integration is ready.",
    args: [
        {
            name: "tokenIn",
            description: "Input token address (0x format)"
        },
        {
            name: "tokenOut",
            description: "Output token address (0x format)"
        },
        {
            name: "amountIn",
            description: "Amount to swap (human-readable)"
        },
        {
            name: "slippagePercent",
            description: "Maximum slippage tolerance (e.g., '0.5' for 0.5%)"
        }
    ] as const,
    executable: async (args, logger) => {
        // Phase 2 - Not yet enabled
        return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Failed,
            JSON.stringify({
                status: "PHASE_2_NOT_ENABLED",
                message: "Token swap execution is not yet enabled. Currently in Phase 1 (read-only mode).",
                availableNow: "Use get_swap_quote to get quotes without executing swaps",
                comingSoon: "Wallet integration and swap execution will be enabled in Phase 2",
                requestedSwap: {
                    tokenIn: args.tokenIn,
                    tokenOut: args.tokenOut,
                    amountIn: args.amountIn,
                    slippage: args.slippagePercent
                }
            })
        );
    }
});

/**
 * Analyze Trade Opportunity - Check historical performance before trading
 * This is the agent's "pre-flight check" that uses learned wisdom
 *
 * Before every paper trade, the agent should call this to:
 * 1. Check if the proposed strategy has been profitable
 * 2. Verify current market conditions match successful patterns
 * 3. Avoid repeating known mistakes
 * 4. Get a GO / CAUTION / AVOID recommendation
 */
export const analyzeTradeOpportunityFunction = new GameFunction({
    name: "analyze_trade_opportunity",
    description: `CRITICAL: Call this BEFORE every paper trade to check historical performance.

Returns a recommendation based on learned wisdom:
- GO: Strategy has >60% win rate in current conditions
- CAUTION: Mixed results, proceed with smaller position
- AVOID: Strategy has poor performance in current conditions

The agent learns over time. Early trades may show "INSUFFICIENT_DATA".
After 50+ trades, recommendations become highly reliable.`,
    args: [
        {
            name: "strategy",
            description: "Strategy to use: 'momentum' or 'mean_reversion'"
        },
        {
            name: "market_condition",
            description: "Current market condition: 'trending_up', 'trending_down', 'ranging', or 'volatile'"
        },
        {
            name: "token_pair",
            description: "Token pair being traded (e.g., 'ETH/USDC')"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const state = stateManager.getState();

            logger(`Analyzing trade opportunity: ${args.strategy} in ${args.market_condition} market`);

            // Get strategy performance
            const strategyData = state.strategies.find(s => s.strategyName === args.strategy);

            // Check if we have enough data
            const totalTrades = state.metrics.totalTrades;
            if (totalTrades < 10) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        recommendation: "GO",
                        confidence: "LOW",
                        reason: "INSUFFICIENT_DATA - Need more trades to build learning. Proceed with small positions.",
                        strategy_stats: {
                            name: args.strategy,
                            trades: strategyData?.trades || 0,
                            win_rate: strategyData ? `${(strategyData.winRate * 100).toFixed(1)}%` : "0%"
                        },
                        total_trades_for_learning: totalTrades,
                        minimum_for_confidence: 50,
                        action: "PROCEED_WITH_CAUTION - Learning phase"
                    })
                );
            }

            // Analyze strategy performance
            const strategyWinRate = strategyData?.winRate || 0;
            const strategyTrades = strategyData?.trades || 0;

            // Check if market conditions match optimal conditions
            const optimalConditions = state.insights.optimalMarketConditions;
            const conditionsMatch = args.market_condition?.toLowerCase().includes(optimalConditions?.toLowerCase() || '') ||
                                   optimalConditions?.toLowerCase().includes(args.market_condition?.toLowerCase() || '');

            // Check for relevant success patterns
            const successPatterns = state.insights.successPatterns || [];
            const relevantSuccessPattern = successPatterns.find(p =>
                p.toLowerCase().includes(args.strategy?.toLowerCase() || '') ||
                p.toLowerCase().includes(args.market_condition?.toLowerCase() || '')
            );

            // Check for mistakes to avoid
            const commonMistakes = state.insights.commonMistakes || [];
            const relevantMistake = commonMistakes.find(m =>
                m.toLowerCase().includes(args.strategy?.toLowerCase() || '') ||
                m.toLowerCase().includes(args.market_condition?.toLowerCase() || '')
            );

            // Calculate recommendation
            let recommendation: "GO" | "CAUTION" | "AVOID";
            let confidence: "HIGH" | "MEDIUM" | "LOW";
            let reasons: string[] = [];

            // Decision logic based on learned data
            if (strategyWinRate >= 0.65 && strategyTrades >= 10) {
                recommendation = "GO";
                confidence = strategyTrades >= 30 ? "HIGH" : "MEDIUM";
                reasons.push(`${args.strategy} has ${(strategyWinRate * 100).toFixed(1)}% win rate over ${strategyTrades} trades`);
            } else if (strategyWinRate >= 0.45 && strategyWinRate < 0.65) {
                recommendation = "CAUTION";
                confidence = "MEDIUM";
                reasons.push(`${args.strategy} has ${(strategyWinRate * 100).toFixed(1)}% win rate - moderate performance`);
            } else if (strategyWinRate < 0.45 && strategyTrades >= 10) {
                recommendation = "AVOID";
                confidence = strategyTrades >= 20 ? "HIGH" : "MEDIUM";
                reasons.push(`${args.strategy} has only ${(strategyWinRate * 100).toFixed(1)}% win rate - poor performance`);
            } else {
                recommendation = "CAUTION";
                confidence = "LOW";
                reasons.push(`Insufficient trades (${strategyTrades}) to make confident recommendation`);
            }

            // Adjust based on conditions match
            if (conditionsMatch && strategyWinRate >= 0.5) {
                if (recommendation === "CAUTION") {
                    recommendation = "GO";
                    reasons.push(`Current ${args.market_condition} matches optimal conditions: ${optimalConditions}`);
                }
            }

            // Adjust based on success pattern match
            if (relevantSuccessPattern) {
                reasons.push(`Matches success pattern: "${relevantSuccessPattern}"`);
                if (recommendation === "CAUTION") {
                    recommendation = "GO";
                    confidence = "MEDIUM";
                }
            }

            // Adjust based on mistake pattern match (override to AVOID)
            if (relevantMistake && strategyWinRate < 0.5) {
                recommendation = "AVOID";
                reasons.push(`WARNING: Matches known mistake: "${relevantMistake}"`);
            }

            // Position sizing recommendation
            let positionSize: "FULL" | "HALF" | "QUARTER" | "SKIP";
            switch (recommendation) {
                case "GO":
                    positionSize = confidence === "HIGH" ? "FULL" : "HALF";
                    break;
                case "CAUTION":
                    positionSize = "QUARTER";
                    break;
                case "AVOID":
                    positionSize = "SKIP";
                    break;
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    recommendation,
                    confidence,
                    position_size: positionSize,
                    reasons,
                    strategy_stats: {
                        name: args.strategy,
                        trades: strategyTrades,
                        win_rate: `${(strategyWinRate * 100).toFixed(1)}%`,
                        status: strategyWinRate >= 0.65 ? "PROFITABLE" :
                               strategyWinRate >= 0.45 ? "BREAK_EVEN" : "LOSING"
                    },
                    market_analysis: {
                        current_condition: args.market_condition,
                        optimal_condition: optimalConditions,
                        conditions_match: conditionsMatch
                    },
                    learned_wisdom: {
                        relevant_success_pattern: relevantSuccessPattern || "None found",
                        relevant_mistake_to_avoid: relevantMistake || "None found",
                        best_performing_strategy: state.insights.bestPerformingStrategy
                    },
                    overall_performance: {
                        total_trades: totalTrades,
                        overall_win_rate: `${(state.metrics.winRate * 100).toFixed(1)}%`,
                        total_pnl: `$${state.metrics.totalPnL.toFixed(2)}`
                    },
                    action: recommendation === "GO"
                        ? `PROCEED with ${positionSize} position using ${args.strategy}`
                        : recommendation === "CAUTION"
                            ? `PROCEED CAREFULLY with ${positionSize} position`
                            : `SKIP THIS TRADE - Historical data suggests poor outcome`
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to analyze trade opportunity: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
