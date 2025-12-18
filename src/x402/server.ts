/**
 * x402 Payment Server for Silverback DeFi Intelligence
 *
 * Exposes Silverback's services as paid HTTP endpoints using x402 protocol.
 * Anyone can pay USDC on Base and get DeFi data/execution.
 */

import express, { Request, Response, NextFunction } from 'express';
import { paymentMiddleware } from 'x402-express';

// Import existing ACP service handlers - already production-ready
import {
    handleSwapQuote,
    handlePoolAnalysis,
    handleTechnicalAnalysis,
    handleExecuteSwap,
    SwapQuoteInput,
    PoolAnalysisInput,
    TechnicalAnalysisInput,
    ExecuteSwapInput
} from '../acp/services';

// Import backtest functions
import { runBacktest, calculateBacktestStats } from '../market-data/backtest';
import { OHLCV } from '../market-data/types';

const app = express();
app.use(express.json());

// Get wallet address from environment
const X402_WALLET_ADDRESS = process.env.X402_WALLET_ADDRESS;
const X402_ENABLED = process.env.X402_ENABLED === 'true';

// CoinGecko API for price data
const COINGECKO_API = process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

/**
 * Check if x402 server is configured and enabled
 */
export function isX402Configured(): boolean {
    return X402_ENABLED && !!X402_WALLET_ADDRESS;
}

/**
 * Initialize x402 server with payment middleware
 */
function initializeServer() {
    if (!X402_WALLET_ADDRESS) {
        console.warn('⚠️  X402_WALLET_ADDRESS not set - x402 server disabled');
        return app;
    }

    // Configure payment routes
    // Routes without payment middleware are free
    app.use(
        paymentMiddleware(
            X402_WALLET_ADDRESS as `0x${string}`,
            {
                "POST /api/v1/swap-quote": {
                    price: "$0.02",
                    network: "base",
                    config: {
                        description: "Get optimal swap route with price impact analysis"
                    }
                },
                "POST /api/v1/pool-analysis": {
                    price: "$0.10",
                    network: "base",
                    config: {
                        description: "Comprehensive liquidity pool analysis with health scoring"
                    }
                },
                "POST /api/v1/technical-analysis": {
                    price: "$0.25",
                    network: "base",
                    config: {
                        description: "Full technical analysis with indicators, patterns, and signals"
                    }
                },
                "POST /api/v1/execute-swap": {
                    price: "$0.50",
                    network: "base",
                    config: {
                        description: "Execute swap on Silverback DEX"
                    }
                },
                "GET /api/v1/dex-metrics": {
                    price: "$0.05",
                    network: "base",
                    config: {
                        description: "Overall DEX statistics and metrics"
                    }
                },
                "GET /api/v1/price/:token": {
                    price: "$0.01",
                    network: "base",
                    config: {
                        description: "Token price feed from CoinGecko"
                    }
                },
                "POST /api/v1/backtest": {
                    price: "$1.00",
                    network: "base",
                    config: {
                        description: "Run strategy backtest on historical data"
                    }
                }
            }
        )
    );

    return app;
}

// Initialize the server
initializeServer();

// === FREE ENDPOINTS ===

/**
 * Health check endpoint
 */
app.get('/health', (_req: Request, res: Response) => {
    res.json({
        status: 'ok',
        service: 'silverback-x402',
        timestamp: new Date().toISOString(),
        walletConfigured: !!X402_WALLET_ADDRESS
    });
});

/**
 * Service pricing info - helps discovery
 */
app.get('/api/v1/pricing', (_req: Request, res: Response) => {
    res.json({
        service: 'Silverback DEX Intelligence',
        description: 'DeFi trading intelligence and DEX execution on Silverback DEX',
        documentation: 'https://silverbackdefi.app/api-docs',
        payment: {
            network: 'base',
            token: 'USDC',
            protocol: 'x402',
            wallet: X402_WALLET_ADDRESS || 'Not configured'
        },
        endpoints: [
            {
                method: 'POST',
                path: '/api/v1/swap-quote',
                price: '$0.02',
                description: 'Get optimal swap route with price impact',
                parameters: { tokenIn: '0x address', tokenOut: '0x address', amountIn: 'human-readable amount' }
            },
            {
                method: 'POST',
                path: '/api/v1/pool-analysis',
                price: '$0.10',
                description: 'Liquidity pool deep dive with health scoring',
                parameters: { tokenA: '0x address', tokenB: '0x address' }
            },
            {
                method: 'POST',
                path: '/api/v1/technical-analysis',
                price: '$0.25',
                description: 'Full TA with indicators, patterns, and signals',
                parameters: { token: 'CoinGecko ID (e.g., bitcoin)', timeframe: 'days (default: 7)' }
            },
            {
                method: 'POST',
                path: '/api/v1/execute-swap',
                price: '$0.50',
                description: 'Execute swap on Silverback DEX',
                parameters: { tokenIn: 'address/symbol', tokenOut: 'address/symbol', amountIn: 'amount', slippage: 'percent', walletAddress: 'recipient' }
            },
            {
                method: 'GET',
                path: '/api/v1/dex-metrics',
                price: '$0.05',
                description: 'Overall DEX statistics'
            },
            {
                method: 'GET',
                path: '/api/v1/price/:token',
                price: '$0.01',
                description: 'Token price feed',
                parameters: { token: 'CoinGecko ID in URL path' }
            },
            {
                method: 'POST',
                path: '/api/v1/backtest',
                price: '$1.00',
                description: 'Run strategy backtest on historical data',
                parameters: { strategy: 'momentum or mean_reversion', token: 'CoinGecko ID', period: 'days (default: 30)', signalThreshold: '0-100 (default: 70)' }
            }
        ],
        freeEndpoints: [
            { method: 'GET', path: '/health', description: 'Health check' },
            { method: 'GET', path: '/api/v1/pricing', description: 'This pricing info' }
        ]
    });
});

// === PAID ENDPOINTS ===

/**
 * Swap Quote - $0.02
 * Get optimal swap route with price impact analysis
 */
app.post('/api/v1/swap-quote', async (req: Request, res: Response) => {
    try {
        const input: SwapQuoteInput = req.body;

        if (!input.tokenIn || !input.tokenOut || !input.amountIn) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenIn, tokenOut, amountIn'
            });
            return;
        }

        const result = await handleSwapQuote(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Pool Analysis - $0.10
 * Comprehensive liquidity pool analysis
 */
app.post('/api/v1/pool-analysis', async (req: Request, res: Response) => {
    try {
        const input: PoolAnalysisInput = req.body;

        if (!input.tokenA || !input.tokenB) {
            if (!input.poolId && !input.tokenPair) {
                res.status(400).json({
                    success: false,
                    error: 'Missing required fields: tokenA and tokenB (or poolId)'
                });
                return;
            }
        }

        const result = await handlePoolAnalysis(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Technical Analysis - $0.25
 * Full TA with indicators, patterns, and signals
 */
app.post('/api/v1/technical-analysis', async (req: Request, res: Response) => {
    try {
        const input: TechnicalAnalysisInput = req.body;

        if (!input.token) {
            res.status(400).json({
                success: false,
                error: 'Missing required field: token (CoinGecko ID)'
            });
            return;
        }

        const result = await handleTechnicalAnalysis(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Execute Swap - $0.50
 * Execute actual swap on Silverback DEX
 */
app.post('/api/v1/execute-swap', async (req: Request, res: Response) => {
    try {
        const input: ExecuteSwapInput = req.body;

        if (!input.tokenIn || !input.tokenOut || !input.amountIn) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenIn, tokenOut, amountIn'
            });
            return;
        }

        // Default slippage if not provided
        if (!input.slippage) {
            input.slippage = '0.5';
        }

        const result = await handleExecuteSwap(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * DEX Metrics - $0.05
 * Overall DEX statistics
 */
app.get('/api/v1/dex-metrics', async (_req: Request, res: Response) => {
    try {
        // Fetch from Keeta DEX API
        const DEX_API_URL = process.env.DEX_API_URL || 'https://dexkeeta.onrender.com/api';
        const response = await fetch(`${DEX_API_URL}/anchor/pools`);

        if (!response.ok) {
            res.status(502).json({
                success: false,
                error: 'Failed to fetch DEX metrics'
            });
            return;
        }

        const pools = await response.json();
        const activePools = pools.filter((p: any) => p.status === 'active' || !p.status);

        // Calculate aggregate metrics
        let totalLiquidity = 0;
        let totalVolume24h = 0;

        for (const pool of pools) {
            const reserveA = parseFloat(pool.reserve_a) || 0;
            const reserveB = parseFloat(pool.reserve_b) || 0;
            totalLiquidity += reserveA + reserveB;
            totalVolume24h += parseFloat(pool.volume_24h) || 0;
        }

        res.json({
            success: true,
            data: {
                totalPools: pools.length,
                activePools: activePools.length,
                totalLiquidity: formatLargeNumber(totalLiquidity),
                volume24h: formatLargeNumber(totalVolume24h),
                protocol: 'Silverback DEX',
                networks: ['Base', 'Keeta'],
                router: '0x565cBf0F3eAdD873212Db91896e9a548f6D64894',
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Token Price - $0.01
 * Real-time token price from CoinGecko
 */
app.get('/api/v1/price/:token', async (req: Request, res: Response) => {
    try {
        const { token } = req.params;

        if (!token) {
            res.status(400).json({
                success: false,
                error: 'Token ID required in URL path'
            });
            return;
        }

        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (process.env.COINGECKO_API_KEY) {
            headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
        }

        const response = await fetch(
            `${COINGECKO_API}/simple/price?ids=${token}&vs_currencies=usd,eth,btc&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
            { headers }
        );

        if (!response.ok) {
            res.status(404).json({
                success: false,
                error: `Token not found: ${token}`
            });
            return;
        }

        const data = await response.json();
        const tokenData = data[token];

        if (!tokenData) {
            res.status(404).json({
                success: false,
                error: `No data for token: ${token}`
            });
            return;
        }

        res.json({
            success: true,
            data: {
                token,
                price: {
                    usd: tokenData.usd,
                    eth: tokenData.eth,
                    btc: tokenData.btc
                },
                change24h: tokenData.usd_24h_change?.toFixed(2) + '%',
                volume24h: formatLargeNumber(tokenData.usd_24h_vol),
                marketCap: formatLargeNumber(tokenData.usd_market_cap),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Backtest - $1.00
 * Run strategy backtest on historical data
 */
app.post('/api/v1/backtest', async (req: Request, res: Response) => {
    try {
        const { strategy, token, period = '30', signalThreshold = 70 } = req.body;

        if (!strategy || !token) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: strategy (momentum/mean_reversion), token (CoinGecko ID)'
            });
            return;
        }

        if (!['momentum', 'mean_reversion'].includes(strategy)) {
            res.status(400).json({
                success: false,
                error: 'Invalid strategy. Must be "momentum" or "mean_reversion"'
            });
            return;
        }

        // Fetch OHLCV data
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (process.env.COINGECKO_API_KEY) {
            headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
        }

        const response = await fetch(
            `${COINGECKO_API}/coins/${token}/ohlc?vs_currency=usd&days=${period}`,
            { headers }
        );

        if (!response.ok) {
            res.status(404).json({
                success: false,
                error: `Failed to fetch data for ${token}`
            });
            return;
        }

        const rawData = await response.json();

        if (!rawData || rawData.length < 50) {
            res.status(400).json({
                success: false,
                error: 'Insufficient historical data for backtest (need at least 50 candles)'
            });
            return;
        }

        // Convert to OHLCV format
        const candles: OHLCV[] = rawData.map((candle: number[]) => ({
            timestamp: new Date(candle[0]).toISOString(),
            open: candle[1],
            high: candle[2],
            low: candle[3],
            close: candle[4],
            volume: 0
        }));

        // Run backtest
        const results = runBacktest(candles, strategy, signalThreshold);
        const stats = calculateBacktestStats(results);

        res.json({
            success: true,
            data: {
                token,
                strategy,
                period: `${period} days`,
                signalThreshold,
                candlesAnalyzed: candles.length,
                stats,
                trades: results.slice(0, 10).map(r => ({
                    timestamp: r.setup.timestamp,
                    entry: r.setup.entry.toFixed(4),
                    exit: r.exitPrice.toFixed(4),
                    outcome: r.outcome,
                    exitReason: r.exitReason,
                    pnlPercent: r.pnlPercent.toFixed(2) + '%',
                    duration: r.duration + ' candles'
                })),
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

// Error handling middleware
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('x402 server error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Helper function
function formatLargeNumber(num: number): string {
    if (!num || isNaN(num)) return '$0';
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
}

/**
 * Start x402 server
 */
export function startX402Server(): void {
    if (!isX402Configured()) {
        console.log('ℹ️  x402 server disabled (set X402_ENABLED=true and X402_WALLET_ADDRESS to enable)');
        return;
    }

    const PORT = parseInt(process.env.X402_PORT || '3402', 10);

    app.listen(PORT, () => {
        console.log(`\n🦍 Silverback x402 server running on port ${PORT}`);
        console.log(`   Wallet: ${X402_WALLET_ADDRESS}`);
        console.log(`   Network: Base (USDC payments)`);
        console.log(`   Pricing: GET /api/v1/pricing`);
        console.log(`   Health: GET /health\n`);
    });
}

export default app;
