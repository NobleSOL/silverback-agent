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
];

const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function balanceOf(address) view returns (uint256)',
];

// Keeta DEX API
const DEX_API_URL = process.env.DEX_API_URL || 'https://dexkeeta.onrender.com/api';

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
    };
    error?: string;
}

/**
 * Service 1: Get Optimal Swap Route
 * Price: $0.02 USDC
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

        if (!isValidAddress(tokenIn) || !isValidAddress(tokenOut)) {
            return {
                success: false,
                error: "Invalid token addresses. Must be 0x format."
            };
        }

        const provider = getProvider();
        const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);

        // Get token decimals
        const tokenInContract = new ethers.Contract(tokenIn, ERC20_ABI, provider);
        const decimalsIn = await tokenInContract.decimals();

        const tokenOutContract = new ethers.Contract(tokenOut, ERC20_ABI, provider);
        const decimalsOut = await tokenOutContract.decimals();

        // Convert human amount to wei
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        // Get quote from router
        const path = [tokenIn, tokenOut];
        const amounts = await router.getAmountsOut(amountInWei, path);

        const amountOutWei = amounts[1];
        const amountOutHuman = ethers.formatUnits(amountOutWei, decimalsOut);

        // Calculate price impact
        const amountInNum = parseFloat(amountIn);
        const amountOutNum = parseFloat(amountOutHuman);
        const expectedOut = amountInNum * 0.997; // 0.3% fee
        const priceImpact = ((expectedOut - amountOutNum) / expectedOut) * 100;

        return {
            success: true,
            data: {
                tokenIn,
                tokenOut,
                amountIn,
                amountOut: amountOutHuman,
                priceImpact: Math.abs(priceImpact).toFixed(2) + '%',
                fee: '0.3%',
                route: path,
                router: SILVERBACK_UNIFIED_ROUTER,
                chain: 'Base',
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        const error = e as Error;
        if (error.message.includes('INSUFFICIENT_LIQUIDITY')) {
            return {
                success: false,
                error: "No liquidity pool exists for this pair on Silverback DEX"
            };
        }
        return {
            success: false,
            error: `Failed to get swap quote: ${error.message}`
        };
    }
}

/**
 * Service 2: Liquidity Pool Deep Dive
 * Price: $0.10 USDC
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
            // Handle "TOKEN_A/TOKEN_B" format
            const parts = input.tokenPair.split('/');
            if (parts.length === 2) {
                // This would need token address lookup - simplified for now
                return {
                    success: false,
                    error: "Please provide token addresses (tokenA and tokenB) instead of symbols"
                };
            }
        } else if (input.poolId) {
            // Try to fetch from Keeta API
            try {
                const response = await fetch(`${DEX_API_URL}/anchor/pools/${input.poolId}`);
                if (response.ok) {
                    const pool = await response.json();
                    return {
                        success: true,
                        data: {
                            pairAddress: pool.pool_address,
                            token0: {
                                address: pool.token_a,
                                symbol: pool.token_a_symbol || 'Unknown',
                                reserve: pool.reserve_a
                            },
                            token1: {
                                address: pool.token_b,
                                symbol: pool.token_b_symbol || 'Unknown',
                                reserve: pool.reserve_b
                            },
                            tvl: formatLargeNumber(Number(pool.reserve_a || 0) + Number(pool.reserve_b || 0)),
                            liquidityRating: 'GOOD',
                            fee: `${(pool.fee_bps || 30) / 100}%`,
                            volume24h: pool.volume_24h || 'N/A',
                            apy: pool.apy || 'N/A',
                            utilization: 'N/A',
                            healthScore: 85,
                            chain: 'Keeta',
                            timestamp: new Date().toISOString()
                        }
                    };
                }
            } catch {
                // Fall through to Base chain lookup
            }
        }

        if (!tokenA || !tokenB) {
            return {
                success: false,
                error: "Please provide tokenA and tokenB addresses"
            };
        }

        if (!isValidAddress(tokenA) || !isValidAddress(tokenB)) {
            return {
                success: false,
                error: "Invalid token addresses"
            };
        }

        const provider = getProvider();
        const factory = new ethers.Contract(SILVERBACK_V2_FACTORY, FACTORY_ABI, provider);

        // Check if pair exists
        const pairAddress = await factory.getPair(tokenA, tokenB);

        if (pairAddress === ethers.ZeroAddress) {
            return {
                success: false,
                error: "No liquidity pool exists for this pair on Silverback DEX"
            };
        }

        // Get pair reserves
        const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
        const [reserve0, reserve1] = await pair.getReserves();
        const token0 = await pair.token0();
        const token1 = await pair.token1();

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

        return {
            success: true,
            data: {
                pairAddress,
                token0: { address: token0, symbol: symbol0, reserve: reserve0Formatted },
                token1: { address: token1, symbol: symbol1, reserve: reserve1Formatted },
                tvl: formatLargeNumber(totalLiquidity),
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

/**
 * Service 4: Execute DEX Swap (Premium)
 * Price: 0.1% of trade value (min $0.50 USDC)
 * Status: PHASE 2 - NOT YET ENABLED
 */
export async function handleExecuteSwap(input: ExecuteSwapInput): Promise<ExecuteSwapOutput> {
    // Phase 2 - Not yet enabled
    return {
        success: false,
        error: "Swap execution is not yet enabled. Currently in Phase 1 (read-only mode). Use swap-quote service to get quotes without executing."
    };
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
