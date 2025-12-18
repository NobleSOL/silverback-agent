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
 * Overall DEX statistics from Base chain via OpenOcean and CoinGecko
 */
app.get('/api/v1/dex-metrics', async (_req: Request, res: Response) => {
    try {
        const weth = '0x4200000000000000000000000000000000000006';
        const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
        const amountIn = '1000000000000000000'; // 1 WETH in wei

        // Try CoinGecko first for price data
        let routingInfo = null;
        const headers: Record<string, string> = { 'Accept': 'application/json' };
        if (process.env.COINGECKO_API_KEY) {
            headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
        }

        try {
            const cgResponse = await fetch(
                `${COINGECKO_API}/simple/token_price/base?` +
                `contract_addresses=${weth},${usdc}&vs_currencies=usd`,
                { headers }
            );

            if (cgResponse.ok) {
                const prices = await cgResponse.json();
                const wethPrice = prices[weth.toLowerCase()]?.usd;
                const usdcPrice = prices[usdc.toLowerCase()]?.usd;

                if (wethPrice && usdcPrice) {
                    const estimatedOut = (wethPrice / usdcPrice).toFixed(2);
                    routingInfo = {
                        samplePair: 'WETH/USDC',
                        estimatedOut: `${estimatedOut} USDC per WETH`,
                        wethPriceUSD: `$${wethPrice.toFixed(2)}`,
                        source: 'CoinGecko',
                        priceImpact: '< 0.1% (estimate)'
                    };
                }
            }
        } catch (cgError) {
            console.log('[DEX Metrics] CoinGecko error:', cgError);
        }

        // Fallback to OpenOcean if CoinGecko fails
        if (!routingInfo) {
            try {
                // Use correct OpenOcean V4 API parameters
                const quoteResponse = await fetch(
                    `https://open-api.openocean.finance/v4/base/quote?` +
                    `inTokenAddress=${weth}&outTokenAddress=${usdc}&` +
                    `amountDecimals=${amountIn}&gasPriceDecimals=1000000000&slippage=1`
                );

                if (quoteResponse.ok) {
                    const quoteData = await quoteResponse.json();
                    if (quoteData.data && quoteData.data.outAmount) {
                        routingInfo = {
                            samplePair: 'WETH/USDC',
                            estimatedOut: (parseFloat(quoteData.data.outAmount) / 1e6).toFixed(2) + ' USDC',
                            priceImpact: quoteData.data.estimatedPriceImpact || 'N/A',
                            dexesUsed: quoteData.data.dexes?.length || 0,
                            routesSplit: quoteData.data.path?.routes?.length || 1,
                            source: 'OpenOcean'
                        };
                    }
                }
            } catch (ooError) {
                console.log('[DEX Metrics] OpenOcean error:', ooError);
            }
        }

        res.json({
            success: true,
            data: {
                network: 'Base',
                chainId: 8453,
                aggregators: ['CoinGecko', 'OpenOcean'],
                protocol: 'Silverback DEX',
                router: '0x565cBf0F3eAdD873212Db91896e9a548f6D64894',
                routing: routingInfo || { status: 'Unable to fetch quote data' },
                capabilities: [
                    'Price data via CoinGecko',
                    'Multi-DEX aggregation via OpenOcean',
                    'Best price routing across Uniswap, Sushiswap, Curve, etc.',
                    'Swap execution on Base chain',
                    'Technical analysis & backtesting'
                ],
                supportedTokens: {
                    WETH: weth,
                    USDC: usdc,
                    BACK: '0x558881c4959e9cf961a7E1815FCD6586906babd2',
                    USDbC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
                    DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'
                },
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
