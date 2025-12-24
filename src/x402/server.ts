/**
 * x402 Payment Server for Silverback DeFi Intelligence
 *
 * Exposes Silverback's services as paid HTTP endpoints using x402 protocol.
 * Anyone can pay USDC on Base and get DeFi data/execution.
 *
 * IMPORTANT: For mainnet (Base), you need CDP API credentials:
 * - CDP_API_KEY_ID: Your CDP API key ID
 * - CDP_API_KEY_SECRET: Your CDP API key secret
 *
 * For testnet (Base Sepolia), no credentials are needed.
 */

import express, { Request, Response, NextFunction } from 'express';
import { paymentMiddleware } from 'x402-express';
import { SignJWT, importPKCS8 } from 'jose';

// Import existing ACP service handlers - already production-ready
import {
    handleSwapQuote,
    handlePoolAnalysis,
    handleTechnicalAnalysis,
    handleExecuteSwap,
    handleYieldAnalysis,
    handleLPAnalysis,
    handleTopPools,
    handleTopProtocols,
    handleTopCoins,
    SwapQuoteInput,
    PoolAnalysisInput,
    TechnicalAnalysisInput,
    ExecuteSwapInput,
    YieldAnalysisInput,
    LPAnalysisInput
} from '../acp/services';

// Import backtest functions
import { runBacktest, calculateBacktestStats } from '../market-data/backtest';
import { OHLCV } from '../market-data/types';

const app = express();
app.use(express.json());

// Get configuration from environment
const X402_WALLET_ADDRESS = process.env.X402_WALLET_ADDRESS;
const X402_ENABLED = process.env.X402_ENABLED === 'true';
const X402_NETWORK = process.env.X402_NETWORK || 'base'; // 'base' for mainnet, 'base-sepolia' for testnet

// CDP API credentials for mainnet
const CDP_API_KEY_ID = process.env.CDP_API_KEY_ID;
const CDP_API_KEY_SECRET = process.env.CDP_API_KEY_SECRET;

// Facilitator URLs
const TESTNET_FACILITATOR_URL = 'https://x402.org/facilitator';
const MAINNET_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

// CoinGecko API for price data
const COINGECKO_API = process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

/**
 * Generate a JWT token for CDP API authentication
 * Based on CDP SDK implementation
 */
async function generateCdpJwt(method: string, host: string, path: string): Promise<string> {
    if (!CDP_API_KEY_ID || !CDP_API_KEY_SECRET) {
        throw new Error('CDP_API_KEY_ID and CDP_API_KEY_SECRET are required for mainnet');
    }

    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();

    // Parse the EC private key (CDP uses ES256)
    let privateKey: Awaited<ReturnType<typeof importPKCS8>>;
    try {
        // CDP API key secret is in PEM format
        if (CDP_API_KEY_SECRET.includes('-----BEGIN')) {
            privateKey = await importPKCS8(CDP_API_KEY_SECRET, 'ES256');
        } else {
            // Try as raw base64
            const keyBuffer = Buffer.from(CDP_API_KEY_SECRET, 'base64');
            privateKey = await importPKCS8(
                `-----BEGIN PRIVATE KEY-----\n${keyBuffer.toString('base64')}\n-----END PRIVATE KEY-----`,
                'ES256'
            );
        }
    } catch (e) {
        throw new Error(`Failed to parse CDP API key: ${e}`);
    }

    const jwt = await new SignJWT({
        sub: CDP_API_KEY_ID,
        iss: 'cdp',
        nbf: now,
        exp: now + 120, // 2 minute expiry
        uris: [`${method.toUpperCase()} ${host}${path}`],
    })
        .setProtectedHeader({ alg: 'ES256', kid: CDP_API_KEY_ID, nonce, typ: 'JWT' })
        .sign(privateKey);

    return jwt;
}

/**
 * Create auth headers function for CDP facilitator
 */
async function createCdpAuthHeaders(): Promise<{
    verify: Record<string, string>;
    settle: Record<string, string>;
    supported: Record<string, string>;
}> {
    const host = 'api.cdp.coinbase.com';

    const [verifyJwt, settleJwt, supportedJwt] = await Promise.all([
        generateCdpJwt('POST', host, '/platform/v2/x402/verify'),
        generateCdpJwt('POST', host, '/platform/v2/x402/settle'),
        generateCdpJwt('GET', host, '/platform/v2/x402/supported'),
    ]);

    return {
        verify: { 'Authorization': `Bearer ${verifyJwt}` },
        settle: { 'Authorization': `Bearer ${settleJwt}` },
        supported: { 'Authorization': `Bearer ${supportedJwt}` },
    };
}

/**
 * Check if x402 server is configured and enabled
 */
export function isX402Configured(): boolean {
    return X402_ENABLED && !!X402_WALLET_ADDRESS;
}

/**
 * Check if mainnet CDP credentials are configured
 */
function hasCdpCredentials(): boolean {
    return !!(CDP_API_KEY_ID && CDP_API_KEY_SECRET);
}

/**
 * Initialize x402 server with payment middleware
 */
function initializeServer() {
    if (!X402_WALLET_ADDRESS) {
        console.warn('⚠️  X402_WALLET_ADDRESS not set - x402 server disabled');
        return app;
    }

    // Determine network and facilitator configuration
    const isMainnet = X402_NETWORK === 'base';
    // Use EIP-155 chain ID format for Bazaar discovery
    const network = isMainnet ? 'eip155:8453' : 'eip155:84532';

    // Configure facilitator based on network
    let facilitatorConfig: { url: string; createAuthHeaders?: () => Promise<any> };

    if (isMainnet) {
        if (!hasCdpCredentials()) {
            console.warn('⚠️  CDP_API_KEY_ID and CDP_API_KEY_SECRET required for mainnet x402');
            console.warn('   Falling back to testnet facilitator (payments will NOT work on mainnet!)');
            facilitatorConfig = { url: TESTNET_FACILITATOR_URL };
        } else {
            console.log('✅ CDP credentials configured for mainnet x402');
            facilitatorConfig = {
                url: MAINNET_FACILITATOR_URL,
                createAuthHeaders: createCdpAuthHeaders
            };
        }
    } else {
        console.log('ℹ️  Using testnet facilitator (Base Sepolia)');
        facilitatorConfig = { url: TESTNET_FACILITATOR_URL };
    }

    // Define routes with Bazaar-compatible discovery extensions
    // Format follows x402 v2 spec: https://x402.gitbook.io/x402/core-concepts/bazaar-discovery-layer
    const routes = {
        "POST /api/v1/swap-quote": {
            price: "$0.02",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Get optimal swap route with price impact analysis for Base DEX trading",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            tokenIn: { type: "string", description: "Input token address (e.g., 0x4200000000000000000000000000000000000006 for WETH)", required: true },
                            tokenOut: { type: "string", description: "Output token address (e.g., 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913 for USDC)", required: true },
                            amountIn: { type: "string", description: "Amount to swap in human-readable format (e.g., '1.0')", required: true }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            amountOut: { type: "string", description: "Expected output amount" },
                            priceImpact: { type: "string", description: "Price impact percentage" },
                            fee: { type: "string", description: "Trading fee" },
                            route: { type: "string", description: "Optimal route path" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/pool-analysis": {
            price: "$0.10",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Comprehensive liquidity pool analysis with health scoring and TVL metrics",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            tokenA: { type: "string", description: "First token address", required: true },
                            tokenB: { type: "string", description: "Second token address", required: true }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            tvl: { type: "string", description: "Total value locked" },
                            liquidityRating: { type: "string", description: "Pool liquidity rating (GOOD/MEDIUM/LOW)" },
                            healthScore: { type: "number", description: "Pool health score 0-100" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/technical-analysis": {
            price: "$0.25",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Full technical analysis with RSI, MACD, moving averages, patterns, and trading signals",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            token: { type: "string", description: "CoinGecko token ID (e.g., 'bitcoin', 'ethereum')", required: true },
                            timeframe: { type: "string", description: "Analysis period in days: 1, 7, 14, or 30" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            rsi: { type: "number", description: "Relative Strength Index (0-100)" },
                            trend: { type: "string", description: "Current trend direction" },
                            momentum: { type: "string", description: "Momentum indicator" },
                            recommendation: { type: "string", description: "Trading recommendation (BUY/SELL/HOLD)" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/swap": {
            price: "$0.50",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Execute token swap on Silverback DEX via OpenOcean aggregator on Base chain",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            tokenIn: { type: "string", description: "Token to sell (address or symbol like 'USDC')", required: true },
                            tokenOut: { type: "string", description: "Token to buy (address or symbol like 'WETH')", required: true },
                            amountIn: { type: "string", description: "Amount to swap in human-readable format", required: true },
                            slippage: { type: "string", description: "Slippage tolerance percentage (default: 0.5)" },
                            walletAddress: { type: "string", description: "Recipient wallet address" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            txHash: { type: "string", description: "Transaction hash on Base" },
                            sold: { type: "string", description: "Amount sold" },
                            received: { type: "string", description: "Amount received" }
                        }
                    }
                }
            }
        },
        "GET /api/v1/dex-metrics": {
            price: "$0.05",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Overall DEX statistics, routing info, and supported tokens on Base chain",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {},
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            network: { type: "string" },
                            chainId: { type: "number" },
                            routing: { type: "object", description: "Sample routing information" },
                            supportedTokens: { type: "object", description: "Map of supported token addresses" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/backtest": {
            price: "$1.00",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Run trading strategy backtest on historical OHLCV data with performance metrics",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            token: { type: "string", description: "CoinGecko token ID (e.g., 'bitcoin')", required: true },
                            strategy: { type: "string", description: "Strategy type: 'momentum' or 'mean_reversion'", required: true },
                            period: { type: "string", description: "Backtest period in days (default: 30)" },
                            signalThreshold: { type: "number", description: "Signal threshold 0-100 (default: 70)" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            stats: {
                                type: "object",
                                properties: {
                                    totalReturn: { type: "string" },
                                    winRate: { type: "number" },
                                    sharpeRatio: { type: "number" }
                                }
                            },
                            trades: { type: "array", description: "List of backtest trades" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/defi-yield": {
            price: "$0.05",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Find DeFi yield opportunities for any token on Base including lending, staking, and LP",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            token: { type: "string", description: "Token symbol (USDC, WETH, cbBTC) or contract address", required: true },
                            riskTolerance: { type: "string", description: "Risk level: 'low', 'medium', or 'high' (default: medium)" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            totalOpportunities: { type: "number" },
                            bestApr: { type: "string", description: "Highest APR available" },
                            opportunities: { type: "array", description: "List of yield opportunities" }
                        }
                    }
                }
            }
        },
        "POST /api/v1/lp-analysis": {
            price: "$0.05",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Analyze liquidity provider positions for token pairs with APR and impermanent loss estimates",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        body: {
                            tokenPair: { type: "string", description: "Token pair like 'USDC/WETH'" },
                            tokenA: { type: "string", description: "First token symbol or address" },
                            tokenB: { type: "string", description: "Second token symbol or address" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            positions: { type: "array", description: "Available LP positions" },
                            summary: {
                                type: "object",
                                properties: {
                                    totalValue: { type: "string" },
                                    weightedApr: { type: "string" }
                                }
                            }
                        }
                    }
                }
            }
        },
        "GET /api/v1/top-pools": {
            price: "$0.03",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Get top yielding liquidity pools on Base DEXes sorted by APR",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        queryParams: {
                            limit: { type: "number", description: "Number of pools to return (1-20, default: 10)" },
                            minTvl: { type: "number", description: "Minimum TVL in USD (default: 100000)" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            topPools: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        apr: { type: "string" },
                                        tvl: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "GET /api/v1/top-protocols": {
            price: "$0.03",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Get top DeFi protocols ranked by TVL with category filtering",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        queryParams: {
                            limit: { type: "number", description: "Number of protocols to return (1-50, default: 10)" },
                            chain: { type: "string", description: "Chain filter: 'base', 'ethereum', 'arbitrum', or 'all'" },
                            category: { type: "string", description: "Protocol category: 'dex', 'lending', 'bridge', etc." }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            topProtocols: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        name: { type: "string" },
                                        tvl: { type: "string" },
                                        category: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        "GET /api/v1/top-coins": {
            price: "$0.03",
            network: network,
            resource: X402_WALLET_ADDRESS,
            description: "Get top cryptocurrencies ranked by market cap with price and 24h change",
            extensions: {
                bazaar: {
                    discoverable: true,
                    inputSchema: {
                        queryParams: {
                            limit: { type: "number", description: "Number of coins to return (1-50, default: 10)" },
                            chain: { type: "string", description: "Chain filter: 'base', 'ethereum', or 'all'" }
                        }
                    },
                    outputSchema: {
                        type: "object",
                        properties: {
                            success: { type: "boolean" },
                            topCoins: {
                                type: "array",
                                items: {
                                    type: "object",
                                    properties: {
                                        rank: { type: "number" },
                                        name: { type: "string" },
                                        symbol: { type: "string" },
                                        price: { type: "string" },
                                        marketCap: { type: "string" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };

    app.use(
        paymentMiddleware(
            X402_WALLET_ADDRESS as `0x${string}`,
            routes,
            facilitatorConfig  // Use CDP mainnet facilitator
        )
    );

    return app;
}

// Initialize the server
initializeServer();

// === FREE ENDPOINTS ===

/**
 * Root redirect to pricing
 */
app.get('/', (_req: Request, res: Response) => {
    res.redirect('/api/v1/pricing');
});

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
    const isMainnet = X402_NETWORK === 'base';
    res.json({
        service: 'Silverback DEX Intelligence',
        description: 'DeFi trading intelligence and DEX execution on Silverback DEX',
        documentation: 'https://silverbackdefi.app/api-docs',
        bazaar: {
            discoverable: true,
            listEndpoint: 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources'
        },
        payment: {
            network: isMainnet ? 'eip155:8453' : 'eip155:84532',
            networkName: isMainnet ? 'Base Mainnet' : 'Base Sepolia',
            token: 'USDC',
            tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
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
                path: '/api/v1/swap',
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
                method: 'POST',
                path: '/api/v1/backtest',
                price: '$1.00',
                description: 'Run strategy backtest on historical data',
                parameters: { strategy: 'momentum or mean_reversion', token: 'CoinGecko ID', period: 'days (default: 30)', signalThreshold: '0-100 (default: 70)' }
            },
            {
                method: 'POST',
                path: '/api/v1/defi-yield',
                price: '$0.05',
                description: 'DeFi yield opportunities for any token on Base',
                parameters: { token: 'symbol (USDC, WETH, cbBTC) or address', riskTolerance: 'low/medium/high (default: medium)' }
            },
            {
                method: 'POST',
                path: '/api/v1/lp-analysis',
                price: '$0.05',
                description: 'LP position analysis for token pairs',
                parameters: { tokenPair: 'e.g., USDC/WETH', tokenA: 'symbol', tokenB: 'symbol' }
            },
            {
                method: 'GET',
                path: '/api/v1/top-pools',
                price: '$0.03',
                description: 'Top yielding pools on Base DEXes',
                parameters: { limit: 'number (default: 10)', minTvl: 'USD (default: 100000)' }
            },
            {
                method: 'GET',
                path: '/api/v1/top-protocols',
                price: '$0.03',
                description: 'Top DeFi protocols by TVL',
                parameters: { limit: 'number (default: 10)', chain: 'chain name (default: base)', category: 'dex/lending/etc (optional)' }
            },
            {
                method: 'GET',
                path: '/api/v1/top-coins',
                price: '$0.03',
                description: 'Top cryptocurrencies by market cap',
                parameters: { limit: 'number (default: 10)', chain: 'chain name (default: all)' }
            }
        ],
        freeEndpoints: [
            { method: 'GET', path: '/health', description: 'Health check' },
            { method: 'GET', path: '/api/v1/pricing', description: 'This pricing info' },
            { method: 'GET', path: '/api/v1/price/:token', description: 'Token price feed (CoinGecko)' }
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
app.post('/api/v1/swap', async (req: Request, res: Response) => {
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
 * Overall DEX statistics from Base chain via OpenOcean
 */
app.get('/api/v1/dex-metrics', async (_req: Request, res: Response) => {
    try {
        const weth = '0x4200000000000000000000000000000000000006';
        const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
        const amountIn = '1000000000000000000'; // 1 WETH in wei

        let routingInfo = null;

        // Try OpenOcean first for real DEX routing data
        try {
            // Use correct OpenOcean V4 API parameters
            const quoteResponse = await fetch(
                `https://open-api.openocean.finance/v4/base/quote?` +
                `inTokenAddress=${weth}&outTokenAddress=${usdc}&` +
                `amountDecimals=${amountIn}&gasPriceDecimals=1000000000&slippage=1`
            );

            console.log(`[DEX Metrics] OpenOcean response status: ${quoteResponse.status}`);

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

        // Fallback to CoinGecko if OpenOcean fails
        if (!routingInfo) {
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
                            source: 'CoinGecko (fallback)',
                            priceImpact: '< 0.1% (estimate)'
                        };
                    }
                }
            } catch (cgError) {
                console.log('[DEX Metrics] CoinGecko error:', cgError);
            }
        }

        res.json({
            success: true,
            data: {
                network: 'Base',
                chainId: 8453,
                aggregator: 'OpenOcean',
                protocol: 'Silverback DEX',
                router: '0x565cBf0F3eAdD873212Db91896e9a548f6D64894',
                routing: routingInfo || { status: 'Unable to fetch quote data' },
                capabilities: [
                    'Multi-DEX aggregation via OpenOcean',
                    'Best price routing across Uniswap, Sushiswap, Curve, etc.',
                    'Swap execution on Base chain',
                    'Technical analysis & backtesting',
                    'CoinGecko price fallback'
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

/**
 * DeFi Yield Analysis - $0.05
 * Find yield opportunities for any token on Base
 */
app.post('/api/v1/defi-yield', async (req: Request, res: Response) => {
    try {
        const input: YieldAnalysisInput = req.body;

        if (!input.token) {
            res.status(400).json({
                success: false,
                error: 'Missing required field: token (symbol or address)'
            });
            return;
        }

        const result = await handleYieldAnalysis(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * LP Analysis - $0.05
 * Analyze LP positions for token pairs
 */
app.post('/api/v1/lp-analysis', async (req: Request, res: Response) => {
    try {
        const input: LPAnalysisInput = req.body;

        if (!input.tokenPair && (!input.tokenA || !input.tokenB)) {
            res.status(400).json({
                success: false,
                error: 'Missing required fields: tokenPair (e.g., "USDC/WETH") or tokenA and tokenB'
            });
            return;
        }

        const result = await handleLPAnalysis(input);
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Top Pools - $0.03
 * Get top yielding pools on Base DEXes
 */
app.get('/api/v1/top-pools', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const minTvl = parseInt(req.query.minTvl as string) || 100000;

        const result = await handleTopPools({ limit, minTvl });
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Top Protocols - $0.03
 * Get top DeFi protocols by TVL
 */
app.get('/api/v1/top-protocols', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const chain = req.query.chain as string || 'base';
        const category = req.query.category as string;

        const result = await handleTopProtocols({ limit, chain, category });
        res.json(result);
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Internal server error'
        });
    }
});

/**
 * Top Coins - $0.03
 * Get top cryptocurrencies by market cap
 */
app.get('/api/v1/top-coins', async (req: Request, res: Response) => {
    try {
        const limit = parseInt(req.query.limit as string) || 10;
        const chain = req.query.chain as string || 'all';

        const result = await handleTopCoins({ limit, chain });
        res.json(result);
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

    const isMainnet = X402_NETWORK === 'base';
    const networkDisplay = isMainnet ? 'Base Mainnet (eip155:8453)' : 'Base Sepolia (eip155:84532)';

    app.listen(PORT, () => {
        console.log(`\n🦍 Silverback x402 server running on port ${PORT}`);
        console.log(`   Wallet: ${X402_WALLET_ADDRESS}`);
        console.log(`   Network: ${networkDisplay}`);
        console.log(`   Token: USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)`);
        console.log(`   Bazaar: discoverable: true (11 endpoints)`);
        console.log(`   Pricing: GET /api/v1/pricing`);
        console.log(`   Health: GET /health`);
        if (isMainnet && hasCdpCredentials()) {
            console.log(`   ✅ CDP facilitator configured - services will appear in Bazaar`);
        } else if (isMainnet) {
            console.log(`   ⚠️  CDP credentials missing - services will NOT appear in Bazaar`);
        }
        console.log('');
    });
}

export default app;
