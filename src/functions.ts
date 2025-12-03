import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

// Silverback DEX API base URL
const DEX_API_URL = process.env.DEX_API_URL || 'https://dexkeeta.onrender.com/api';

/**
 * Get swap quote from Silverback DEX
 * Returns the best price for swapping tokens using Silverback's anchor pools
 */
export const getSwapQuoteFunction = new GameFunction({
    name: "get_swap_quote",
    description: "Get a quote for swapping tokens on Silverback DEX. Returns amount out, price impact, and fees.",
    args: [
        { name: "tokenIn", description: "Input token address (keeta_ format)" },
        { name: "tokenOut", description: "Output token address (keeta_ format)" },
        { name: "amountIn", description: "Amount of input tokens (in smallest units)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            logger(`Getting swap quote: ${args.amountIn} ${args.tokenIn} → ${args.tokenOut}`);

            const response = await fetch(`${DEX_API_URL}/anchor/quote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tokenIn: args.tokenIn,
                    tokenOut: args.tokenOut,
                    amountIn: args.amountIn,
                    decimalsIn: 9,  // Default Keeta token decimals
                    decimalsOut: 9
                })
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Quote failed: ${error}`);
            }

            const quote = await response.json();

            logger(`Quote received: ${quote.amountOutFormatted} tokens (${quote.feeBps / 100}% fee)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    amountOut: quote.amountOut,
                    amountOutFormatted: quote.amountOutFormatted,
                    poolAddress: quote.poolAddress,
                    feeBps: quote.feeBps,
                    feePercent: quote.feeBps / 100,
                    priceImpact: quote.priceImpact || "minimal",
                    route: "Silverback Anchor Pool"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get swap quote: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get list of available liquidity pools on Silverback DEX
 */
export const getPoolsFunction = new GameFunction({
    name: "get_pools",
    description: "Get list of available liquidity pools on Silverback DEX with their reserves and APY",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching available liquidity pools...");

            const response = await fetch(`${DEX_API_URL}/anchor/pools`);

            if (!response.ok) {
                throw new Error(`Failed to fetch pools: ${response.statusText}`);
            }

            const pools = await response.json();

            logger(`Found ${pools.length} active pools`);

            // Format pools data for the agent
            const poolsData = pools.map((pool: any) => ({
                address: pool.pool_address,
                tokenA: pool.token_a,
                tokenB: pool.token_b,
                reserveA: pool.reserve_a,
                reserveB: pool.reserve_b,
                feeBps: pool.fee_bps,
                feePercent: pool.fee_bps / 100,
                volume24h: pool.volume_24h || "N/A",
                apy: pool.apy || "N/A",
                status: pool.status
            }));

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    totalPools: pools.length,
                    pools: poolsData
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch pools: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get DEX metrics and statistics
 */
export const getDEXMetricsFunction = new GameFunction({
    name: "get_dex_metrics",
    description: "Get Silverback DEX overall metrics including total liquidity, 24h volume, and active pools",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching DEX metrics...");

            // Fetch pools to calculate metrics
            const response = await fetch(`${DEX_API_URL}/anchor/pools`);

            if (!response.ok) {
                throw new Error(`Failed to fetch metrics: ${response.statusText}`);
            }

            const pools = await response.json();

            // Calculate total liquidity (sum of all pool reserves)
            const totalLiquidity = pools.reduce((sum: number, pool: any) => {
                return sum + Number(pool.reserve_a || 0) + Number(pool.reserve_b || 0);
            }, 0);

            // Calculate 24h volume
            const volume24h = pools.reduce((sum: number, pool: any) => {
                return sum + Number(pool.volume_24h || 0);
            }, 0);

            logger(`Metrics: ${pools.length} pools, $${(totalLiquidity / 1e9).toFixed(2)} TVL`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    totalPools: pools.length,
                    activePools: pools.filter((p: any) => p.status === 'active').length,
                    totalLiquidity: (totalLiquidity / 1e9).toFixed(2),
                    volume24h: (volume24h / 1e9).toFixed(2),
                    currency: "KTA",  // Keeta Network native token
                    protocol: "Silverback DEX",
                    network: "Keeta Network"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch DEX metrics: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get token price in USD
 */
export const getTokenPriceFunction = new GameFunction({
    name: "get_token_price",
    description: "Get current USD price for a token from Silverback DEX pricing data",
    args: [
        { name: "tokenAddress", description: "Token address (keeta_ format)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            logger(`Fetching price for token: ${args.tokenAddress}`);

            const response = await fetch(`${DEX_API_URL}/pricing/tokens`);

            if (!response.ok) {
                throw new Error(`Failed to fetch token prices: ${response.statusText}`);
            }

            const tokens = await response.json();
            const token = tokens.find((t: any) => t.address === args.tokenAddress);

            if (!token) {
                throw new Error(`Token not found: ${args.tokenAddress}`);
            }

            logger(`Price: $${token.usd_price} (${token.symbol})`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    address: token.address,
                    symbol: token.symbol,
                    name: token.name,
                    usdPrice: token.usd_price,
                    change24h: token.change_24h || "N/A",
                    volume24h: token.volume_24h || "N/A"
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
 * Get information about a specific pool
 */
export const getPoolInfoFunction = new GameFunction({
    name: "get_pool_info",
    description: "Get detailed information about a specific liquidity pool",
    args: [
        { name: "poolAddress", description: "Pool address (keeta_ format)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            logger(`Fetching pool info: ${args.poolAddress}`);

            const response = await fetch(`${DEX_API_URL}/anchor/pools/${args.poolAddress}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch pool: ${response.statusText}`);
            }

            const pool = await response.json();

            logger(`Pool: ${pool.token_a_symbol}/${pool.token_b_symbol} - ${pool.fee_bps / 100}% fee`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    address: pool.pool_address,
                    tokenA: {
                        address: pool.token_a,
                        symbol: pool.token_a_symbol,
                        reserve: pool.reserve_a
                    },
                    tokenB: {
                        address: pool.token_b,
                        symbol: pool.token_b_symbol,
                        reserve: pool.reserve_b
                    },
                    feeBps: pool.fee_bps,
                    feePercent: pool.fee_bps / 100,
                    totalSupply: pool.total_supply,
                    status: pool.status,
                    apy: pool.apy || "N/A",
                    volume24h: pool.volume_24h || "N/A"
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get pool info: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

