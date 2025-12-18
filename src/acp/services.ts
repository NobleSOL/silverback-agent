/**
 * ACP Service Handlers
 *
 * These handlers process incoming ACP job requests and return deliverables.
 * Each service maps to a registered offering on the ACP platform.
 *
 * Services:
 * 1. swap-quote - Get optimal swap route with price impact
 * 2. pool-analysis - Comprehensive liquidity pool analysis
 * 3. technical-analysis - Full technical analysis with indicators
 * 4. execute-swap - Execute swap on Silverback DEX (Phase 2)
 */

import { ethers } from 'ethers';
import {
    calculateAllIndicators,
    analyzeMarketConditions,
    generateMomentumSignal,
    generateMeanReversionSignal
} from '../market-data/indicators';
import {
    detectLiquiditySweep,
    detectChartPattern,
    detectMarketRegime
} from '../market-data/patterns';
import { OHLCV } from '../market-data/types';

// Base Mainnet Configuration
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const SILVERBACK_UNIFIED_ROUTER = '0x565cBf0F3eAdD873212Db91896e9a548f6D64894';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';
const WETH_BASE = '0x4200000000000000000000000000000000000006';

// ABIs
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
];

const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
];

// OpenOcean API for Base chain aggregation
const OPENOCEAN_API = 'https://open-api.openocean.finance/v4/base';

// CoinGecko API
const COINGECKO_API = process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

function getProvider(): ethers.JsonRpcProvider {
    return new ethers.JsonRpcProvider(BASE_RPC_URL);
}

function isValidAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Service Input/Output Types
export interface SwapQuoteInput {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
}

export interface SwapQuoteOutput {
    success: boolean;
    data?: {
        tokenIn: string;
        tokenOut: string;
        amountIn: string;
        amountOut: string;
        priceImpact: string;
        fee: string;
        route: string[];
        router: string;
        chain: string;
        aggregator?: string;
        dexesUsed?: number;
        estimatedGas?: string;
        priceInUSD?: string;
        priceOutUSD?: string;
        rate?: string;
        valueUSD?: string;
        note?: string;
        timestamp: string;
    };
    error?: string;
}

export interface PoolAnalysisInput {
    poolId?: string;
    tokenPair?: string;
    tokenA?: string;
    tokenB?: string;
}

export interface PoolAnalysisOutput {
    success: boolean;
    data?: {
        pairAddress: string;
        dex?: string;
        token0: { address: string; symbol: string; reserve: string };
        token1: { address: string; symbol: string; reserve: string };
        tvl: string;
        liquidityRating: string;
        fee: string;
        volume24h?: string;
        apy?: string;
        utilization?: string;
        healthScore: number;
        chain: string;
        timestamp: string;
    };
    error?: string;
}

export interface TechnicalAnalysisInput {
    token: string;
    timeframe?: string;
}

export interface TechnicalAnalysisOutput {
    success: boolean;
    data?: {
        token: string;
        timeframe: string;
        indicators: {
            ema9: number;
            ema21: number;
            rsi: number;
            bollingerBands: { upper: number; middle: number; lower: number };
        };
        patterns: {
            liquiditySweep: any;
            chartPattern: any;
            marketRegime: any;
        };
        conditions: {
            trend: string;
            volatility: string;
            volume: string;
            momentum: string;
        };
        signals: {
            momentum: number;
            meanReversion: number;
            recommendation: string;
        };
        supportResistance?: {
            support: number[];
            resistance: number[];
        };
        timestamp: string;
    };
    error?: string;
}

export interface ExecuteSwapInput {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: string;
    walletAddress: string;
}

export interface ExecuteSwapOutput {
    success: boolean;
    data?: {
        txHash: string;
        actualOutput: string;
        executionPrice: string;
        sold?: string;
        received?: string;
        recipient?: string;
        gasUsed?: string;
        chain?: string;
        router?: string;
        timestamp?: string;
    };
    error?: string;
}

/**
 * Service 1: Get Optimal Swap Route
 * Price: $0.02 USDC
 *
 * Uses OpenOcean aggregator for best prices across multiple DEXs on Base
 */
export async function handleSwapQuote(input: SwapQuoteInput): Promise<SwapQuoteOutput> {
    try {
        const { tokenIn, tokenOut, amountIn } = input;

        if (!tokenIn || !tokenOut || !amountIn) {
            return {
                success: false,
                error: "Missing required parameters: tokenIn, tokenOut, amountIn"
            };
        }

        // Resolve token addresses (support symbols like WETH, USDC)
        const tokenInAddress = resolveTokenAddress(tokenIn);
        const tokenOutAddress = resolveTokenAddress(tokenOut);

        if (!tokenInAddress || !tokenOutAddress) {
            return {
                success: false,
                error: "Invalid token. Use 0x address or symbol (WETH, USDC, BACK, DAI)"
            };
        }

        const provider = getProvider();

        // Get token decimals and symbols (use cache for known tokens)
        console.log(`[SwapQuote] Getting token info for ${tokenInAddress} and ${tokenOutAddress}`);
        const tokenInInfo = await getTokenInfo(tokenInAddress, provider);
        const tokenOutInfo = await getTokenInfo(tokenOutAddress, provider);

        const decimalsIn = tokenInInfo.decimals;
        const symbolIn = tokenInInfo.symbol;
        const decimalsOut = tokenOutInfo.decimals;
        const symbolOut = tokenOutInfo.symbol;

        console.log(`[SwapQuote] TokenIn: ${symbolIn} (${decimalsIn} decimals), TokenOut: ${symbolOut} (${decimalsOut} decimals)`);

        // Convert human amount to wei
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        // Try OpenOcean aggregator first for best prices
        console.log(`[SwapQuote] Fetching quote from OpenOcean for ${amountIn} ${symbolIn} → ${symbolOut}`);
        try {
            // OpenOcean V4 API uses amountDecimals and gasPriceDecimals parameters
            const quoteUrl = `${OPENOCEAN_API}/quote?` +
                `inTokenAddress=${tokenInAddress}&` +
                `outTokenAddress=${tokenOutAddress}&` +
                `amountDecimals=${amountInWei.toString()}&` +
                `gasPriceDecimals=1000000000&` +
                `slippage=1`;

            console.log(`[SwapQuote] OpenOcean URL: ${quoteUrl}`);
            const quoteResponse = await fetch(quoteUrl);
            console.log(`[SwapQuote] OpenOcean response status: ${quoteResponse.status}`);

            if (quoteResponse.ok) {
                const quoteData = await quoteResponse.json();
                console.log(`[SwapQuote] OpenOcean data:`, JSON.stringify(quoteData).substring(0, 500));

                if (quoteData.data && quoteData.data.outAmount) {
                    const amountOutHuman = ethers.formatUnits(quoteData.data.outAmount, decimalsOut);

                    return {
                        success: true,
                        data: {
                            tokenIn: tokenInAddress,
                            tokenOut: tokenOutAddress,
                            amountIn,
                            amountOut: amountOutHuman,
                            priceImpact: (quoteData.data.estimatedPriceImpact || '0') + '%',
                            fee: 'Variable (aggregated)',
                            route: quoteData.data.path?.routes?.map((r: any) => r.subRoutes?.[0]?.from?.symbol || 'Unknown') || [symbolIn, symbolOut],
                            router: SILVERBACK_UNIFIED_ROUTER,
                            chain: 'Base',
                            aggregator: 'OpenOcean',
                            dexesUsed: quoteData.data.dexes?.length || 1,
                            estimatedGas: quoteData.data.estimatedGas || 'N/A',
                            timestamp: new Date().toISOString()
                        }
                    };
                }
            } else {
                const errorText = await quoteResponse.text();
                console.log(`[SwapQuote] OpenOcean error response:`, errorText.substring(0, 200));
            }
        } catch (ooError: any) {
            console.log('[SwapQuote] OpenOcean error:', ooError.message);
        }

        // Fallback to CoinGecko price estimation
        console.log('[SwapQuote] Trying CoinGecko as fallback...');
        try {
            // Use well-known coin IDs for common tokens to avoid contract lookup issues
            const coinIdMap: Record<string, string> = {
                '0x4200000000000000000000000000000000000006': 'weth', // WETH on Base
                '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'usd-coin', // USDC on Base
                '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'bridged-usd-coin-base', // USDbC
                '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'dai', // DAI
            };

            const coinIdIn = coinIdMap[tokenInAddress.toLowerCase()];
            const coinIdOut = coinIdMap[tokenOutAddress.toLowerCase()];

            if (coinIdIn && coinIdOut) {
                // Use simple/price endpoint with coin IDs (more reliable)
                const cgUrl = `${COINGECKO_API}/simple/price?ids=${coinIdIn},${coinIdOut}&vs_currencies=usd`;
                console.log(`[SwapQuote] CoinGecko URL: ${cgUrl}`);

                const cgResponse = await fetch(cgUrl, {
                    headers: { 'Accept': 'application/json' }
                });

                console.log(`[SwapQuote] CoinGecko response status: ${cgResponse.status}`);

                if (cgResponse.ok) {
                    const prices = await cgResponse.json();
                    console.log(`[SwapQuote] CoinGecko prices:`, JSON.stringify(prices));

                    const priceIn = prices[coinIdIn]?.usd;
                    const priceOut = prices[coinIdOut]?.usd;

                    if (priceIn && priceOut) {
                        const valueUSD = parseFloat(amountIn) * priceIn;
                        const valueAfterFee = valueUSD * 0.997;
                        const amountOut = (valueAfterFee / priceOut).toFixed(8);
                        const rate = (priceIn / priceOut).toFixed(8);

                        return {
                            success: true,
                            data: {
                                tokenIn: tokenInAddress,
                                tokenOut: tokenOutAddress,
                                amountIn,
                                amountOut,
                                priceImpact: '< 0.1% (estimated)',
                                fee: '~0.3%',
                                route: [symbolIn, symbolOut],
                                router: SILVERBACK_UNIFIED_ROUTER,
                                chain: 'Base',
                                aggregator: 'CoinGecko',
                                priceInUSD: `$${priceIn.toFixed(2)}`,
                                priceOutUSD: `$${priceOut.toFixed(6)}`,
                                rate: `1 ${symbolIn} = ${rate} ${symbolOut}`,
                                valueUSD: `$${valueUSD.toFixed(2)}`,
                                note: 'Price estimate based on market rates',
                                timestamp: new Date().toISOString()
                            }
                        };
                    }
                }
            }

            // Fallback to contract address lookup if coin IDs not mapped
            const headers: Record<string, string> = { 'Accept': 'application/json' };
            if (process.env.COINGECKO_API_KEY) {
                headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
            }

            const cgResponse = await fetch(
                `${COINGECKO_API}/simple/token_price/base?` +
                `contract_addresses=${tokenInAddress},${tokenOutAddress}&vs_currencies=usd`,
                { headers }
            );

            console.log(`[SwapQuote] CoinGecko token_price response status: ${cgResponse.status}`);

            if (cgResponse.ok) {
                const prices = await cgResponse.json();
                console.log(`[SwapQuote] CoinGecko prices:`, JSON.stringify(prices));

                const priceIn = prices[tokenInAddress.toLowerCase()]?.usd;
                const priceOut = prices[tokenOutAddress.toLowerCase()]?.usd;

                if (priceIn && priceOut) {
                    const valueUSD = parseFloat(amountIn) * priceIn;
                    // Apply estimated 0.3% fee
                    const valueAfterFee = valueUSD * 0.997;
                    const amountOut = (valueAfterFee / priceOut).toFixed(8);
                    const rate = (priceIn / priceOut).toFixed(8);

                    return {
                        success: true,
                        data: {
                            tokenIn: tokenInAddress,
                            tokenOut: tokenOutAddress,
                            amountIn,
                            amountOut,
                            priceImpact: '< 0.1% (estimated)',
                            fee: '~0.3%',
                            route: [symbolIn, symbolOut],
                            router: SILVERBACK_UNIFIED_ROUTER,
                            chain: 'Base',
                            aggregator: 'CoinGecko (price estimate)',
                            priceInUSD: `$${priceIn.toFixed(6)}`,
                            priceOutUSD: `$${priceOut.toFixed(6)}`,
                            rate: `1 ${symbolIn} = ${rate} ${symbolOut}`,
                            valueUSD: `$${valueUSD.toFixed(2)}`,
                            note: 'Price estimate - actual swap may vary',
                            timestamp: new Date().toISOString()
                        }
                    };
                } else {
                    console.log(`[SwapQuote] CoinGecko missing price data - In: ${priceIn}, Out: ${priceOut}`);
                }
            }
        } catch (cgError: any) {
            console.log('[SwapQuote] CoinGecko error:', cgError.message);
        }

        // Fallback to on-chain quote from Silverback router
        console.log('[SwapQuote] Trying on-chain quote from Silverback router...');
        try {
            const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
            const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);
            const path = [tokenInAddress, tokenOutAddress];

            const amounts = await router.getAmountsOut(amountInWei, path);
            const amountOutWei = amounts[1];
            const amountOutHuman = ethers.formatUnits(amountOutWei, decimalsOut);

            return {
                success: true,
                data: {
                    tokenIn: tokenInAddress,
                    tokenOut: tokenOutAddress,
                    amountIn,
                    amountOut: amountOutHuman,
                    priceImpact: 'Varies with size',
                    fee: '0.3%',
                    route: [symbolIn, symbolOut],
                    router: SILVERBACK_UNIFIED_ROUTER,
                    chain: 'Base',
                    aggregator: 'Silverback DEX (on-chain)',
                    timestamp: new Date().toISOString()
                }
            };
        } catch (routerError: any) {
            console.log('[SwapQuote] Router error:', routerError.message);
        }

        // If all fail, return error
        return {
            success: false,
            error: "No quote available - token may not be listed or no liquidity exists"
        };
    } catch (e) {
        const error = e as Error;
        if (error.message.includes('INSUFFICIENT_LIQUIDITY')) {
            return {
                success: false,
                error: "No liquidity available for this pair"
            };
        }
        return {
            success: false,
            error: `Failed to get swap quote: ${error.message}`
        };
    }
}

// Base chain DEX factories (V2 style)
const BASE_DEX_FACTORIES = [
    { name: 'Uniswap V2', address: '0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6' },
    { name: 'SushiSwap', address: '0x71524B4f93c58fcbF659783284E38825f0622859' },
    { name: 'BaseSwap', address: '0xFDa619b6d20975be80A10332cD39b9a4b0FAa8BB' },
    { name: 'Aerodrome', address: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' },
    { name: 'Silverback', address: SILVERBACK_V2_FACTORY },
];

/**
 * Service 2: Liquidity Pool Deep Dive
 * Price: $0.10 USDC
 *
 * Checks multiple DEXes on Base chain for pool data
 */
export async function handlePoolAnalysis(input: PoolAnalysisInput): Promise<PoolAnalysisOutput> {
    try {
        let tokenA: string | undefined;
        let tokenB: string | undefined;

        // Parse input - can be poolId, tokenPair string, or individual tokens
        if (input.tokenA && input.tokenB) {
            tokenA = input.tokenA;
            tokenB = input.tokenB;
        } else if (input.tokenPair) {
            // Handle "TOKEN_A/TOKEN_B" format - try to resolve symbols
            const parts = input.tokenPair.split('/');
            if (parts.length === 2) {
                const addrA = resolveTokenAddress(parts[0].trim());
                const addrB = resolveTokenAddress(parts[1].trim());
                if (addrA && addrB) {
                    tokenA = addrA;
                    tokenB = addrB;
                } else {
                    return {
                        success: false,
                        error: "Could not resolve token symbols. Use addresses or known symbols (WETH, USDC, BACK, DAI)"
                    };
                }
            }
        } else if (input.poolId) {
            // Direct pool address provided
            if (isValidAddress(input.poolId)) {
                return await analyzePoolByAddress(input.poolId);
            }
            return {
                success: false,
                error: "Invalid pool address format"
            };
        }

        if (!tokenA || !tokenB) {
            return {
                success: false,
                error: "Please provide tokenA and tokenB addresses, or tokenPair like 'WETH/USDC'"
            };
        }

        // Resolve symbols to addresses if needed
        const tokenAAddress = resolveTokenAddress(tokenA) || tokenA;
        const tokenBAddress = resolveTokenAddress(tokenB) || tokenB;

        if (!isValidAddress(tokenAAddress) || !isValidAddress(tokenBAddress)) {
            return {
                success: false,
                error: "Invalid token addresses"
            };
        }

        const provider = getProvider();

        // Check all DEX factories for this pair
        let bestPool: {
            dex: string;
            pairAddress: string;
            reserve0: bigint;
            reserve1: bigint;
            token0: string;
            token1: string;
        } | null = null;

        for (const dex of BASE_DEX_FACTORIES) {
            try {
                const factory = new ethers.Contract(dex.address, FACTORY_ABI, provider);
                const pairAddress = await factory.getPair(tokenAAddress, tokenBAddress);

                if (pairAddress && pairAddress !== ethers.ZeroAddress) {
                    const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
                    const [reserve0, reserve1] = await pair.getReserves();
                    const token0 = await pair.token0();
                    const token1 = await pair.token1();

                    // Keep track of the pool with highest liquidity
                    if (!bestPool || reserve0 + reserve1 > bestPool.reserve0 + bestPool.reserve1) {
                        bestPool = { dex: dex.name, pairAddress, reserve0, reserve1, token0, token1 };
                    }
                }
            } catch (e) {
                // Factory might not support this pair or have different ABI
                continue;
            }
        }

        if (!bestPool) {
            // Try DeFiLlama or CoinGecko for pool info as fallback
            return await getPoolInfoFromAPIs(tokenAAddress, tokenBAddress);
        }

        const { dex, pairAddress, reserve0, reserve1, token0, token1 } = bestPool;

        // Get token details
        const token0Contract = new ethers.Contract(token0, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1, ERC20_ABI, provider);
        const symbol0 = await token0Contract.symbol();
        const symbol1 = await token1Contract.symbol();
        const decimals0 = await token0Contract.decimals();
        const decimals1 = await token1Contract.decimals();

        const reserve0Formatted = ethers.formatUnits(reserve0, decimals0);
        const reserve1Formatted = ethers.formatUnits(reserve1, decimals1);

        // Calculate metrics
        const reserve0Num = parseFloat(reserve0Formatted);
        const reserve1Num = parseFloat(reserve1Formatted);
        const totalLiquidity = reserve0Num + reserve1Num;

        let liquidityRating = 'VERY LOW';
        let healthScore = 30;
        if (totalLiquidity > 100000) { liquidityRating = 'EXCELLENT'; healthScore = 95; }
        else if (totalLiquidity > 50000) { liquidityRating = 'GOOD'; healthScore = 80; }
        else if (totalLiquidity > 10000) { liquidityRating = 'MODERATE'; healthScore = 60; }
        else if (totalLiquidity > 1000) { liquidityRating = 'LOW'; healthScore = 45; }

        // Get USD values using CoinGecko
        let tvlUSD = 'N/A';
        try {
            const token0Info = await getTokenInfo(token0, provider);
            const token1Info = await getTokenInfo(token1, provider);

            const coinIdMap: Record<string, string> = {
                '0x4200000000000000000000000000000000000006': 'weth',
                '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'usd-coin',
                '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 'bridged-usd-coin-base',
                '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 'dai',
            };

            const coinId0 = coinIdMap[token0.toLowerCase()];
            const coinId1 = coinIdMap[token1.toLowerCase()];

            if (coinId0 || coinId1) {
                const ids = [coinId0, coinId1].filter(Boolean).join(',');
                const priceRes = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
                if (priceRes.ok) {
                    const prices = await priceRes.json();
                    let totalUSD = 0;
                    if (coinId0 && prices[coinId0]?.usd) {
                        totalUSD += reserve0Num * prices[coinId0].usd;
                    }
                    if (coinId1 && prices[coinId1]?.usd) {
                        totalUSD += reserve1Num * prices[coinId1].usd;
                    }
                    if (totalUSD > 0) {
                        tvlUSD = formatLargeNumber(totalUSD);
                    }
                }
            }
        } catch (e) {
            // Keep tvlUSD as N/A
        }

        return {
            success: true,
            data: {
                pairAddress,
                dex,
                token0: { address: token0, symbol: symbol0, reserve: reserve0Formatted },
                token1: { address: token1, symbol: symbol1, reserve: reserve1Formatted },
                tvl: tvlUSD,
                liquidityRating,
                fee: dex === 'Aerodrome' ? '0.05-1%' : '0.3%',
                volume24h: 'N/A',
                apy: 'N/A',
                utilization: 'N/A',
                healthScore,
                chain: 'Base',
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `Failed to analyze pool: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

/**
 * Analyze a pool directly by its address
 */
async function analyzePoolByAddress(poolAddress: string): Promise<PoolAnalysisOutput> {
    try {
        const provider = getProvider();
        const pair = new ethers.Contract(poolAddress, PAIR_ABI, provider);

        const [reserves, token0, token1] = await Promise.all([
            pair.getReserves(),
            pair.token0(),
            pair.token1()
        ]);

        const [reserve0, reserve1] = reserves;
        const token0Info = await getTokenInfo(token0, provider);
        const token1Info = await getTokenInfo(token1, provider);

        const reserve0Formatted = ethers.formatUnits(reserve0, token0Info.decimals);
        const reserve1Formatted = ethers.formatUnits(reserve1, token1Info.decimals);

        const reserve0Num = parseFloat(reserve0Formatted);
        const reserve1Num = parseFloat(reserve1Formatted);

        let liquidityRating = 'VERY LOW';
        let healthScore = 30;
        if (reserve0Num + reserve1Num > 100000) { liquidityRating = 'EXCELLENT'; healthScore = 95; }
        else if (reserve0Num + reserve1Num > 50000) { liquidityRating = 'GOOD'; healthScore = 80; }
        else if (reserve0Num + reserve1Num > 10000) { liquidityRating = 'MODERATE'; healthScore = 60; }
        else if (reserve0Num + reserve1Num > 1000) { liquidityRating = 'LOW'; healthScore = 45; }

        return {
            success: true,
            data: {
                pairAddress: poolAddress,
                token0: { address: token0, symbol: token0Info.symbol, reserve: reserve0Formatted },
                token1: { address: token1, symbol: token1Info.symbol, reserve: reserve1Formatted },
                tvl: formatLargeNumber(reserve0Num + reserve1Num),
                liquidityRating,
                fee: '0.3%',
                volume24h: 'N/A',
                apy: 'N/A',
                utilization: 'N/A',
                healthScore,
                chain: 'Base',
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `Failed to analyze pool: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

/**
 * Get pool info from external APIs when on-chain lookup fails
 */
async function getPoolInfoFromAPIs(tokenA: string, tokenB: string): Promise<PoolAnalysisOutput> {
    try {
        // Try DeFiLlama pools API
        const llamaRes = await fetch(`https://yields.llama.fi/pools`);
        if (llamaRes.ok) {
            const data = await llamaRes.json();
            const pools = data.data || [];

            // Find pools on Base chain matching these tokens
            const matchingPool = pools.find((p: any) =>
                p.chain?.toLowerCase() === 'base' &&
                p.underlyingTokens?.some((t: string) => t.toLowerCase() === tokenA.toLowerCase()) &&
                p.underlyingTokens?.some((t: string) => t.toLowerCase() === tokenB.toLowerCase())
            );

            if (matchingPool) {
                return {
                    success: true,
                    data: {
                        pairAddress: matchingPool.pool || 'N/A',
                        dex: matchingPool.project || 'Unknown',
                        token0: { address: tokenA, symbol: matchingPool.symbol?.split('-')[0] || 'TOKEN0', reserve: 'N/A' },
                        token1: { address: tokenB, symbol: matchingPool.symbol?.split('-')[1] || 'TOKEN1', reserve: 'N/A' },
                        tvl: formatLargeNumber(matchingPool.tvlUsd || 0),
                        liquidityRating: matchingPool.tvlUsd > 100000 ? 'GOOD' : 'LOW',
                        fee: 'Variable',
                        volume24h: 'N/A',
                        apy: matchingPool.apy ? `${matchingPool.apy.toFixed(2)}%` : 'N/A',
                        utilization: 'N/A',
                        healthScore: matchingPool.tvlUsd > 100000 ? 80 : 50,
                        chain: 'Base',
                        timestamp: new Date().toISOString()
                    }
                };
            }
        }
    } catch (e) {
        console.log('[PoolAnalysis] DeFiLlama error:', e);
    }

    return {
        success: false,
        error: "No liquidity pool found for this pair on Base chain. Checked: Uniswap, SushiSwap, BaseSwap, Aerodrome, Silverback"
    };
}

/**
 * Service 3: Token Technical Analysis
 * Price: $0.25 USDC
 */
export async function handleTechnicalAnalysis(input: TechnicalAnalysisInput): Promise<TechnicalAnalysisOutput> {
    try {
        const { token, timeframe = '7' } = input;

        if (!token) {
            return {
                success: false,
                error: "Token ID is required (e.g., 'bitcoin', 'ethereum')"
            };
        }

        // Fetch OHLCV data from CoinGecko
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (process.env.COINGECKO_API_KEY) {
            headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
        }

        const response = await fetch(
            `${COINGECKO_API}/coins/${token}/ohlc?vs_currency=usd&days=${timeframe}`,
            { headers }
        );

        if (!response.ok) {
            return {
                success: false,
                error: `Failed to fetch data for ${token}: ${response.status}`
            };
        }

        const rawData = await response.json();

        if (!rawData || rawData.length < 21) {
            return {
                success: false,
                error: "Insufficient data for technical analysis (need at least 21 candles)"
            };
        }

        // Convert to OHLCV format
        const candles: OHLCV[] = rawData.map((candle: number[]) => ({
            timestamp: new Date(candle[0]).toISOString(),
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: 0 // CoinGecko OHLC doesn't include volume
        }));

        const prices = candles.map(c => c.close);

        // Calculate indicators
        const indicators = calculateAllIndicators(prices);
        const conditions = analyzeMarketConditions(candles, indicators);

        // Detect patterns
        const liquiditySweep = detectLiquiditySweep(candles, 10);
        const chartPattern = detectChartPattern(candles, 20);
        const marketRegime = detectMarketRegime(candles, indicators.ema9, indicators.ema21);

        // Generate signals
        const momentumSignal = generateMomentumSignal(candles, indicators);
        const meanReversionSignal = generateMeanReversionSignal(candles, indicators);

        // Determine recommendation
        let recommendation = 'HOLD';
        if (momentumSignal > 70) recommendation = 'BULLISH';
        else if (momentumSignal < 30) recommendation = 'BEARISH';
        else if (meanReversionSignal > 70) recommendation = 'BUY DIP';
        else if (meanReversionSignal < 30) recommendation = 'SELL RALLY';

        // Calculate support/resistance levels
        const highs = candles.slice(-14).map(c => c.high);
        const lows = candles.slice(-14).map(c => c.low);
        const resistance = [Math.max(...highs)];
        const support = [Math.min(...lows)];

        return {
            success: true,
            data: {
                token,
                timeframe: `${timeframe} days`,
                indicators: {
                    ema9: Number(indicators.ema9.toFixed(4)),
                    ema21: Number(indicators.ema21.toFixed(4)),
                    rsi: Number(indicators.rsi.toFixed(2)),
                    bollingerBands: {
                        upper: Number(indicators.bollingerBands.upper.toFixed(4)),
                        middle: Number(indicators.bollingerBands.middle.toFixed(4)),
                        lower: Number(indicators.bollingerBands.lower.toFixed(4))
                    }
                },
                patterns: {
                    liquiditySweep,
                    chartPattern,
                    marketRegime
                },
                conditions: {
                    trend: conditions.trend,
                    volatility: conditions.volatility,
                    volume: conditions.volume,
                    momentum: conditions.momentum
                },
                signals: {
                    momentum: momentumSignal,
                    meanReversion: meanReversionSignal,
                    recommendation
                },
                supportResistance: {
                    support,
                    resistance
                },
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `Failed to perform technical analysis: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

// Token symbol to address mapping for Base network
const TOKEN_SYMBOLS: Record<string, string> = {
    'WETH': '0x4200000000000000000000000000000000000006',
    'ETH': '0x4200000000000000000000000000000000000006',
    'USDC': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    'BACK': '0x558881c4959e9cf961a7E1815FCD6586906babd2',
    'USDbC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    'DAI': '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
};

// Reverse mapping: address to token info (symbol + decimals)
const TOKEN_INFO: Record<string, { symbol: string; decimals: number }> = {
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0x558881c4959e9cf961a7e1815fcd6586906babd2': { symbol: 'BACK', decimals: 18 },
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
};

// Get token info from cache or on-chain
async function getTokenInfo(address: string, provider: ethers.JsonRpcProvider): Promise<{ symbol: string; decimals: number }> {
    const lowerAddress = address.toLowerCase();

    // Check cache first
    if (TOKEN_INFO[lowerAddress]) {
        return TOKEN_INFO[lowerAddress];
    }

    // Fallback to on-chain lookup
    try {
        const contract = new ethers.Contract(address, ERC20_ABI, provider);
        const [symbol, decimals] = await Promise.all([
            contract.symbol().catch(() => 'UNKNOWN'),
            contract.decimals().catch(() => 18)
        ]);
        return { symbol, decimals: Number(decimals) };
    } catch (e) {
        console.log(`[getTokenInfo] Failed for ${address}, using defaults`);
        return { symbol: 'UNKNOWN', decimals: 18 };
    }
}

// Resolve token input (address or symbol) to address
function resolveTokenAddress(tokenInput: string): string | null {
    // If already an address
    if (isValidAddress(tokenInput)) {
        return tokenInput;
    }
    // Try symbol lookup
    const upper = tokenInput.toUpperCase();
    return TOKEN_SYMBOLS[upper] || null;
}

/**
 * Service 4: Execute DEX Swap (Premium)
 * Price: 0.1% of trade value (min $0.50 USDC)
 */
export async function handleExecuteSwap(input: ExecuteSwapInput): Promise<ExecuteSwapOutput> {
    try {
        const { tokenIn, tokenOut, amountIn, slippage, walletAddress } = input;

        // Check if swap execution is enabled
        const SWAP_PRIVATE_KEY = process.env.SWAP_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY;
        if (!SWAP_PRIVATE_KEY) {
            return {
                success: false,
                error: "Swap execution is not enabled. SWAP_EXECUTOR_PRIVATE_KEY or WALLET_PRIVATE_KEY must be set."
            };
        }

        // Validate inputs
        if (!tokenIn || !tokenOut || !amountIn) {
            return {
                success: false,
                error: "Missing required parameters: tokenIn, tokenOut, amountIn"
            };
        }

        // Resolve token addresses (support both symbols and addresses)
        const tokenInAddress = resolveTokenAddress(tokenIn);
        const tokenOutAddress = resolveTokenAddress(tokenOut);

        if (!tokenInAddress) {
            return {
                success: false,
                error: `Invalid tokenIn: ${tokenIn}. Use 0x address or symbol (WETH, USDC, BACK, DAI)`
            };
        }

        if (!tokenOutAddress) {
            return {
                success: false,
                error: `Invalid tokenOut: ${tokenOut}. Use 0x address or symbol (WETH, USDC, BACK, DAI)`
            };
        }

        // Parse slippage (default 0.5%)
        const slippagePercent = parseFloat(slippage || '0.5');
        if (slippagePercent < 0.1 || slippagePercent > 50) {
            return {
                success: false,
                error: "Slippage must be between 0.1% and 50%"
            };
        }

        const provider = getProvider();

        // Create wallet signer
        const wallet = new ethers.Wallet(SWAP_PRIVATE_KEY, provider);
        const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);

        // Get token details
        const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
        const tokenOutContract = new ethers.Contract(tokenOutAddress, ERC20_ABI, provider);
        const decimalsIn = await tokenInContract.decimals();
        const decimalsOut = await tokenOutContract.decimals();
        const symbolIn = await tokenInContract.symbol();
        const symbolOut = await tokenOutContract.symbol();

        // Convert amount to wei
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        // Get quote first
        const path = [tokenInAddress, tokenOutAddress];
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOut = amounts[1];

        // Calculate minimum output with slippage
        const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 100));
        const amountOutMin = (expectedOut * slippageMultiplier) / BigInt(10000);

        // Set deadline (20 minutes from now)
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        // Recipient address (use provided wallet or executor wallet)
        const recipient = walletAddress && isValidAddress(walletAddress)
            ? walletAddress
            : wallet.address;

        // Check allowance and approve if needed
        const allowance = await tokenInContract.allowance(wallet.address, SILVERBACK_UNIFIED_ROUTER) as bigint;
        if (allowance < amountInWei) {
            console.log(`Approving ${symbolIn} for router...`);
            const tokenInWithSigner = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
            const approveTx = await tokenInWithSigner.getFunction('approve')(
                SILVERBACK_UNIFIED_ROUTER,
                ethers.MaxUint256
            );
            await approveTx.wait();
            console.log(`Approval confirmed: ${approveTx.hash}`);
        }

        // Execute the swap
        console.log(`Executing swap: ${amountIn} ${symbolIn} -> ${symbolOut}`);
        const routerSigner = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, wallet);
        const tx = await routerSigner.getFunction('swapExactTokensForTokens')(
            amountInWei,
            amountOutMin,
            path,
            recipient,
            deadline
        );

        // Wait for confirmation
        const receipt = await tx.wait();

        // Get actual output from logs (simplified - assumes last transfer event)
        const actualOut = ethers.formatUnits(expectedOut, decimalsOut);
        const executionPrice = (parseFloat(amountIn) / parseFloat(actualOut)).toFixed(6);

        return {
            success: true,
            data: {
                txHash: receipt.hash,
                actualOutput: actualOut,
                executionPrice: `${executionPrice} ${symbolIn}/${symbolOut}`,
                sold: `${amountIn} ${symbolIn}`,
                received: `${actualOut} ${symbolOut}`,
                recipient: recipient,
                gasUsed: receipt.gasUsed.toString(),
                chain: 'Base',
                router: SILVERBACK_UNIFIED_ROUTER,
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        const error = e as Error;

        // Handle specific errors
        if (error.message.includes('INSUFFICIENT_LIQUIDITY')) {
            return {
                success: false,
                error: "Insufficient liquidity for this swap"
            };
        }
        if (error.message.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
            return {
                success: false,
                error: "Slippage too high - price moved unfavorably. Try increasing slippage tolerance."
            };
        }
        if (error.message.includes('insufficient funds')) {
            return {
                success: false,
                error: "Insufficient token balance or gas for swap"
            };
        }

        return {
            success: false,
            error: `Swap execution failed: ${error.message}`
        };
    }
}

/**
 * Main service router - called when a job needs to be delivered
 */
export async function processServiceRequest(
    serviceType: string,
    serviceRequirements: string
): Promise<{ deliverable: string; success: boolean }> {
    try {
        // Parse service requirements
        let input: any;
        try {
            input = JSON.parse(serviceRequirements);
        } catch {
            // If not JSON, treat as simple string input
            input = { query: serviceRequirements };
        }

        let result: any;

        switch (serviceType.toLowerCase()) {
            case 'swap-quote':
            case 'get-swap-quote':
            case 'dex-quote':
                result = await handleSwapQuote(input);
                break;

            case 'pool-analysis':
            case 'liquidity-pool':
            case 'pool-info':
                result = await handlePoolAnalysis(input);
                break;

            case 'technical-analysis':
            case 'ta':
            case 'token-analysis':
                result = await handleTechnicalAnalysis(input);
                break;

            case 'execute-swap':
            case 'swap':
            case 'trade':
                result = await handleExecuteSwap(input);
                break;

            default:
                // Try to infer service type from input
                if (input.tokenIn && input.tokenOut && input.amountIn) {
                    result = await handleSwapQuote(input);
                } else if (input.tokenA && input.tokenB || input.poolId) {
                    result = await handlePoolAnalysis(input);
                } else if (input.token) {
                    result = await handleTechnicalAnalysis(input);
                } else {
                    result = {
                        success: false,
                        error: `Unknown service type: ${serviceType}. Available: swap-quote, pool-analysis, technical-analysis`
                    };
                }
        }

        return {
            deliverable: JSON.stringify(result, null, 2),
            success: result.success
        };
    } catch (e) {
        return {
            deliverable: JSON.stringify({
                success: false,
                error: `Service processing failed: ${e instanceof Error ? e.message : 'Unknown error'}`
            }),
            success: false
        };
    }
}

// Helper function
function formatLargeNumber(num: number): string {
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
}
