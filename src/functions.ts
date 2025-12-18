import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(__dirname, '../.env') });

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { ethers } from 'ethers';

// Base Chain Configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const OPENOCEAN_API = 'https://open-api.openocean.finance/v4/base';
const SILVERBACK_ROUTER = '0x565cBf0F3eAdD873212Db91896e9a548f6D64894';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';

// Common Base tokens
const BASE_TOKENS: Record<string, { address: string; decimals: number; symbol: string }> = {
    'WETH': { address: '0x4200000000000000000000000000000000000006', decimals: 18, symbol: 'WETH' },
    'USDC': { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', decimals: 6, symbol: 'USDC' },
    'USDbC': { address: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', decimals: 6, symbol: 'USDbC' },
    'DAI': { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, symbol: 'DAI' },
    'BACK': { address: '0x558881c4959e9cf961a7E1815FCD6586906babd2', decimals: 18, symbol: 'BACK' },
};

// ABIs
const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
];

const FACTORY_ABI = [
    'function getPair(address tokenA, address tokenB) view returns (address pair)',
    'function allPairsLength() view returns (uint256)',
    'function allPairs(uint256) view returns (address)',
];

const PAIR_ABI = [
    'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function totalSupply() view returns (uint256)',
];

function getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(BASE_RPC_URL);
}

function resolveToken(input: string): { address: string; decimals: number; symbol: string } | null {
    // Check if it's a known symbol
    const upper = input.toUpperCase();
    if (BASE_TOKENS[upper]) {
        return BASE_TOKENS[upper];
    }
    // Check if it's an address
    if (/^0x[a-fA-F0-9]{40}$/.test(input)) {
        return { address: input, decimals: 18, symbol: 'UNKNOWN' };
    }
    return null;
}

/**
 * Get swap quote from OpenOcean aggregator on Base
 * Returns the best price across multiple DEXs
 */
export const getSwapQuoteFunction = new GameFunction({
    name: "get_swap_quote",
    description: "Get a quote for swapping tokens on Base chain via OpenOcean aggregator. Returns best price across multiple DEXs.",
    args: [
        { name: "tokenIn", description: "Input token (address or symbol: WETH, USDC, BACK, DAI)" },
        { name: "tokenOut", description: "Output token (address or symbol: WETH, USDC, BACK, DAI)" },
        { name: "amountIn", description: "Amount of input tokens (human readable, e.g., '1.0' for 1 token)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const tokenInInfo = resolveToken(args.tokenIn || '');
            const tokenOutInfo = resolveToken(args.tokenOut || '');

            if (!tokenInInfo || !tokenOutInfo) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token. Use address or symbol (WETH, USDC, BACK, DAI)"
                );
            }

            logger(`Getting swap quote: ${args.amountIn} ${tokenInInfo.symbol} → ${tokenOutInfo.symbol}`);

            // Convert to wei
            const amountInWei = ethers.parseUnits(args.amountIn || '0', tokenInInfo.decimals);

            // Get gas price
            const gasResponse = await fetch(`${OPENOCEAN_API}/gasPrice`);
            const gasData = gasResponse.ok ? await gasResponse.json() : { standard: '1000000000' };

            // Get quote from OpenOcean
            const quoteUrl = `${OPENOCEAN_API}/quote?` +
                `inTokenAddress=${tokenInInfo.address}&` +
                `outTokenAddress=${tokenOutInfo.address}&` +
                `amount=${amountInWei.toString()}&` +
                `gasPrice=${gasData.standard || '1000000000'}`;

            const response = await fetch(quoteUrl);

            if (!response.ok) {
                throw new Error(`Quote failed: ${response.statusText}`);
            }

            const data = await response.json();

            if (!data.data || !data.data.outAmount) {
                throw new Error('No quote available for this pair');
            }

            const amountOut = ethers.formatUnits(data.data.outAmount, tokenOutInfo.decimals);

            logger(`Quote: ${amountOut} ${tokenOutInfo.symbol} (${data.data.dexes?.length || 1} DEXs)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    tokenIn: tokenInInfo.symbol,
                    tokenOut: tokenOutInfo.symbol,
                    amountIn: args.amountIn,
                    amountOut: amountOut,
                    priceImpact: (data.data.estimatedPriceImpact || '0') + '%',
                    dexesUsed: data.data.dexes?.length || 1,
                    estimatedGas: data.data.estimatedGas || 'N/A',
                    aggregator: 'OpenOcean',
                    router: SILVERBACK_ROUTER,
                    chain: 'Base',
                    chainId: 8453
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
 * Get DEX metrics and statistics for Base chain
 */
export const getDEXMetricsFunction = new GameFunction({
    name: "get_dex_metrics",
    description: "Get Silverback DEX metrics on Base chain including gas prices and routing info",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching Base chain DEX metrics...");

            // Get gas prices from OpenOcean
            const gasResponse = await fetch(`${OPENOCEAN_API}/gasPrice`);
            const gasData = gasResponse.ok ? await gasResponse.json() : null;

            // Get sample quote to verify routing works
            const weth = BASE_TOKENS['WETH'].address;
            const usdc = BASE_TOKENS['USDC'].address;
            const amountIn = ethers.parseUnits('1', 18); // 1 WETH

            const quoteResponse = await fetch(
                `${OPENOCEAN_API}/quote?inTokenAddress=${weth}&outTokenAddress=${usdc}&amount=${amountIn}&gasPrice=${gasData?.standard || '1000000000'}`
            );

            let ethPrice = 'N/A';
            let dexCount = 0;
            if (quoteResponse.ok) {
                const quoteData = await quoteResponse.json();
                if (quoteData.data?.outAmount) {
                    ethPrice = '$' + (parseFloat(quoteData.data.outAmount) / 1e6).toFixed(2);
                    dexCount = quoteData.data.dexes?.length || 0;
                }
            }

            // Get factory pair count
            let pairCount = 'N/A';
            try {
                const provider = getProvider();
                const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);
                const count = await factory.allPairsLength();
                pairCount = count.toString();
            } catch {
                // Factory query failed, continue without it
            }

            logger(`Metrics: ${pairCount} Silverback pairs, ${dexCount} DEXs aggregated`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    network: 'Base',
                    chainId: 8453,
                    protocol: 'Silverback DEX',
                    aggregator: 'OpenOcean',
                    silverbackPairs: pairCount,
                    dexesAggregated: dexCount,
                    ethPrice: ethPrice,
                    gasPrice: {
                        standard: gasData?.standard ? (parseFloat(gasData.standard) / 1e9).toFixed(2) + ' gwei' : 'N/A',
                        fast: gasData?.fast ? (parseFloat(gasData.fast) / 1e9).toFixed(2) + ' gwei' : 'N/A'
                    },
                    router: SILVERBACK_ROUTER,
                    factory: SILVERBACK_V2_FACTORY,
                    timestamp: new Date().toISOString()
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
 * Get token price via OpenOcean quote (WETH as reference)
 */
export const getTokenPriceFunction = new GameFunction({
    name: "get_token_price",
    description: "Get current USD price for a token on Base chain via OpenOcean",
    args: [
        { name: "token", description: "Token address or symbol (WETH, USDC, BACK, DAI)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const tokenInfo = resolveToken(args.token || '');
            if (!tokenInfo) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token. Use address or symbol (WETH, USDC, BACK, DAI)"
                );
            }

            logger(`Fetching price for: ${tokenInfo.symbol}`);

            // If it's USDC, price is $1
            if (tokenInfo.symbol === 'USDC' || tokenInfo.symbol === 'USDbC') {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        token: tokenInfo.symbol,
                        address: tokenInfo.address,
                        priceUSD: '1.00',
                        chain: 'Base'
                    })
                );
            }

            // Quote token against USDC
            const usdc = BASE_TOKENS['USDC'];
            const amount = ethers.parseUnits('1', tokenInfo.decimals);

            const gasResponse = await fetch(`${OPENOCEAN_API}/gasPrice`);
            const gasData = gasResponse.ok ? await gasResponse.json() : { standard: '1000000000' };

            const quoteResponse = await fetch(
                `${OPENOCEAN_API}/quote?inTokenAddress=${tokenInfo.address}&outTokenAddress=${usdc.address}&amount=${amount}&gasPrice=${gasData.standard}`
            );

            if (!quoteResponse.ok) {
                throw new Error('Failed to get price quote');
            }

            const data = await quoteResponse.json();
            if (!data.data?.outAmount) {
                throw new Error('No price data available');
            }

            const priceUSD = (parseFloat(data.data.outAmount) / 1e6).toFixed(4);

            logger(`Price: $${priceUSD}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    token: tokenInfo.symbol,
                    address: tokenInfo.address,
                    priceUSD: priceUSD,
                    chain: 'Base',
                    source: 'OpenOcean'
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
 * Get information about a Silverback liquidity pool on Base
 */
export const getPoolInfoFunction = new GameFunction({
    name: "get_pool_info",
    description: "Get detailed information about a Silverback liquidity pool on Base",
    args: [
        { name: "tokenA", description: "First token (address or symbol)" },
        { name: "tokenB", description: "Second token (address or symbol)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const tokenAInfo = resolveToken(args.tokenA || '');
            const tokenBInfo = resolveToken(args.tokenB || '');

            if (!tokenAInfo || !tokenBInfo) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid token. Use address or symbol (WETH, USDC, BACK, DAI)"
                );
            }

            logger(`Fetching pool: ${tokenAInfo.symbol}/${tokenBInfo.symbol}`);

            const provider = getProvider();
            const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

            // Get pair address
            const pairAddress = await factory.getPair(tokenAInfo.address, tokenBInfo.address);

            if (pairAddress === ethers.ZeroAddress) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `No Silverback pool exists for ${tokenAInfo.symbol}/${tokenBInfo.symbol}`
                );
            }

            // Get pair details
            const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
            const [reserves, token0, token1, totalSupply] = await Promise.all([
                pair.getReserves(),
                pair.token0(),
                pair.token1(),
                pair.totalSupply()
            ]);

            // Determine which reserve is which token
            const isToken0First = token0.toLowerCase() === tokenAInfo.address.toLowerCase();
            const reserveA = isToken0First ? reserves[0] : reserves[1];
            const reserveB = isToken0First ? reserves[1] : reserves[0];

            const reserveAFormatted = ethers.formatUnits(reserveA, tokenAInfo.decimals);
            const reserveBFormatted = ethers.formatUnits(reserveB, tokenBInfo.decimals);

            logger(`Pool found: ${reserveAFormatted} ${tokenAInfo.symbol} / ${reserveBFormatted} ${tokenBInfo.symbol}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    pairAddress: pairAddress,
                    tokenA: {
                        address: tokenAInfo.address,
                        symbol: tokenAInfo.symbol,
                        reserve: reserveAFormatted
                    },
                    tokenB: {
                        address: tokenBInfo.address,
                        symbol: tokenBInfo.symbol,
                        reserve: reserveBFormatted
                    },
                    totalSupply: ethers.formatUnits(totalSupply, 18),
                    fee: '0.3%',
                    protocol: 'Silverback V2',
                    chain: 'Base',
                    factory: SILVERBACK_V2_FACTORY
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

/**
 * Get list of Silverback pools on Base (queries factory)
 */
export const getPoolsFunction = new GameFunction({
    name: "get_pools",
    description: "Get list of Silverback liquidity pools on Base chain",
    args: [
        { name: "limit", description: "Max pools to return (default: 10)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const limit = parseInt(args.limit || '10');
            logger(`Fetching up to ${limit} Silverback pools...`);

            const provider = getProvider();
            const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

            const pairCount = await factory.allPairsLength();
            const count = Math.min(Number(pairCount), limit);

            logger(`Found ${pairCount} total pairs, fetching ${count}...`);

            const pools = [];
            for (let i = 0; i < count; i++) {
                try {
                    const pairAddress = await factory.allPairs(i);
                    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);

                    const [token0, token1, reserves] = await Promise.all([
                        pair.token0(),
                        pair.token1(),
                        pair.getReserves()
                    ]);

                    // Try to get token symbols
                    let symbol0 = 'Unknown';
                    let symbol1 = 'Unknown';
                    try {
                        const t0 = new ethers.Contract(token0, ERC20_ABI, provider);
                        const t1 = new ethers.Contract(token1, ERC20_ABI, provider);
                        symbol0 = await t0.symbol();
                        symbol1 = await t1.symbol();
                    } catch {
                        // Symbol lookup failed
                    }

                    pools.push({
                        index: i,
                        pairAddress,
                        token0: { address: token0, symbol: symbol0 },
                        token1: { address: token1, symbol: symbol1 },
                        reserve0: reserves[0].toString(),
                        reserve1: reserves[1].toString()
                    });
                } catch {
                    // Skip failed pairs
                }
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    totalPairs: pairCount.toString(),
                    returned: pools.length,
                    pools: pools,
                    factory: SILVERBACK_V2_FACTORY,
                    chain: 'Base'
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
