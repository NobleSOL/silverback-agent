/**
 * Silverback DEX Intelligence SDK
 *
 * A TypeScript/JavaScript SDK for interacting with the Silverback DEX API
 * using x402 micropayments on Base chain.
 *
 * @example
 * ```typescript
 * import { SilverbackClient } from '@silverback/defi-client';
 *
 * const client = new SilverbackClient({
 *   privateKey: process.env.PRIVATE_KEY
 * });
 *
 * const quote = await client.getSwapQuote({
 *   tokenIn: '0x4200000000000000000000000000000000000006',
 *   tokenOut: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
 *   amountIn: '1.0'
 * });
 * ```
 */

// Types
export interface SilverbackConfig {
    /** Base URL for the API (default: https://x402.silverbackdefi.app) */
    baseUrl?: string;
    /** Private key for signing x402 payments (hex string with or without 0x prefix) */
    privateKey?: string;
    /** Network: 'base' for mainnet, 'base-sepolia' for testnet */
    network?: 'base' | 'base-sepolia';
}

export interface SwapQuoteRequest {
    /** Input token address */
    tokenIn: string;
    /** Output token address */
    tokenOut: string;
    /** Amount to swap (human-readable) */
    amountIn: string;
}

export interface SwapQuoteResponse {
    success: boolean;
    amountOut?: string;
    priceImpact?: string;
    fee?: string;
    route?: string;
    error?: string;
}

export interface SwapRequest {
    /** Token to sell (address or symbol) */
    tokenIn: string;
    /** Token to buy (address or symbol) */
    tokenOut: string;
    /** Amount to swap */
    amountIn: string;
    /** Slippage tolerance percentage (default: 0.5) */
    slippage?: string;
    /** Recipient wallet address */
    walletAddress?: string;
}

export interface SwapResponse {
    success: boolean;
    txHash?: string;
    sold?: string;
    received?: string;
    error?: string;
}

export interface TechnicalAnalysisRequest {
    /** CoinGecko token ID */
    token: string;
    /** Timeframe in days (1, 7, 14, or 30) */
    timeframe?: string;
}

export interface TechnicalAnalysisResponse {
    success: boolean;
    rsi?: number;
    trend?: string;
    momentum?: string;
    recommendation?: 'BUY' | 'SELL' | 'HOLD';
    error?: string;
}

export interface BacktestRequest {
    /** CoinGecko token ID */
    token: string;
    /** Strategy type */
    strategy: 'momentum' | 'mean_reversion';
    /** Period in days */
    period?: string;
    /** Signal threshold (0-100) */
    signalThreshold?: number;
}

export interface BacktestResponse {
    success: boolean;
    data?: {
        token: string;
        strategy: string;
        stats: any;
        trades: any[];
    };
    error?: string;
}

export interface PoolAnalysisRequest {
    /** First token address */
    tokenA?: string;
    /** Second token address */
    tokenB?: string;
    /** Pool ID (alternative to tokenA/tokenB) */
    poolId?: string;
}

export interface PoolAnalysisResponse {
    success: boolean;
    tvl?: string;
    liquidityRating?: string;
    healthScore?: number;
    error?: string;
}

export interface YieldRequest {
    /** Token symbol or address */
    token: string;
    /** Risk tolerance level */
    riskTolerance?: 'low' | 'medium' | 'high';
}

export interface YieldResponse {
    success: boolean;
    totalOpportunities?: number;
    bestApr?: string;
    opportunities?: any[];
    error?: string;
}

export interface LPAnalysisRequest {
    /** Token pair (e.g., "USDC/WETH") */
    tokenPair?: string;
    /** First token symbol */
    tokenA?: string;
    /** Second token symbol */
    tokenB?: string;
}

export interface LPAnalysisResponse {
    success: boolean;
    positions?: any[];
    summary?: {
        totalValue?: string;
        weightedApr?: string;
    };
    error?: string;
}

export interface TopPoolsRequest {
    /** Number of pools to return (1-20) */
    limit?: number;
    /** Minimum TVL in USD */
    minTvl?: number;
}

export interface TopPoolsResponse {
    success: boolean;
    topPools?: Array<{
        name: string;
        apr: string;
        tvl: string;
    }>;
    error?: string;
}

export interface TopProtocolsRequest {
    /** Number of protocols to return (1-50) */
    limit?: number;
    /** Chain filter */
    chain?: 'base' | 'ethereum' | 'arbitrum' | 'all';
    /** Category filter */
    category?: 'dex' | 'lending' | 'bridge' | 'staking' | 'derivatives';
}

export interface TopProtocolsResponse {
    success: boolean;
    topProtocols?: Array<{
        name: string;
        tvl: string;
        category: string;
    }>;
    error?: string;
}

export interface TopCoinsRequest {
    /** Number of coins to return (1-50) */
    limit?: number;
    /** Chain filter */
    chain?: 'base' | 'ethereum' | 'all';
}

export interface TopCoinsResponse {
    success: boolean;
    topCoins?: Array<{
        rank: number;
        name: string;
        symbol: string;
        price: string;
        marketCap: string;
    }>;
    error?: string;
}

export interface TokenPriceResponse {
    success: boolean;
    data?: {
        token: string;
        price: {
            usd: number;
            eth: number;
            btc: number;
        };
        change24h: string;
        volume24h: string;
        marketCap: string;
    };
    error?: string;
}

export interface DexMetricsResponse {
    success: boolean;
    data?: {
        network: string;
        chainId: number;
        aggregator: string;
        protocol: string;
        router: string;
        routing: any;
        capabilities: string[];
        supportedTokens: Record<string, string>;
        timestamp: string;
    };
    error?: string;
}

export interface PricingInfo {
    service: string;
    description: string;
    documentation: string;
    payment: {
        network: string;
        token: string;
        protocol: string;
        wallet: string;
    };
    endpoints: Array<{
        method: string;
        path: string;
        price: string;
        description: string;
        parameters?: Record<string, string>;
    }>;
    freeEndpoints: Array<{
        method: string;
        path: string;
        description: string;
    }>;
}

// Common token addresses on Base
export const BASE_TOKENS = {
    WETH: '0x4200000000000000000000000000000000000006',
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    BACK: '0x558881c4959e9cf961a7E1815FCD6586906babd2',
} as const;

/**
 * Silverback DEX Intelligence API Client
 *
 * Provides easy access to DeFi trading intelligence and DEX execution
 * with automatic x402 payment handling.
 */
export class SilverbackClient {
    private baseUrl: string;
    private privateKey?: string;
    private network: 'base' | 'base-sepolia';

    constructor(config: SilverbackConfig = {}) {
        this.baseUrl = config.baseUrl || 'https://x402.silverbackdefi.app';
        this.privateKey = config.privateKey;
        this.network = config.network || 'base';
    }

    /**
     * Make an API request with automatic x402 payment handling
     */
    private async request<T>(
        method: 'GET' | 'POST',
        path: string,
        body?: any,
        queryParams?: Record<string, any>
    ): Promise<T> {
        let url = `${this.baseUrl}${path}`;

        // Add query parameters for GET requests
        if (queryParams && Object.keys(queryParams).length > 0) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(queryParams)) {
                if (value !== undefined && value !== null) {
                    params.append(key, String(value));
                }
            }
            url += `?${params.toString()}`;
        }

        const options: RequestInit = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        };

        if (body && method === 'POST') {
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);

        // Handle x402 payment required
        if (response.status === 402) {
            if (!this.privateKey) {
                throw new Error(
                    'Payment required but no private key configured. ' +
                    'Initialize client with privateKey to enable automatic payments.'
                );
            }

            // For now, throw an error with payment details
            // In a full implementation, this would use the x402 library
            const paymentDetails = await response.json();
            throw new Error(
                `Payment required: ${JSON.stringify(paymentDetails)}. ` +
                'Automatic payment not yet implemented in this SDK version. ' +
                'See https://github.com/anthropics/x402 for x402 client implementation.'
            );
        }

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(error.error || `API request failed: ${response.status}`);
        }

        return response.json();
    }

    // === FREE ENDPOINTS ===

    /**
     * Get API pricing information
     */
    async getPricing(): Promise<PricingInfo> {
        return this.request('GET', '/api/v1/pricing');
    }

    /**
     * Get token price (FREE - no payment required)
     * @param token CoinGecko token ID (e.g., 'bitcoin', 'ethereum')
     */
    async getTokenPrice(token: string): Promise<TokenPriceResponse> {
        return this.request('GET', `/api/v1/price/${token}`);
    }

    /**
     * Health check
     */
    async healthCheck(): Promise<{ status: string; service: string; timestamp: string }> {
        return this.request('GET', '/health');
    }

    // === TRADING ENDPOINTS ===

    /**
     * Get swap quote ($0.02)
     */
    async getSwapQuote(params: SwapQuoteRequest): Promise<SwapQuoteResponse> {
        return this.request('POST', '/api/v1/swap-quote', params);
    }

    /**
     * Execute swap ($0.50)
     */
    async executeSwap(params: SwapRequest): Promise<SwapResponse> {
        return this.request('POST', '/api/v1/swap', params);
    }

    // === ANALYSIS ENDPOINTS ===

    /**
     * Get technical analysis ($0.25)
     */
    async getTechnicalAnalysis(params: TechnicalAnalysisRequest): Promise<TechnicalAnalysisResponse> {
        return this.request('POST', '/api/v1/technical-analysis', params);
    }

    /**
     * Run strategy backtest ($1.00)
     */
    async runBacktest(params: BacktestRequest): Promise<BacktestResponse> {
        return this.request('POST', '/api/v1/backtest', params);
    }

    // === DEFI ENDPOINTS ===

    /**
     * Get pool analysis ($0.10)
     */
    async getPoolAnalysis(params: PoolAnalysisRequest): Promise<PoolAnalysisResponse> {
        return this.request('POST', '/api/v1/pool-analysis', params);
    }

    /**
     * Get yield opportunities ($0.05)
     */
    async getYieldOpportunities(params: YieldRequest): Promise<YieldResponse> {
        return this.request('POST', '/api/v1/defi-yield', params);
    }

    /**
     * Get LP analysis ($0.05)
     */
    async getLPAnalysis(params: LPAnalysisRequest): Promise<LPAnalysisResponse> {
        return this.request('POST', '/api/v1/lp-analysis', params);
    }

    /**
     * Get top pools ($0.03)
     */
    async getTopPools(params: TopPoolsRequest = {}): Promise<TopPoolsResponse> {
        return this.request('GET', '/api/v1/top-pools', undefined, params);
    }

    // === MARKET DATA ENDPOINTS ===

    /**
     * Get DEX metrics ($0.05)
     */
    async getDexMetrics(): Promise<DexMetricsResponse> {
        return this.request('GET', '/api/v1/dex-metrics');
    }

    /**
     * Get top protocols ($0.03)
     */
    async getTopProtocols(params: TopProtocolsRequest = {}): Promise<TopProtocolsResponse> {
        return this.request('GET', '/api/v1/top-protocols', undefined, params);
    }

    /**
     * Get top coins ($0.03)
     */
    async getTopCoins(params: TopCoinsRequest = {}): Promise<TopCoinsResponse> {
        return this.request('GET', '/api/v1/top-coins', undefined, params);
    }
}

// Default export
export default SilverbackClient;
