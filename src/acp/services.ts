/**
 * ACP Service Handlers
 *
 * These handlers process incoming ACP job requests and return deliverables.
 * Each service maps to a registered offering on the ACP platform.
 *
 * Services:
 * 1. swap-quote - Get optimal swap route with price impact ($0.02)
 * 2. pool-analysis - Comprehensive liquidity pool analysis ($0.10)
 * 3. technical-analysis - Full technical analysis with indicators ($0.25)
 * 4. execute-swap - Execute swap on Silverback DEX (fund-transfer)
 * 5. lp-analysis - LP position analytics for Aerodrome/Uniswap V3 ($0.05)
 * 6. yield-analysis - Token yield opportunities across Base DeFi ($0.05)
 * 7. top-pools - Best yielding pools on Aerodrome ($0.03)
 */

import { ethers } from 'ethers';
import * as crypto from 'crypto';
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

// Base Mainnet Configuration - Multiple RPCs for fallback
const BASE_RPC_URLS = [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
    'https://base.drpc.org',
    'https://1rpc.io/base',
    'https://base-mainnet.public.blastapi.io'
];
const BASE_RPC_URL = process.env.BASE_RPC_URL || BASE_RPC_URLS[0];
const SILVERBACK_UNIFIED_ROUTER = '0x565cBf0F3eAdD873212Db91896e9a548f6D64894';
const SILVERBACK_V2_FACTORY = '0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae';
const WETH_BASE = '0x4200000000000000000000000000000000000006';

// CDP Swap API Configuration
const CDP_API_KEY = process.env.CDP_API_KEY;
const CDP_API_SECRET = process.env.CDP_API_SECRET;
const CDP_SWAP_API = 'https://api.cdp.coinbase.com/platform/v2/evm/swaps';

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
    'function transfer(address to, uint256 amount) returns (bool)',
];

// OpenOcean API for Base chain aggregation (fallback)
const OPENOCEAN_API = 'https://open-api.openocean.finance/v4/base';

// CoinGecko API
const COINGECKO_API = process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

// CDP Client API Key for RPC (separate from Secret Key)
const CDP_CLIENT_KEY = process.env.CDP_CLIENT_KEY;

function getProvider(): ethers.JsonRpcProvider {
    // Use CDP RPC if client key available, otherwise fall back to public RPC
    const rpcUrl = CDP_CLIENT_KEY
        ? `https://api.developer.coinbase.com/rpc/v1/base/${CDP_CLIENT_KEY}`
        : BASE_RPC_URL;
    return new ethers.JsonRpcProvider(rpcUrl);
}

/**
 * Generate JWT for CDP API authentication
 * Based on CDP docs: https://docs.cdp.coinbase.com/api-reference/v2/authentication
 *
 * CDP Secret API Keys use EdDSA (Ed25519) algorithm, NOT ES256
 * The key is base64-encoded: first 32 bytes = seed, next 32 bytes = public key
 */
function generateCdpJwt(method: string, path: string): string | null {
    if (!CDP_API_KEY || !CDP_API_SECRET) {
        return null;
    }

    try {
        const keyName = CDP_API_KEY;
        const keySecret = CDP_API_SECRET;

        // Decode the base64 key - it's 64 bytes: 32-byte seed + 32-byte public key
        const keyBytes = Buffer.from(keySecret, 'base64');

        // Extract the seed (first 32 bytes) for Ed25519 signing
        const seed = keyBytes.subarray(0, 32);

        const host = 'api.cdp.coinbase.com';
        const uri = `${method} ${host}${path}`;

        const now = Math.floor(Date.now() / 1000);
        const nonce = crypto.randomBytes(16).toString('hex');

        // Header for EdDSA
        const header = {
            alg: 'EdDSA',
            typ: 'JWT',
            kid: keyName,
            nonce: nonce
        };

        // Payload per CDP docs
        const payload = {
            sub: keyName,
            iss: 'cdp',
            aud: ['cdp_service'],
            nbf: now,
            exp: now + 120,
            uri
        };

        // Base64url encode helper
        const base64UrlEncode = (data: string | Buffer): string => {
            const base64 = Buffer.from(data).toString('base64');
            return base64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
        };

        const headerEncoded = base64UrlEncode(JSON.stringify(header));
        const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
        const message = `${headerEncoded}.${payloadEncoded}`;

        // Create Ed25519 private key from seed
        const privateKey = crypto.createPrivateKey({
            key: Buffer.concat([
                // Ed25519 PKCS8 prefix for 32-byte seed
                Buffer.from('302e020100300506032b657004220420', 'hex'),
                seed
            ]),
            format: 'der',
            type: 'pkcs8'
        });

        // Sign with Ed25519
        const signature = crypto.sign(null, Buffer.from(message), privateKey);
        const signatureEncoded = base64UrlEncode(signature);

        return `${message}.${signatureEncoded}`;
    } catch (e) {
        console.log('[CDP JWT] Error generating token:', e instanceof Error ? e.message : e);
        return null;
    }
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
 * Uses CDP Swap API (primary) or OpenOcean (fallback) for best prices across multiple DEXs on Base
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

        // Resolve token addresses (support symbols like WETH, USDC, or any token via CoinGecko)
        const tokenInAddress = await resolveTokenAddressAsync(tokenIn);
        const tokenOutAddress = await resolveTokenAddressAsync(tokenOut);

        if (!tokenInAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenIn}. Use 0x address or a valid symbol.`
            };
        }

        if (!tokenOutAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenOut}. Use 0x address or a valid symbol.`
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

        // Try CDP Swap API first (Coinbase's aggregator)
        if (CDP_API_KEY && CDP_API_SECRET) {
            console.log(`[SwapQuote] Fetching quote from CDP Swap API for ${amountIn} ${symbolIn} → ${symbolOut}`);
            try {
                const cdpJwt = generateCdpJwt('POST', '/platform/v2/evm/swaps');
                if (cdpJwt) {
                    // Use the agent wallet address as taker
                    const takerAddress = process.env.ACP_AGENT_WALLET_ADDRESS || process.env.WHITELISTED_WALLET_ADDRESS;

                    if (!takerAddress) {
                        console.log('[SwapQuote] CDP: No taker address configured, skipping');
                    } else {
                        // If taker is a smart contract (ERC-4337), we need signerAddress
                        const signerAddress = process.env.WHITELISTED_WALLET_ADDRESS;

                        const requestBody: Record<string, any> = {
                            network: 'base',
                            fromToken: tokenInAddress,
                            toToken: tokenOutAddress,
                            fromAmount: amountInWei.toString(),
                            taker: takerAddress,
                            slippageBps: 100
                        };

                        // Add signerAddress if taker is smart account and we have a signer
                        if (signerAddress && takerAddress !== signerAddress) {
                            requestBody.signerAddress = signerAddress;
                        }

                        console.log('[SwapQuote] CDP request:', JSON.stringify(requestBody));

                        const cdpResponse = await fetch(CDP_SWAP_API, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${cdpJwt}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(requestBody)
                        });

                    console.log(`[SwapQuote] CDP response status: ${cdpResponse.status}`);

                    if (cdpResponse.ok) {
                        const cdpData = await cdpResponse.json();
                        console.log(`[SwapQuote] CDP data:`, JSON.stringify(cdpData).substring(0, 500));

                        if (cdpData.toAmount) {
                            const amountOutHuman = ethers.formatUnits(cdpData.toAmount, decimalsOut);
                            const minAmountOut = cdpData.minToAmount ? ethers.formatUnits(cdpData.minToAmount, decimalsOut) : amountOutHuman;

                            return {
                                success: true,
                                data: {
                                    tokenIn: tokenInAddress,
                                    tokenOut: tokenOutAddress,
                                    amountIn,
                                    amountOut: amountOutHuman,
                                    priceImpact: cdpData.fees?.protocolFee ? 'Included in quote' : '< 0.5%',
                                    fee: cdpData.fees?.gasFee?.amount ? `Gas: ${ethers.formatUnits(cdpData.fees.gasFee.amount, 18)} ETH` : 'Included',
                                    route: [symbolIn, symbolOut],
                                    router: SILVERBACK_UNIFIED_ROUTER,
                                    chain: 'Base',
                                    aggregator: 'Coinbase CDP',
                                    estimatedGas: cdpData.transaction?.gas || 'N/A',
                                    priceInUSD: cdpData.fromAmountUSD ? `$${parseFloat(cdpData.fromAmountUSD).toFixed(2)}` : undefined,
                                    priceOutUSD: cdpData.toAmountUSD ? `$${parseFloat(cdpData.toAmountUSD).toFixed(2)}` : undefined,
                                    note: cdpData.liquidityAvailable === false ? 'Warning: Limited liquidity' : undefined,
                                    timestamp: new Date().toISOString()
                                }
                            };
                        }
                    } else {
                        const errorText = await cdpResponse.text();
                        console.log(`[SwapQuote] CDP error response:`, errorText.substring(0, 300));
                    }
                    }
                }
            } catch (cdpError: any) {
                console.log('[SwapQuote] CDP error:', cdpError.message);
            }
        }

        // Fallback to OpenOcean aggregator
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

        // Get token details using cached info with fallback
        const token0Info = await getTokenInfo(token0, provider);
        const token1Info = await getTokenInfo(token1, provider);

        const symbol0 = token0Info.symbol;
        const symbol1 = token1Info.symbol;
        const decimals0 = token0Info.decimals;
        const decimals1 = token1Info.decimals;

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
// Common token symbols - fallback cache for known tokens
const TOKEN_SYMBOLS: Record<string, string> = {
    'WETH': '0x4200000000000000000000000000000000000006',
    'ETH': '0x4200000000000000000000000000000000000006',
    'USDC': '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    'BACK': '0x558881c4959e9cf961a7E1815FCD6586906babd2',
    'USDBC': '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',  // USDbC (bridged)
    'DAI': '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
    'VIRTUAL': '0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b',
    'AERO': '0x940181a94A35A4569E4529A3CDfB74e38FD98631',
    'DEGEN': '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed',
    'BRETT': '0x532f27101965dd16442E59d40670FaF5eBB142E4',
    'TOSHI': '0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4',
    'CBETH': '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',  // cbETH
    'RETH': '0xB6fe221Fe9EeF5aBa221c348bA20A1Bf5e73624c',
    'CBBTC': '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf',  // cbBTC
    'HIGHER': '0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe',
    'WELL': '0xA88594D404727625A9437C3f886C7643872296AE',
};

// Reverse mapping: address to token info (symbol + decimals)
const TOKEN_INFO: Record<string, { symbol: string; decimals: number }> = {
    '0x4200000000000000000000000000000000000006': { symbol: 'WETH', decimals: 18 },
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': { symbol: 'USDC', decimals: 6 },
    '0x558881c4959e9cf961a7e1815fcd6586906babd2': { symbol: 'BACK', decimals: 18 },
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': { symbol: 'USDbC', decimals: 6 },
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': { symbol: 'DAI', decimals: 18 },
    '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': { symbol: 'VIRTUAL', decimals: 18 },
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631': { symbol: 'AERO', decimals: 18 },
    '0x4ed4e862860bed51a9570b96d89af5e1b0efefed': { symbol: 'DEGEN', decimals: 18 },
    '0x532f27101965dd16442e59d40670faf5ebb142e4': { symbol: 'BRETT', decimals: 18 },
    '0xac1bd2486aaf3b5c0fc3fd868558b082a531b2b4': { symbol: 'TOSHI', decimals: 18 },
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': { symbol: 'cbETH', decimals: 18 },
    '0xb6fe221fe9eef5aba221c348ba20a1bf5e73624c': { symbol: 'rETH', decimals: 18 },
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', decimals: 8 },
    '0x0578d8a44db98b23bf096a382e016e29a5ce0ffe': { symbol: 'HIGHER', decimals: 18 },
    '0xa88594d404727625a9437c3f886c7643872296ae': { symbol: 'WELL', decimals: 18 },
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

// Dynamic symbol cache - populated at runtime from API lookups
const dynamicSymbolCache: Record<string, string> = {};

// Resolve token input (address or symbol) to address
// Now supports dynamic lookup via CoinGecko for unknown symbols
async function resolveTokenAddressAsync(tokenInput: string): Promise<string | null> {
    // If already an address
    if (isValidAddress(tokenInput)) {
        return tokenInput;
    }

    const upper = tokenInput.toUpperCase();

    // Check static cache first
    if (TOKEN_SYMBOLS[upper]) {
        return TOKEN_SYMBOLS[upper];
    }

    // Check dynamic cache
    if (dynamicSymbolCache[upper]) {
        return dynamicSymbolCache[upper];
    }

    // Try CoinGecko search for unknown symbols
    console.log(`[resolveToken] Looking up unknown symbol: ${upper}`);
    try {
        const searchRes = await fetch(
            `${COINGECKO_API}/search?query=${encodeURIComponent(tokenInput)}`,
            { headers: { 'Accept': 'application/json' } }
        );

        if (searchRes.ok) {
            const data = await searchRes.json();
            // Find a coin that matches and has Base platform
            for (const coin of data.coins || []) {
                if (coin.symbol?.toUpperCase() === upper) {
                    // Get detailed info to find Base contract address
                    const coinRes = await fetch(
                        `${COINGECKO_API}/coins/${coin.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`,
                        { headers: { 'Accept': 'application/json' } }
                    );

                    if (coinRes.ok) {
                        const coinData = await coinRes.json();
                        const baseAddress = coinData.platforms?.base;
                        if (baseAddress && isValidAddress(baseAddress)) {
                            console.log(`[resolveToken] Found ${upper} on Base: ${baseAddress}`);
                            dynamicSymbolCache[upper] = baseAddress;
                            return baseAddress;
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.log(`[resolveToken] CoinGecko lookup failed:`, e);
    }

    return null;
}

// Sync version for backward compatibility (uses cache only)
function resolveTokenAddress(tokenInput: string): string | null {
    // If already an address
    if (isValidAddress(tokenInput)) {
        return tokenInput;
    }
    // Try symbol lookup from static + dynamic cache
    const upper = tokenInput.toUpperCase();
    return TOKEN_SYMBOLS[upper] || dynamicSymbolCache[upper] || null;
}

/**
 * Service 4: Execute DEX Swap (Premium)
 * Price: 0.25% of trade value
 *
 * Uses CDP Swap API for best-price routing across multiple DEXs
 */
export async function handleExecuteSwap(input: ExecuteSwapInput): Promise<ExecuteSwapOutput> {
    try {
        const { tokenIn, tokenOut, amountIn, slippage, walletAddress } = input;

        // Check if swap execution is enabled
        const SWAP_PRIVATE_KEY = process.env.SWAP_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ACP_PRIVATE_KEY;
        if (!SWAP_PRIVATE_KEY) {
            return {
                success: false,
                error: "Swap execution is not enabled. SWAP_EXECUTOR_PRIVATE_KEY, WALLET_PRIVATE_KEY, or ACP_PRIVATE_KEY must be set."
            };
        }

        // Validate inputs
        if (!tokenIn || !tokenOut || !amountIn) {
            return {
                success: false,
                error: "Missing required parameters: tokenIn, tokenOut, amountIn"
            };
        }

        // Resolve token addresses (support symbols via CoinGecko lookup)
        const tokenInAddress = await resolveTokenAddressAsync(tokenIn);
        const tokenOutAddress = await resolveTokenAddressAsync(tokenOut);

        if (!tokenInAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenIn}. Use 0x address or a valid symbol.`
            };
        }

        if (!tokenOutAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenOut}. Use 0x address or a valid symbol.`
            };
        }

        // Parse slippage (default 1%)
        const slippagePercent = parseFloat(slippage || '1');
        if (slippagePercent < 0.1 || slippagePercent > 50) {
            return {
                success: false,
                error: "Slippage must be between 0.1% and 50%"
            };
        }
        const slippageBps = Math.floor(slippagePercent * 100);

        const provider = getProvider();

        // Create wallet signer
        const wallet = new ethers.Wallet(SWAP_PRIVATE_KEY, provider);

        // Get token info
        const tokenInInfo = await getTokenInfo(tokenInAddress, provider);
        const tokenOutInfo = await getTokenInfo(tokenOutAddress, provider);
        const decimalsIn = tokenInInfo.decimals;
        const decimalsOut = tokenOutInfo.decimals;
        const symbolIn = tokenInInfo.symbol;
        const symbolOut = tokenOutInfo.symbol;

        // Convert amount to wei
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        // Recipient address
        const recipient = walletAddress && isValidAddress(walletAddress)
            ? walletAddress
            : wallet.address;

        console.log(`[ExecuteSwap] ${amountIn} ${symbolIn} -> ${symbolOut} for ${recipient}`);

        // Try CDP Swap API first
        if (CDP_API_KEY && CDP_API_SECRET) {
            console.log(`[ExecuteSwap] Using CDP Swap API...`);
            try {
                const cdpJwt = generateCdpJwt('POST', '/platform/v2/evm/swaps');
                if (cdpJwt) {
                    // For execution, taker should be the wallet that holds the tokens and will sign
                    // Use the signing wallet as taker (not the smart account)
                    const takerAddress = wallet.address;

                    const requestBody: Record<string, any> = {
                        network: 'base',
                        fromToken: tokenInAddress,
                        toToken: tokenOutAddress,
                        fromAmount: amountInWei.toString(),
                        taker: takerAddress,
                        slippageBps
                    };
                    // No signerAddress needed when taker is the EOA itself

                    console.log('[ExecuteSwap] CDP request:', JSON.stringify(requestBody));

                    const cdpResponse = await fetch(CDP_SWAP_API, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${cdpJwt}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log(`[ExecuteSwap] CDP response status: ${cdpResponse.status}`);

                    if (cdpResponse.ok) {
                        const cdpData = await cdpResponse.json();
                        console.log(`[ExecuteSwap] CDP data:`, JSON.stringify(cdpData).substring(0, 800));
                        console.log(`[ExecuteSwap] Transaction:`, JSON.stringify(cdpData.transaction));
                        console.log(`[ExecuteSwap] Permit2:`, cdpData.permit2 ? 'present' : 'none');

                        if (cdpData.transaction && cdpData.toAmount) {
                            // CDP returns the transaction to execute
                            const tx = cdpData.transaction;

                            // Check if we need to approve Permit2 first
                            if (cdpData.issues?.allowance?.currentAllowance === '0') {
                                const permit2Address = cdpData.issues.allowance.spender;
                                console.log(`[ExecuteSwap] Approving Permit2 at ${permit2Address}...`);

                                const tokenContract = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
                                const approveTx = await tokenContract.approve(permit2Address, ethers.MaxUint256);
                                await approveTx.wait();
                                console.log(`[ExecuteSwap] Permit2 approval confirmed: ${approveTx.hash}`);
                            }

                            // If there's a Permit2 signature required, sign it and append to tx data
                            // Format: <original tx data><sig length as 32-byte big-endian><signature>
                            let txData = tx.data;
                            if (cdpData.permit2?.eip712) {
                                console.log(`[ExecuteSwap] Signing Permit2 message...`);
                                const { domain, types, message } = cdpData.permit2.eip712;
                                // Remove EIP712Domain from types as ethers adds it automatically
                                delete types.EIP712Domain;
                                const signature = await wallet.signTypedData(domain, types, message);
                                console.log(`[ExecuteSwap] Permit2 signed: ${signature.substring(0, 20)}...`);

                                // Append signature with 32-byte length prefix (per 0x/Permit2 spec)
                                // The signature is 65 bytes (0x + 130 hex chars)
                                const sigBytes = signature.slice(2); // Remove 0x prefix
                                const sigLength = sigBytes.length / 2; // Convert hex length to byte length
                                // Create 32-byte big-endian length prefix
                                const lengthHex = sigLength.toString(16).padStart(64, '0');
                                txData = tx.data + lengthHex + sigBytes;
                                console.log(`[ExecuteSwap] Appended sig (${sigLength} bytes) with length prefix`);
                            }

                            // Execute the swap transaction
                            console.log(`[ExecuteSwap] Sending transaction to ${tx.to}...`);
                            const swapTx = await wallet.sendTransaction({
                                to: tx.to,
                                data: txData,
                                value: tx.value || '0',
                                gasLimit: tx.gas ? BigInt(tx.gas) * BigInt(120) / BigInt(100) : undefined // Add 20% buffer
                            });

                            console.log(`[ExecuteSwap] Transaction sent: ${swapTx.hash}`);
                            const receipt = await swapTx.wait();
                            console.log(`[ExecuteSwap] Transaction confirmed!`);

                            const amountOutHuman = ethers.formatUnits(cdpData.toAmount, decimalsOut);
                            const executionPrice = (parseFloat(amountIn) / parseFloat(amountOutHuman)).toFixed(8);

                            // If recipient is different from taker, transfer the received tokens
                            let finalTxHash = receipt!.hash;
                            if (recipient.toLowerCase() !== wallet.address.toLowerCase()) {
                                // Transfer only the amount received from this swap, not entire balance
                                const amountToTransfer = BigInt(cdpData.toAmount);
                                console.log(`[ExecuteSwap] Transferring ${amountOutHuman} ${symbolOut} to ${recipient}...`);
                                try {
                                    const tokenOutContract = new ethers.Contract(tokenOutAddress, ERC20_ABI, wallet);
                                    const transferTx = await tokenOutContract.getFunction('transfer')(recipient, amountToTransfer);
                                    const transferReceipt = await transferTx.wait();
                                    console.log(`[ExecuteSwap] Transfer confirmed: ${transferReceipt.hash}`);
                                    finalTxHash = transferReceipt.hash; // Use transfer tx as final
                                } catch (transferErr: any) {
                                    console.log(`[ExecuteSwap] Transfer failed: ${transferErr.message}`);
                                    // Still return success for swap, but note transfer failed
                                }
                            }

                            return {
                                success: true,
                                data: {
                                    txHash: finalTxHash,
                                    actualOutput: amountOutHuman,
                                    executionPrice: `${executionPrice} ${symbolIn}/${symbolOut}`,
                                    sold: `${amountIn} ${symbolIn}`,
                                    received: `${amountOutHuman} ${symbolOut}`,
                                    recipient: recipient,
                                    gasUsed: receipt!.gasUsed.toString(),
                                    chain: 'Base',
                                    router: tx.to,
                                    timestamp: new Date().toISOString()
                                }
                            };
                        }
                    } else {
                        const errorText = await cdpResponse.text();
                        console.log(`[ExecuteSwap] CDP error:`, errorText.substring(0, 300));
                    }
                }
            } catch (cdpError: any) {
                console.log('[ExecuteSwap] CDP error:', cdpError.message);
            }
        }

        // Fallback to direct Silverback router
        console.log(`[ExecuteSwap] Falling back to Silverback router...`);
        const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);

        // Get quote from router
        const path = [tokenInAddress, tokenOutAddress];
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOut = amounts[1];

        // Calculate minimum output with slippage
        const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 100));
        const amountOutMin = (expectedOut * slippageMultiplier) / BigInt(10000);

        // Set deadline (20 minutes from now)
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        // Check allowance and approve if needed
        const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
        const allowance = await tokenInContract.allowance(wallet.address, SILVERBACK_UNIFIED_ROUTER) as bigint;
        if (allowance < amountInWei) {
            console.log(`[ExecuteSwap] Approving ${symbolIn} for router...`);
            const tokenInWithSigner = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
            const approveTx = await tokenInWithSigner.getFunction('approve')(
                SILVERBACK_UNIFIED_ROUTER,
                ethers.MaxUint256
            );
            await approveTx.wait();
            console.log(`[ExecuteSwap] Approval confirmed: ${approveTx.hash}`);
        }

        // Execute the swap
        console.log(`[ExecuteSwap] Executing via Silverback: ${amountIn} ${symbolIn} -> ${symbolOut}`);
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
 * Execute swap using funds received from ACP buyer
 * This is used for fund-transfer jobs where the buyer sends tokens first
 *
 * Key differences from handleExecuteSwap:
 * 1. Funds are already in our wallet (sent by buyer via ACP)
 * 2. We swap and send output directly to buyer's address
 * 3. No transfer step needed - CDP sends directly to recipient if possible
 */
export interface ExecuteSwapWithFundsInput {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    slippage: string;
    recipientAddress: string; // Buyer's wallet - receives swapped tokens
}

export async function handleExecuteSwapWithFunds(input: ExecuteSwapWithFundsInput): Promise<ExecuteSwapOutput> {
    const { tokenIn, tokenOut, amountIn, slippage, recipientAddress } = input;

    try {
        // Validate inputs
        if (!tokenIn || !tokenOut || !amountIn || !recipientAddress) {
            return {
                success: false,
                error: "Missing required parameters: tokenIn, tokenOut, amountIn, recipientAddress"
            };
        }

        // Resolve token addresses
        const tokenInAddress = await resolveTokenAddressAsync(tokenIn);
        const tokenOutAddress = await resolveTokenAddressAsync(tokenOut);

        if (!tokenInAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenIn}. Use 0x address or a valid symbol.`
            };
        }

        if (!tokenOutAddress) {
            return {
                success: false,
                error: `Unknown token: ${tokenOut}. Use 0x address or a valid symbol.`
            };
        }

        // Get provider and wallet
        const SWAP_PRIVATE_KEY = process.env.SWAP_EXECUTOR_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || process.env.ACP_PRIVATE_KEY;
        if (!SWAP_PRIVATE_KEY) {
            return {
                success: false,
                error: "Swap execution is not enabled. SWAP_EXECUTOR_PRIVATE_KEY, WALLET_PRIVATE_KEY, or ACP_PRIVATE_KEY must be set."
            };
        }

        const provider = getProvider();
        const wallet = new ethers.Wallet(SWAP_PRIVATE_KEY, provider);

        // Get token info
        const { decimals: decimalsIn, symbol: symbolIn } = await getTokenInfo(tokenInAddress, provider);
        const { decimals: decimalsOut, symbol: symbolOut } = await getTokenInfo(tokenOutAddress, provider);

        // Parse amount
        const amountInFloat = parseFloat(amountIn);
        if (isNaN(amountInFloat) || amountInFloat <= 0) {
            return {
                success: false,
                error: "Invalid amountIn value"
            };
        }
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
        const slippagePercent = parseFloat(slippage) || 1;
        const slippageBps = Math.floor(slippagePercent * 100);

        console.log(`[ExecuteSwapWithFunds] ${amountIn} ${symbolIn} -> ${symbolOut} for buyer ${recipientAddress}`);

        // Check if we have the tokens (should have been received from buyer)
        const tokenInContract = new ethers.Contract(tokenInAddress, ERC20_ABI, provider);
        const balance = await tokenInContract.balanceOf(wallet.address) as bigint;

        if (balance < amountInWei) {
            return {
                success: false,
                error: `Insufficient ${symbolIn} balance. Expected ${amountIn}, have ${ethers.formatUnits(balance, decimalsIn)}`
            };
        }

        // Try CDP Swap API first
        if (CDP_API_KEY && CDP_API_SECRET) {
            try {
                const cdpJwt = generateCdpJwt('POST', '/platform/v2/evm/swaps');
                if (cdpJwt) {
                    // Check Permit2 allowance and approve if needed
                    const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
                    const currentAllowance = await tokenInContract.allowance(wallet.address, PERMIT2_ADDRESS) as bigint;

                    if (currentAllowance < amountInWei) {
                        console.log(`[ExecuteSwapWithFunds] Approving Permit2...`);
                        const tokenWithSigner = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
                        const approveTx = await tokenWithSigner.getFunction('approve')(
                            PERMIT2_ADDRESS,
                            ethers.MaxUint256
                        );
                        await approveTx.wait();
                        console.log(`[ExecuteSwapWithFunds] Permit2 approved`);
                    }

                    // Request swap from CDP
                    const requestBody = {
                        network: 'base',
                        fromToken: tokenInAddress,
                        toToken: tokenOutAddress,
                        fromAmount: amountInWei.toString(),
                        taker: wallet.address, // Our wallet executes the swap
                        slippageBps
                    };

                    console.log(`[ExecuteSwapWithFunds] CDP request:`, JSON.stringify(requestBody));

                    const cdpResponse = await fetch(CDP_SWAP_API, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${cdpJwt}`
                        },
                        body: JSON.stringify(requestBody)
                    });

                    console.log(`[ExecuteSwapWithFunds] CDP response status: ${cdpResponse.status}`);

                    if (cdpResponse.ok) {
                        const cdpData = await cdpResponse.json();
                        const tx = cdpData.transaction;

                        if (tx?.data && tx?.to) {
                            // Sign Permit2 message if required
                            let txData = tx.data;
                            if (cdpData.permit2?.eip712) {
                                console.log(`[ExecuteSwapWithFunds] Signing Permit2 message...`);
                                const { domain, types, message } = cdpData.permit2.eip712;
                                delete types.EIP712Domain;
                                const signature = await wallet.signTypedData(domain, types, message);

                                // Append signature with 32-byte length prefix
                                const sigBytes = signature.slice(2);
                                const sigLength = sigBytes.length / 2;
                                const lengthHex = sigLength.toString(16).padStart(64, '0');
                                txData = tx.data + lengthHex + sigBytes;
                                console.log(`[ExecuteSwapWithFunds] Permit2 signed`);
                            }

                            // Execute the swap
                            console.log(`[ExecuteSwapWithFunds] Executing swap...`);
                            const swapTx = await wallet.sendTransaction({
                                to: tx.to,
                                data: txData,
                                value: tx.value || '0',
                                gasLimit: tx.gas ? BigInt(tx.gas) * BigInt(120) / BigInt(100) : undefined
                            });

                            console.log(`[ExecuteSwapWithFunds] Transaction sent: ${swapTx.hash}`);
                            const receipt = await swapTx.wait();
                            console.log(`[ExecuteSwapWithFunds] Swap confirmed!`);

                            const amountOutHuman = ethers.formatUnits(cdpData.toAmount, decimalsOut);
                            const executionPrice = (parseFloat(amountIn) / parseFloat(amountOutHuman)).toFixed(8);

                            // Swap complete - tokens are now in our EOA wallet
                            // The transfer to buyer is handled in index.ts handleTransactionPhase
                            // which manually transfers then calls job.deliver()
                            console.log(`[ExecuteSwapWithFunds] Swap complete. Output: ${amountOutHuman} ${symbolOut}`);
                            console.log(`[ExecuteSwapWithFunds] Tokens held in EOA for manual transfer to ${recipientAddress}`);

                            return {
                                success: true,
                                data: {
                                    txHash: receipt!.hash,
                                    actualOutput: amountOutHuman,
                                    executionPrice: `${executionPrice} ${symbolIn}/${symbolOut}`,
                                    sold: `${amountIn} ${symbolIn}`,
                                    received: `${amountOutHuman} ${symbolOut}`,
                                    recipient: recipientAddress,
                                    gasUsed: receipt!.gasUsed.toString(),
                                    chain: 'Base',
                                    router: tx.to,
                                    timestamp: new Date().toISOString()
                                }
                            };
                        }
                    } else {
                        const errorText = await cdpResponse.text();
                        console.log(`[ExecuteSwapWithFunds] CDP error:`, errorText.substring(0, 300));
                    }
                }
            } catch (cdpError: any) {
                console.log('[ExecuteSwapWithFunds] CDP error:', cdpError.message);
            }
        }

        // Fallback to direct Silverback router
        console.log(`[ExecuteSwapWithFunds] Falling back to Silverback router...`);
        const router = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, provider);

        // Get quote from router
        const path = [tokenInAddress, tokenOutAddress];
        const amounts = await router.getAmountsOut(amountInWei, path);
        const expectedOut = amounts[1];

        // Calculate minimum output with slippage
        const slippageMultiplier = BigInt(Math.floor((100 - slippagePercent) * 100));
        const amountOutMin = (expectedOut * slippageMultiplier) / BigInt(10000);

        // Set deadline
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        // Check allowance and approve if needed
        const allowance = await tokenInContract.allowance(wallet.address, SILVERBACK_UNIFIED_ROUTER) as bigint;
        if (allowance < amountInWei) {
            console.log(`[ExecuteSwapWithFunds] Approving ${symbolIn} for router...`);
            const tokenInWithSigner = new ethers.Contract(tokenInAddress, ERC20_ABI, wallet);
            const approveTx = await tokenInWithSigner.getFunction('approve')(
                SILVERBACK_UNIFIED_ROUTER,
                ethers.MaxUint256
            );
            await approveTx.wait();
        }

        // Execute swap - send directly to buyer's address
        console.log(`[ExecuteSwapWithFunds] Executing via Silverback: ${amountIn} ${symbolIn} -> ${symbolOut}`);
        const routerSigner = new ethers.Contract(SILVERBACK_UNIFIED_ROUTER, ROUTER_ABI, wallet);
        const tx = await routerSigner.getFunction('swapExactTokensForTokens')(
            amountInWei,
            amountOutMin,
            path,
            recipientAddress, // Send directly to buyer
            deadline
        );

        const receipt = await tx.wait();
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
                recipient: recipientAddress,
                gasUsed: receipt.gasUsed.toString(),
                chain: 'Base',
                router: SILVERBACK_UNIFIED_ROUTER,
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        const error = e as Error;
        console.error(`[ExecuteSwapWithFunds] Error:`, error.message);

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
            case 'swapquote':
            case 'getswapquote':
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

            case 'lpanalysis':
            case 'lp_analysis':
            case 'lp-analysis':
            case 'lp-position':
            case 'liquidity-analysis':
            case 'position-analysis':
                result = await handleLPAnalysis(input);
                break;

            case 'toppools':
            case 'top_pools':
            case 'top-pools':
            case 'best-yields':
            case 'pool-opportunities':
                result = await handleTopPools(input);
                break;

            case 'defiyield':
            case 'defi_yield':
            case 'defi-yield':
            case 'yield-analysis':
            case 'token-yield':
            case 'yield-opportunities':
            case 'find-yields':
            case 'get-yields':
            case 'best-returns':
            case 'yield-farming':
            case 'apy-analysis':
            case 'earn-opportunities':
            case 'where-to-stake':
            case 'maximize-yield':
            case 'yield-strategy':
            case 'base-yields':
            case 'aerodrome-yields':
            case 'lp-yields':
                result = await handleYieldAnalysis(input);
                break;

            default:
                // Try to infer service type from input
                if (input.tokenIn && input.tokenOut && input.amountIn) {
                    result = await handleSwapQuote(input);
                } else if (input.poolAddress || input.tokenPair || input.positionId) {
                    result = await handleLPAnalysis(input);
                } else if (input.tokenA && input.tokenB || input.poolId) {
                    result = await handlePoolAnalysis(input);
                } else if (input.token) {
                    result = await handleTechnicalAnalysis(input);
                } else {
                    result = {
                        success: false,
                        error: `Unknown service type: ${serviceType}. Available: swap-quote, pool-analysis, technical-analysis, lp-analysis, top-pools`
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

// ============================================================================
// LP POSITION ANALYSIS SERVICE
// Comprehensive liquidity position analytics for DeFi agents
// Supports: Aerodrome, Uniswap V3, Morpho (lending)
// ============================================================================

// Protocol Contract Addresses on Base
const PROTOCOLS = {
    aerodrome: {
        router: '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43',
        factory: '0x420DD381b31aEf6683db6B902084cB0FFECe40Da',
        voter: '0x16613524e02ad97eDfeF371bC883F2F5d6C480A5',
        aero: '0x940181a94A35A4569E4529A3CDfB74e38FD98631'
    },
    uniswapV3: {
        factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
        positionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
        quoter: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a',
        router: '0x2626664c2603336E57B271c5C0b26F421741e481'
    },
    morpho: {
        core: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
        registry: '0x3696c5eAe4a7Ffd04Ea163564571E9CD8Ed9364e'
    }
};

// ABIs for LP analysis
const AERODROME_POOL_ABI = [
    'function getReserves() view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast)',
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function totalSupply() view returns (uint256)',
    'function stable() view returns (bool)',
    'function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)',
    'function metadata() view returns (uint256 dec0, uint256 dec1, uint256 r0, uint256 r1, bool st, address t0, address t1)'
];

const AERODROME_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, bool stable) view returns (address)',
    'function allPoolsLength() view returns (uint256)',
    'function allPools(uint256 index) view returns (address)'
];

const AERODROME_GAUGE_ABI = [
    'function rewardRate() view returns (uint256)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function earned(address) view returns (uint256)'
];

const AERODROME_VOTER_ABI = [
    'function gauges(address pool) view returns (address)',
    'function isGauge(address gauge) view returns (bool)'
];

const UNISWAP_V3_POOL_ABI = [
    'function token0() view returns (address)',
    'function token1() view returns (address)',
    'function fee() view returns (uint24)',
    'function liquidity() view returns (uint128)',
    'function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)',
    'function tickSpacing() view returns (int24)',
    'function feeGrowthGlobal0X128() view returns (uint256)',
    'function feeGrowthGlobal1X128() view returns (uint256)'
];

const UNISWAP_V3_FACTORY_ABI = [
    'function getPool(address tokenA, address tokenB, uint24 fee) view returns (address)'
];

const UNISWAP_V3_POSITION_MANAGER_ABI = [
    'function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)',
    'function balanceOf(address owner) view returns (uint256)',
    'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)'
];

// LP Analysis Input/Output Types
export interface LPAnalysisInput {
    // Required: one of these
    walletAddress?: string;      // Analyze all LP positions for a wallet
    poolAddress?: string;        // Analyze specific pool
    tokenPair?: string;          // e.g., "USDC/WETH"
    tokenA?: string;             // Token A address or symbol
    tokenB?: string;             // Token B address or symbol

    // Optional parameters
    protocol?: 'aerodrome' | 'uniswap' | 'all';  // Which protocol to check
    positionId?: string;         // Specific Uniswap V3 position NFT ID
    includeRewards?: boolean;    // Include pending rewards
    includeFees?: boolean;       // Include uncollected fees
    calculateIL?: boolean;       // Calculate impermanent loss
    timeframe?: string;          // For historical analysis: '24h', '7d', '30d'
}

export interface LPPositionData {
    protocol: string;
    poolAddress: string;
    poolType: string;            // 'stable' | 'volatile' | 'concentrated'
    token0: {
        address: string;
        symbol: string;
        decimals: number;
        reserve: string;
        priceUSD: string;
    };
    token1: {
        address: string;
        symbol: string;
        decimals: number;
        reserve: string;
        priceUSD: string;
    };
    // Position metrics
    tvlUSD: string;
    userLiquidity?: string;      // User's share if wallet provided
    userSharePercent?: string;
    userValueUSD?: string;

    // Yield metrics
    apr: {
        trading: string;         // From trading fees
        rewards: string;         // From emissions (AERO, etc.)
        total: string;
    };
    volume24h: string;
    fees24h: string;

    // Impermanent loss
    impermanentLoss?: {
        percentage: string;
        valueUSD: string;
        vsHodl: string;          // Comparison to just holding
        breakEvenAPR: string;    // APR needed to offset IL
    };

    // Concentrated liquidity (Uniswap V3)
    concentratedLiquidity?: {
        tickLower: number;
        tickUpper: number;
        priceLower: string;
        priceUpper: string;
        inRange: boolean;
        capitalEfficiency: string;
    };

    // Pending rewards/fees
    pendingRewards?: {
        token: string;
        amount: string;
        valueUSD: string;
    }[];
    unclaimedFees?: {
        token0: string;
        token1: string;
        totalUSD: string;
    };

    // Health & recommendations
    healthScore: number;         // 0-100
    recommendations: string[];
    risks: string[];

    timestamp: string;
}

export interface LPAnalysisOutput {
    success: boolean;
    data?: {
        summary: {
            totalPositions: number;
            totalValueUSD: string;
            averageAPR: string;
            protocols: string[];
        };
        positions: LPPositionData[];
        pair?: string;
        timestamp?: string;
    };
    error?: string;
}

/**
 * Calculate Impermanent Loss
 * IL = 2 * sqrt(priceRatio) / (1 + priceRatio) - 1
 */
function calculateImpermanentLoss(
    initialPrice: number,
    currentPrice: number
): { percentage: number; multiplier: number } {
    const priceRatio = currentPrice / initialPrice;
    const sqrtRatio = Math.sqrt(priceRatio);
    const ilMultiplier = (2 * sqrtRatio) / (1 + priceRatio);
    const ilPercentage = (1 - ilMultiplier) * 100;

    return {
        percentage: ilPercentage,
        multiplier: ilMultiplier
    };
}

/**
 * Calculate APR from trading fees
 */
function calculateTradingAPR(
    volume24h: number,
    feePercent: number,
    tvl: number
): number {
    if (tvl === 0) return 0;
    const dailyFees = volume24h * (feePercent / 100);
    const dailyAPR = (dailyFees / tvl) * 100;
    return dailyAPR * 365;
}

// Price cache to reduce API calls
const priceCache: Record<string, { price: number; timestamp: number }> = {};
const PRICE_CACHE_TTL = 60000; // 1 minute

// Fallback prices for common tokens (updated periodically)
const FALLBACK_PRICES: Record<string, number> = {
    '0x4200000000000000000000000000000000000006': 3000,   // WETH ~$3000
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 1,      // USDC
    '0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca': 1,      // USDbC
    '0x50c5725949a6f0c72e6c4a641f24049a917db0cb': 1,      // DAI
    '0x940181a94a35a4569e4529a3cdfb74e38fd98631': 1.5,    // AERO ~$1.50
    '0x0b3e328455c4059eeb9e3f84b5543f74e24e7e1b': 2,      // VIRTUAL ~$2
    '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 100000, // cbBTC ~$100k
    '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22': 3200,   // cbETH ~$3200
};

/**
 * Get token price from CoinGecko with caching and fallback
 */
async function getTokenPriceUSD(tokenAddress: string): Promise<number> {
    const lowerAddress = tokenAddress.toLowerCase();

    // Check cache first
    const cached = priceCache[lowerAddress];
    if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL) {
        return cached.price;
    }

    try {
        const url = `${COINGECKO_API}/simple/token_price/base?contract_addresses=${lowerAddress}&vs_currencies=usd`;
        const headers: Record<string, string> = {
            'Accept': 'application/json'
        };
        if (process.env.COINGECKO_API_KEY) {
            headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
        }

        const response = await fetch(url, { headers });
        if (response.ok) {
            const data = await response.json();
            const price = data[lowerAddress]?.usd || 0;
            if (price > 0) {
                priceCache[lowerAddress] = { price, timestamp: Date.now() };
                return price;
            }
        }
    } catch (e) {
        console.log(`[LP] CoinGecko price fetch failed for ${tokenAddress}`);
    }

    // Use fallback price
    const fallback = FALLBACK_PRICES[lowerAddress];
    if (fallback) {
        console.log(`[LP] Using fallback price for ${tokenAddress}: $${fallback}`);
        return fallback;
    }

    return 0;
}

/**
 * Analyze Aerodrome Pool
 */
async function analyzeAerodromePool(
    poolAddress: string,
    walletAddress?: string
): Promise<LPPositionData | null> {
    try {
        const provider = getProvider();

        const pool = new ethers.Contract(poolAddress, AERODROME_POOL_ABI, provider);
        const voter = new ethers.Contract(PROTOCOLS.aerodrome.voter, AERODROME_VOTER_ABI, provider);

        // Get pool metadata
        const [reserves, token0Addr, token1Addr, totalSupply, isStable] = await Promise.all([
            pool.getReserves(),
            pool.token0(),
            pool.token1(),
            pool.totalSupply(),
            pool.stable()
        ]);

        // Get token info
        const token0Contract = new ethers.Contract(token0Addr, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Addr, ERC20_ABI, provider);

        const [symbol0, symbol1, decimals0Raw, decimals1Raw] = await Promise.all([
            token0Contract.symbol(),
            token1Contract.symbol(),
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);

        // Convert BigInt decimals to Number
        const decimals0 = Number(decimals0Raw);
        const decimals1 = Number(decimals1Raw);

        // Get prices
        const [price0, price1] = await Promise.all([
            getTokenPriceUSD(token0Addr),
            getTokenPriceUSD(token1Addr)
        ]);

        const reserve0 = parseFloat(ethers.formatUnits(reserves[0], decimals0));
        const reserve1 = parseFloat(ethers.formatUnits(reserves[1], decimals1));

        const tvl0 = reserve0 * price0;
        const tvl1 = reserve1 * price1;
        const tvlUSD = tvl0 + tvl1;

        // Get gauge for rewards APR
        let rewardsAPR = 0;
        let pendingRewards: { token: string; amount: string; valueUSD: string }[] = [];

        try {
            const gaugeAddress = await voter.gauges(poolAddress);
            if (gaugeAddress !== ethers.ZeroAddress) {
                const gauge = new ethers.Contract(gaugeAddress, AERODROME_GAUGE_ABI, provider);
                const [rewardRate, gaugeTotalSupply] = await Promise.all([
                    gauge.rewardRate(),
                    gauge.totalSupply()
                ]);

                // AERO price
                const aeroPrice = await getTokenPriceUSD(PROTOCOLS.aerodrome.aero);

                // Calculate rewards APR
                const rewardsPerYear = parseFloat(ethers.formatUnits(rewardRate, 18)) * 365 * 24 * 3600;
                const rewardsValuePerYear = rewardsPerYear * aeroPrice;

                if (tvlUSD > 0) {
                    rewardsAPR = (rewardsValuePerYear / tvlUSD) * 100;
                }

                // Get user's pending rewards if wallet provided
                if (walletAddress) {
                    try {
                        const earned = await gauge.earned(walletAddress);
                        const earnedAmount = parseFloat(ethers.formatUnits(earned, 18));
                        if (earnedAmount > 0) {
                            pendingRewards.push({
                                token: 'AERO',
                                amount: earnedAmount.toFixed(4),
                                valueUSD: (earnedAmount * aeroPrice).toFixed(2)
                            });
                        }
                    } catch (e) {
                        // User may not have staked
                    }
                }
            }
        } catch (e) {
            // No gauge or error
        }

        // Estimate trading APR (use 0.3% fee for volatile, 0.01% for stable)
        const feePercent = isStable ? 0.01 : 0.3;
        // Rough estimate: assume volume is 5-10% of TVL daily for active pools
        const estimatedVolume = tvlUSD * 0.05;
        const tradingAPR = calculateTradingAPR(estimatedVolume, feePercent, tvlUSD);

        // User position if wallet provided
        let userLiquidity: string | undefined;
        let userSharePercent: string | undefined;
        let userValueUSD: string | undefined;

        if (walletAddress) {
            try {
                const userBalance = await pool.balanceOf(walletAddress);
                const userShare = parseFloat(ethers.formatUnits(userBalance, 18));
                const totalSupplyFloat = parseFloat(ethers.formatUnits(totalSupply, 18));

                if (userShare > 0 && totalSupplyFloat > 0) {
                    const sharePercent = (userShare / totalSupplyFloat) * 100;
                    userLiquidity = userShare.toFixed(6);
                    userSharePercent = sharePercent.toFixed(4);
                    userValueUSD = (tvlUSD * sharePercent / 100).toFixed(2);
                }
            } catch (e) {
                // Error getting user balance
            }
        }

        // Health score
        let healthScore = 50;
        if (tvlUSD > 1000000) healthScore += 20;
        else if (tvlUSD > 100000) healthScore += 10;
        if (rewardsAPR > 0) healthScore += 15;
        if (isStable) healthScore += 10;

        const recommendations: string[] = [];
        const risks: string[] = [];

        if (tvlUSD < 50000) {
            risks.push('Low liquidity - high slippage risk');
        }
        if (rewardsAPR > 100) {
            recommendations.push('High rewards APR - consider staking LP tokens');
            risks.push('High APR may indicate inflation or low TVL');
        }
        if (!isStable) {
            risks.push('Volatile pair - impermanent loss risk');
        }

        return {
            protocol: 'Aerodrome',
            poolAddress,
            poolType: isStable ? 'stable' : 'volatile',
            token0: {
                address: token0Addr,
                symbol: symbol0,
                decimals: decimals0,
                reserve: reserve0.toFixed(4),
                priceUSD: price0.toFixed(6)
            },
            token1: {
                address: token1Addr,
                symbol: symbol1,
                decimals: decimals1,
                reserve: reserve1.toFixed(4),
                priceUSD: price1.toFixed(6)
            },
            tvlUSD: formatLargeNumber(tvlUSD),
            userLiquidity,
            userSharePercent,
            userValueUSD,
            apr: {
                trading: tradingAPR.toFixed(2) + '%',
                rewards: rewardsAPR.toFixed(2) + '%',
                total: (tradingAPR + rewardsAPR).toFixed(2) + '%'
            },
            volume24h: formatLargeNumber(estimatedVolume),
            fees24h: formatLargeNumber(estimatedVolume * feePercent / 100),
            pendingRewards: pendingRewards.length > 0 ? pendingRewards : undefined,
            healthScore,
            recommendations,
            risks,
            timestamp: new Date().toISOString()
        };
    } catch (e) {
        console.log(`[LP] Aerodrome pool analysis failed:`, e);
        return null;
    }
}

/**
 * Analyze Uniswap V3 Position
 */
async function analyzeUniswapV3Position(
    positionId: string,
    walletAddress?: string
): Promise<LPPositionData | null> {
    try {
        const provider = getProvider();
        const positionManager = new ethers.Contract(
            PROTOCOLS.uniswapV3.positionManager,
            UNISWAP_V3_POSITION_MANAGER_ABI,
            provider
        );

        // Get position data
        const position = await positionManager.positions(positionId);

        const token0Addr = position.token0;
        const token1Addr = position.token1;
        const fee = position.fee;
        const tickLower = position.tickLower;
        const tickUpper = position.tickUpper;
        const liquidity = position.liquidity;
        const tokensOwed0 = position.tokensOwed0;
        const tokensOwed1 = position.tokensOwed1;

        // Get pool
        const factory = new ethers.Contract(
            PROTOCOLS.uniswapV3.factory,
            UNISWAP_V3_FACTORY_ABI,
            provider
        );
        const poolAddress = await factory.getPool(token0Addr, token1Addr, fee);

        const pool = new ethers.Contract(poolAddress, UNISWAP_V3_POOL_ABI, provider);
        const slot0 = await pool.slot0();
        const currentTick = slot0.tick;

        // Get token info
        const token0Contract = new ethers.Contract(token0Addr, ERC20_ABI, provider);
        const token1Contract = new ethers.Contract(token1Addr, ERC20_ABI, provider);

        const [symbol0, symbol1, decimals0Raw, decimals1Raw] = await Promise.all([
            token0Contract.symbol(),
            token1Contract.symbol(),
            token0Contract.decimals(),
            token1Contract.decimals()
        ]);

        // Convert BigInt decimals to Number
        const decimals0 = Number(decimals0Raw);
        const decimals1 = Number(decimals1Raw);

        // Get prices
        const [price0, price1] = await Promise.all([
            getTokenPriceUSD(token0Addr),
            getTokenPriceUSD(token1Addr)
        ]);

        // Calculate position value and range
        const sqrtPriceX96 = BigInt(slot0.sqrtPriceX96.toString());
        // Q96 = 2^96 - use multiplication instead of exponentiation for compatibility
        const Q96 = BigInt('79228162514264337593543950336'); // 2^96

        // Current price
        const currentPrice = Number((sqrtPriceX96 * sqrtPriceX96 * BigInt(10 ** decimals0)) / (Q96 * Q96)) / (10 ** decimals1);

        // Price range from ticks
        const priceLower = Math.pow(1.0001, Number(tickLower)) * (10 ** decimals0) / (10 ** decimals1);
        const priceUpper = Math.pow(1.0001, Number(tickUpper)) * (10 ** decimals0) / (10 ** decimals1);

        const inRange = currentTick >= tickLower && currentTick < tickUpper;

        // Estimate position value (simplified)
        const liquidityFloat = parseFloat(ethers.formatUnits(liquidity, 0));
        const estimatedValue = liquidityFloat > 0 ? liquidityFloat / 1e12 * (price0 + price1) : 0;

        // Unclaimed fees
        const fees0 = parseFloat(ethers.formatUnits(tokensOwed0, decimals0));
        const fees1 = parseFloat(ethers.formatUnits(tokensOwed1, decimals1));
        const totalFeesUSD = fees0 * price0 + fees1 * price1;

        // Fee tier APR estimate
        const feePercent = Number(fee) / 10000; // fee is in hundredths of a bp
        const tradingAPR = inRange ? feePercent * 365 * 10 : 0; // Rough estimate

        // Health score
        let healthScore = 50;
        if (inRange) healthScore += 30;
        if (totalFeesUSD > 0) healthScore += 10;
        if (liquidityFloat > 0) healthScore += 10;

        const recommendations: string[] = [];
        const risks: string[] = [];

        if (!inRange) {
            risks.push('Position out of range - not earning fees');
            recommendations.push('Consider rebalancing to current price range');
        }
        if (totalFeesUSD > 10) {
            recommendations.push(`Collect ${totalFeesUSD.toFixed(2)} USD in unclaimed fees`);
        }

        return {
            protocol: 'Uniswap V3',
            poolAddress,
            poolType: 'concentrated',
            token0: {
                address: token0Addr,
                symbol: symbol0,
                decimals: decimals0,
                reserve: '0', // N/A for V3
                priceUSD: price0.toFixed(6)
            },
            token1: {
                address: token1Addr,
                symbol: symbol1,
                decimals: decimals1,
                reserve: '0',
                priceUSD: price1.toFixed(6)
            },
            tvlUSD: formatLargeNumber(estimatedValue),
            userValueUSD: estimatedValue.toFixed(2),
            apr: {
                trading: tradingAPR.toFixed(2) + '%',
                rewards: '0%',
                total: tradingAPR.toFixed(2) + '%'
            },
            volume24h: 'N/A',
            fees24h: 'N/A',
            concentratedLiquidity: {
                tickLower: Number(tickLower),
                tickUpper: Number(tickUpper),
                priceLower: priceLower.toFixed(6),
                priceUpper: priceUpper.toFixed(6),
                inRange,
                capitalEfficiency: ((priceUpper / priceLower - 1) * 100).toFixed(1) + '%'
            },
            unclaimedFees: {
                token0: fees0.toFixed(6) + ' ' + symbol0,
                token1: fees1.toFixed(6) + ' ' + symbol1,
                totalUSD: totalFeesUSD.toFixed(2)
            },
            healthScore,
            recommendations,
            risks,
            timestamp: new Date().toISOString()
        };
    } catch (e) {
        console.log(`[LP] Uniswap V3 position analysis failed:`, e);
        return null;
    }
}

/**
 * Find Aerodrome pool by token pair
 */
async function findAerodromePool(
    tokenA: string,
    tokenB: string,
    preferStable: boolean = false
): Promise<string | null> {
    try {
        const provider = getProvider();
        const factory = new ethers.Contract(
            PROTOCOLS.aerodrome.factory,
            AERODROME_FACTORY_ABI,
            provider
        );

        // Resolve token addresses
        const addrA = await resolveTokenAddressAsync(tokenA);
        const addrB = await resolveTokenAddressAsync(tokenB);

        if (!addrA || !addrB) return null;

        // Try stable first if preferred, else volatile
        const stablePool = await factory.getPool(addrA, addrB, true);
        const volatilePool = await factory.getPool(addrA, addrB, false);

        if (preferStable && stablePool !== ethers.ZeroAddress) {
            return stablePool;
        }
        if (volatilePool !== ethers.ZeroAddress) {
            return volatilePool;
        }
        if (stablePool !== ethers.ZeroAddress) {
            return stablePool;
        }

        return null;
    } catch (e) {
        console.log(`[LP] Find pool failed:`, e);
        return null;
    }
}

/**
 * Get user's Uniswap V3 positions
 */
async function getUserV3Positions(walletAddress: string): Promise<string[]> {
    try {
        const provider = getProvider();
        const positionManager = new ethers.Contract(
            PROTOCOLS.uniswapV3.positionManager,
            UNISWAP_V3_POSITION_MANAGER_ABI,
            provider
        );

        const balance = await positionManager.balanceOf(walletAddress);
        const positionIds: string[] = [];

        for (let i = 0; i < Number(balance); i++) {
            const tokenId = await positionManager.tokenOfOwnerByIndex(walletAddress, i);
            positionIds.push(tokenId.toString());
        }

        return positionIds;
    } catch (e) {
        console.log(`[LP] Get V3 positions failed:`, e);
        return [];
    }
}

/**
 * Service: LP Position Analysis
 * Price: $0.05 USDC
 *
 * Comprehensive liquidity position analytics for DeFi agents
 * Uses DefiLlama API for reliable data without rate limits
 */
export async function handleLPAnalysis(input: LPAnalysisInput): Promise<LPAnalysisOutput> {
    try {
        const positions: LPPositionData[] = [];
        const protocols: Set<string> = new Set();

        // Determine token pair to search for
        let tokenA: string = '';
        let tokenB: string = '';

        if (input.tokenPair) {
            const parts = input.tokenPair.split('/');
            tokenA = parts[0]?.trim().toUpperCase() || '';
            tokenB = parts[1]?.trim().toUpperCase() || '';
        } else if (input.tokenA && input.tokenB) {
            tokenA = input.tokenA.toUpperCase();
            tokenB = input.tokenB.toUpperCase();
        }

        if (!tokenA || !tokenB) {
            return {
                success: false,
                error: 'Please provide tokenPair (e.g., "USDC/WETH") or tokenA and tokenB'
            };
        }

        // Fetch from DefiLlama
        console.log(`[LP] Fetching pool data from DefiLlama for ${tokenA}/${tokenB}...`);
        const response = await fetch('https://yields.llama.fi/pools', {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Failed to fetch pool data: ${response.status}`
            };
        }

        const llamaData = await response.json();

        // Resolve token addresses
        const addrA = await resolveTokenAddressAsync(tokenA);
        const addrB = await resolveTokenAddressAsync(tokenB);

        if (!addrA || !addrB) {
            return {
                success: false,
                error: `Could not resolve token addresses for ${tokenA} or ${tokenB}`
            };
        }

        const addrALower = addrA.toLowerCase();
        const addrBLower = addrB.toLowerCase();

        // Find matching pools (contain both tokens)
        const matchingPools = llamaData.data.filter((pool: any) => {
            if (pool.chain !== 'Base') return false;
            if (!pool.underlyingTokens || pool.underlyingTokens.length < 2) return false;

            const poolTokens = pool.underlyingTokens.map((t: string) => t.toLowerCase());
            return poolTokens.includes(addrALower) && poolTokens.includes(addrBLower);
        });

        console.log(`[LP] Found ${matchingPools.length} pools for ${tokenA}/${tokenB}`);

        // Convert to position data
        for (const pool of matchingPools) {
            let protocol = pool.project || 'Unknown';
            if (protocol.includes('aerodrome')) {
                protocol = pool.project.includes('slipstream') ? 'Aerodrome Slipstream' : 'Aerodrome';
            } else if (protocol.includes('uniswap')) {
                protocol = 'Uniswap V3';
            }

            const baseAPY = pool.apyBase || 0;
            const rewardAPY = pool.apyReward || 0;
            const totalAPY = pool.apy || (baseAPY + rewardAPY);

            const risks: string[] = [];
            const recommendations: string[] = [];

            if (pool.ilRisk === 'yes') {
                risks.push('Impermanent loss risk on volatile pair');
            }
            if (pool.tvlUsd < 100000) {
                risks.push('Lower liquidity - higher slippage');
            }
            if (rewardAPY > 100) {
                risks.push('High reward APY may not be sustainable');
            }
            if (totalAPY > 50) {
                recommendations.push('Consider farming rewards while APY is high');
            }

            let healthScore = 50;
            if (pool.tvlUsd > 1000000) healthScore += 20;
            else if (pool.tvlUsd > 100000) healthScore += 10;
            if (totalAPY > 10) healthScore += 15;
            if (pool.ilRisk === 'no') healthScore += 10;

            positions.push({
                protocol,
                poolAddress: pool.pool || 'N/A',
                poolType: pool.poolMeta?.includes('CL') ? 'concentrated' : (pool.stablecoin ? 'stable' : 'volatile'),
                token0: {
                    address: pool.underlyingTokens?.[0] || '',
                    symbol: pool.symbol?.split('-')[0] || tokenA,
                    decimals: 18,
                    reserve: 'N/A',
                    priceUSD: 'N/A'
                },
                token1: {
                    address: pool.underlyingTokens?.[1] || '',
                    symbol: pool.symbol?.split('-')[1] || tokenB,
                    decimals: 18,
                    reserve: 'N/A',
                    priceUSD: 'N/A'
                },
                tvlUSD: formatLargeNumber(pool.tvlUsd),
                apr: {
                    trading: baseAPY.toFixed(2) + '%',
                    rewards: rewardAPY.toFixed(2) + '%',
                    total: totalAPY.toFixed(2) + '%'
                },
                volume24h: pool.volumeUsd1d ? formatLargeNumber(pool.volumeUsd1d) : 'N/A',
                fees24h: 'N/A',
                healthScore,
                recommendations,
                risks,
                timestamp: new Date().toISOString()
            });

            protocols.add(protocol);
        }

        if (positions.length === 0) {
            return {
                success: false,
                error: `No pools found for ${tokenA}/${tokenB} on Base. Try different tokens.`
            };
        }

        // Calculate summary from DefiLlama data (no on-chain calls needed)
        let totalValueUSD = 0;
        let weightedAPR = 0;

        for (const pos of positions) {
            // Parse TVL from formatted string
            const tvlStr = pos.tvlUSD.replace(/[$,]/g, '');
            let value = 0;
            if (tvlStr.endsWith('M')) {
                value = parseFloat(tvlStr) * 1000000;
            } else if (tvlStr.endsWith('K')) {
                value = parseFloat(tvlStr) * 1000;
            } else if (tvlStr.endsWith('B')) {
                value = parseFloat(tvlStr) * 1000000000;
            } else {
                value = parseFloat(tvlStr) || 0;
            }

            const apr = parseFloat(pos.apr.total) || 0;
            totalValueUSD += value;
            weightedAPR += apr * value;
        }

        if (totalValueUSD > 0) {
            weightedAPR = weightedAPR / totalValueUSD;
        }

        // Sort by APR (highest first)
        positions.sort((a, b) => parseFloat(b.apr.total) - parseFloat(a.apr.total));

        return {
            success: true,
            data: {
                summary: {
                    totalPositions: positions.length,
                    totalValueUSD: formatLargeNumber(totalValueUSD),
                    averageAPR: weightedAPR.toFixed(2) + '%',
                    protocols: Array.from(protocols)
                },
                positions: positions.slice(0, 10), // Top 10 by APR
                pair: `${tokenA}/${tokenB}`,
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `LP analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

/**
 * Get top yielding pools on Base (Aerodrome, Uniswap, etc.)
 * Uses DefiLlama API for reliable, fast data
 */
export async function handleTopPools(input: { limit?: number; minTvl?: number }): Promise<any> {
    try {
        const limit = Math.min(input.limit || 10, 20);
        const minTvl = input.minTvl || 100000;

        console.log(`[TopPools] Fetching pool data from DefiLlama...`);
        const response = await fetch('https://yields.llama.fi/pools', {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Failed to fetch pool data: ${response.status}`
            };
        }

        const llamaData = await response.json();

        // Filter for Base chain pools with min TVL
        const basePools = llamaData.data.filter((pool: any) => {
            if (pool.chain !== 'Base') return false;
            if ((pool.tvlUsd || 0) < minTvl) return false;
            if (!pool.apy && !pool.apyBase) return false;
            return true;
        });

        console.log(`[TopPools] Found ${basePools.length} Base pools above $${minTvl} TVL`);

        // Sort by total APY (highest first)
        basePools.sort((a: any, b: any) => {
            const apyA = a.apy || ((a.apyBase || 0) + (a.apyReward || 0));
            const apyB = b.apy || ((b.apyBase || 0) + (b.apyReward || 0));
            return apyB - apyA;
        });

        // Take top N pools
        const topPools = basePools.slice(0, limit).map((pool: any) => {
            const baseAPY = pool.apyBase || 0;
            const rewardAPY = pool.apyReward || 0;
            const totalAPY = pool.apy || (baseAPY + rewardAPY);

            let protocol = pool.project || 'Unknown';
            if (protocol.includes('aerodrome')) {
                protocol = pool.project.includes('slipstream') ? 'Aerodrome Slipstream' : 'Aerodrome';
            } else if (protocol.includes('uniswap')) {
                protocol = 'Uniswap V3';
            }

            let poolType = 'volatile';
            if (pool.stablecoin) poolType = 'stable';
            else if (pool.poolMeta?.includes('CL')) poolType = 'concentrated';

            return {
                pool: pool.symbol || 'Unknown',
                address: pool.pool || 'N/A',
                protocol,
                type: poolType,
                tvl: formatLargeNumber(pool.tvlUsd),
                apr: {
                    trading: baseAPY.toFixed(2) + '%',
                    rewards: rewardAPY.toFixed(2) + '%',
                    total: totalAPY.toFixed(2) + '%'
                },
                ilRisk: pool.ilRisk === 'yes' ? 'High' : 'Low'
            };
        });

        return {
            success: true,
            data: {
                topPools,
                scanned: basePools.length,
                total: llamaData.data.filter((p: any) => p.chain === 'Base').length,
                minTvlFilter: formatLargeNumber(minTvl),
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `Failed to get top pools: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

/**
 * Yield Analysis for a specific token
 * Finds all yield opportunities across Base DeFi for USDC, WETH, cbBTC, etc.
 *
 * Price: $0.05 USDC
 */
export interface YieldAnalysisInput {
    token: string;           // Token symbol or address (USDC, WETH, cbBTC, ETH)
    amount?: string;         // Optional: amount to allocate for strategy
    riskTolerance?: 'low' | 'medium' | 'high';  // Risk preference
    includeIL?: boolean;     // Include impermanent loss analysis
}

export interface YieldOpportunity {
    protocol: string;
    type: 'lp' | 'lending' | 'staking' | 'vault';
    pool: string;
    pairedToken?: string;
    tvl: string;
    apr: {
        base: string;        // Trading fees / lending rate
        rewards: string;     // Token incentives
        total: string;
    };
    risks: string[];
    impermanentLoss?: {
        estimatedIL: string;
        netAPR: string;      // APR after IL
    };
    allocation?: {
        amount: string;
        expectedYield: string;
    };
}

export interface YieldAnalysisOutput {
    success: boolean;
    data?: {
        token: string;
        tokenPrice: string;
        totalOpportunities: number;
        opportunities: YieldOpportunity[];
        optimalStrategy?: {
            description: string;
            allocations: {
                protocol: string;
                pool: string;
                percentage: number;
                expectedAPR: string;
            }[];
            totalExpectedAPR: string;
            riskLevel: string;
        };
        marketInsights: {
            bestStableYield: string;
            bestVolatileYield: string;
            averageAPR: string;
            recommendation: string;
        };
        timestamp: string;
    };
    error?: string;
}

// Common trading pairs for major tokens on Base
const TOKEN_PAIRS: Record<string, string[]> = {
    'USDC': ['WETH', 'VIRTUAL', 'AERO', 'cbBTC', 'DAI', 'USDbC', 'DEGEN'],
    'WETH': ['USDC', 'VIRTUAL', 'AERO', 'cbBTC', 'cbETH', 'USDbC'],
    'ETH': ['USDC', 'VIRTUAL', 'AERO', 'cbBTC', 'cbETH', 'USDbC'],
    'cbBTC': ['USDC', 'WETH', 'USDbC'],
    'VIRTUAL': ['USDC', 'WETH', 'AERO'],
    'AERO': ['USDC', 'WETH', 'VIRTUAL']
};

export async function handleYieldAnalysis(input: YieldAnalysisInput): Promise<YieldAnalysisOutput> {
    try {
        const token = input.token.toUpperCase();
        const riskTolerance = input.riskTolerance || 'medium';

        // Resolve token address
        const tokenAddress = await resolveTokenAddressAsync(token);
        if (!tokenAddress) {
            return {
                success: false,
                error: `Unknown token: ${token}. Supported: USDC, WETH, ETH, cbBTC, VIRTUAL, AERO`
            };
        }

        // Get token price
        const tokenPrice = await getTokenPriceUSD(tokenAddress);

        const opportunities: YieldOpportunity[] = [];

        // Fetch yield data from DefiLlama (reliable, no rate limits)
        console.log(`[DefiYield] Fetching yield data from DefiLlama for ${token}...`);
        const response = await fetch('https://yields.llama.fi/pools', {
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            return {
                success: false,
                error: `Failed to fetch yield data: ${response.status}`
            };
        }

        const llamaData = await response.json();
        const tokenAddressLower = tokenAddress.toLowerCase();

        // Filter for Base chain pools containing our token
        const relevantPools = llamaData.data.filter((pool: any) => {
            if (pool.chain !== 'Base') return false;
            if (!pool.underlyingTokens) return false;
            // Check if pool contains our token
            return pool.underlyingTokens.some((addr: string) =>
                addr.toLowerCase() === tokenAddressLower
            );
        });

        console.log(`[DefiYield] Found ${relevantPools.length} pools containing ${token}`);

        // Process each pool
        for (const pool of relevantPools) {
            // Skip tiny pools
            if (pool.tvlUsd < 10000) continue;

            const baseAPY = pool.apyBase || 0;
            const rewardAPY = pool.apyReward || 0;
            const totalAPY = pool.apy || (baseAPY + rewardAPY);

            // Skip pools with no yield data
            if (totalAPY === 0 && pool.tvlUsd < 100000) continue;

            const risks: string[] = [];

            // IL risk
            let ilEstimate: string | undefined;
            let netAPY: string | undefined;
            if (pool.ilRisk === 'yes') {
                const estimatedIL = 2.0; // Conservative estimate
                ilEstimate = estimatedIL.toFixed(2) + '%';
                netAPY = (totalAPY - estimatedIL).toFixed(2) + '%';
                risks.push('Impermanent loss risk');
            }

            // Low liquidity risk
            if (pool.tvlUsd < 100000) {
                risks.push('Lower liquidity - higher slippage');
            }

            // High/unstable APY risk
            if (rewardAPY > 100) {
                risks.push('High reward APY may not be sustainable');
            }
            if (pool.outlier) {
                risks.push('APY outlier - may be temporary');
            }

            // Determine protocol name
            let protocol = pool.project || 'Unknown';
            if (protocol.includes('aerodrome')) {
                protocol = 'Aerodrome';
                if (pool.project.includes('slipstream')) {
                    protocol = 'Aerodrome Slipstream';
                }
            } else if (protocol.includes('uniswap')) {
                protocol = 'Uniswap V3';
            } else if (protocol.includes('morpho')) {
                protocol = 'Morpho';
            }

            opportunities.push({
                protocol,
                type: pool.exposure === 'single' ? 'lending' : 'lp',
                pool: pool.symbol,
                tvl: formatLargeNumber(pool.tvlUsd),
                apr: {
                    base: baseAPY.toFixed(2) + '%',
                    rewards: rewardAPY.toFixed(2) + '%',
                    total: totalAPY.toFixed(2) + '%'
                },
                risks,
                impermanentLoss: ilEstimate ? {
                    estimatedIL: ilEstimate,
                    netAPR: netAPY!
                } : undefined
            });
        }

        // Sort by total APR
        opportunities.sort((a, b) => {
            const aprA = parseFloat(a.apr.total) || 0;
            const aprB = parseFloat(b.apr.total) || 0;
            return aprB - aprA;
        });

        // Calculate optimal strategy based on risk tolerance
        let optimalStrategy;
        if (opportunities.length > 0) {
            const allocations: { protocol: string; pool: string; percentage: number; expectedAPR: string }[] = [];
            let riskLevel = 'Medium';
            let description = '';

            if (riskTolerance === 'low') {
                // Focus on stable pools only
                const stablePools = opportunities.filter(o =>
                    o.pool.includes('USDC') && o.pool.includes('USDbC') ||
                    o.pool.includes('USDC') && o.pool.includes('DAI') ||
                    !o.impermanentLoss
                );
                if (stablePools.length > 0) {
                    allocations.push({
                        protocol: stablePools[0].protocol,
                        pool: stablePools[0].pool,
                        percentage: 100,
                        expectedAPR: stablePools[0].apr.total
                    });
                }
                riskLevel = 'Low';
                description = 'Conservative strategy focusing on stable pairs with minimal IL risk';
            } else if (riskTolerance === 'high') {
                // Top 3 pools by APR
                const top3 = opportunities.slice(0, 3);
                const perPool = Math.floor(100 / top3.length);
                for (const opp of top3) {
                    allocations.push({
                        protocol: opp.protocol,
                        pool: opp.pool,
                        percentage: perPool,
                        expectedAPR: opp.apr.total
                    });
                }
                riskLevel = 'High';
                description = 'Aggressive strategy maximizing APR across highest yielding pools';
            } else {
                // Medium: balanced approach
                const best = opportunities[0];
                const stable = opportunities.find(o => !o.impermanentLoss);

                if (stable && stable !== best) {
                    allocations.push({
                        protocol: best.protocol,
                        pool: best.pool,
                        percentage: 60,
                        expectedAPR: best.apr.total
                    });
                    allocations.push({
                        protocol: stable.protocol,
                        pool: stable.pool,
                        percentage: 40,
                        expectedAPR: stable.apr.total
                    });
                } else {
                    allocations.push({
                        protocol: best.protocol,
                        pool: best.pool,
                        percentage: 100,
                        expectedAPR: best.apr.total
                    });
                }
                riskLevel = 'Medium';
                description = 'Balanced strategy with mix of yield optimization and risk management';
            }

            // Calculate weighted APR
            let totalExpectedAPR = 0;
            for (const alloc of allocations) {
                totalExpectedAPR += (parseFloat(alloc.expectedAPR) || 0) * alloc.percentage / 100;
            }

            optimalStrategy = {
                description,
                allocations,
                totalExpectedAPR: totalExpectedAPR.toFixed(2) + '%',
                riskLevel
            };
        }

        // Market insights
        const stableOpps = opportunities.filter(o => !o.impermanentLoss);
        const volatileOpps = opportunities.filter(o => o.impermanentLoss);

        const bestStable = stableOpps.length > 0 ? stableOpps[0].apr.total : 'N/A';
        const bestVolatile = volatileOpps.length > 0 ? volatileOpps[0].apr.total : 'N/A';

        const avgAPR = opportunities.length > 0
            ? opportunities.reduce((sum, o) => sum + (parseFloat(o.apr.total) || 0), 0) / opportunities.length
            : 0;

        let recommendation = '';
        if (token === 'USDC' || token === 'USDbC' || token === 'DAI') {
            recommendation = 'Stablecoins benefit from stable pools with lower IL risk. Consider USDC/USDbC or USDC/DAI for safer yields.';
        } else if (token === 'WETH' || token === 'ETH') {
            recommendation = 'ETH pairs with USDC offer good volume. Consider cbETH staking for additional yield on top of LP rewards.';
        } else if (token === 'cbBTC') {
            recommendation = 'cbBTC/USDC and cbBTC/WETH pools offer exposure to BTC yields on Base. Watch for IL on volatile moves.';
        } else {
            recommendation = `${token} pools vary in risk/reward. Higher APR pools often have higher IL risk.`;
        }

        return {
            success: true,
            data: {
                token,
                tokenPrice: '$' + tokenPrice.toFixed(4),
                totalOpportunities: opportunities.length,
                opportunities: opportunities.slice(0, 10), // Top 10
                optimalStrategy,
                marketInsights: {
                    bestStableYield: bestStable,
                    bestVolatileYield: bestVolatile,
                    averageAPR: avgAPR.toFixed(2) + '%',
                    recommendation
                },
                timestamp: new Date().toISOString()
            }
        };
    } catch (e) {
        return {
            success: false,
            error: `Yield analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`
        };
    }
}

/**
 * Helper: Find Aerodrome pool by token symbols
 */
async function findAerodromePoolByTokens(
    tokenA: string,
    tokenB: string,
    stable: boolean
): Promise<string | null> {
    try {
        const provider = getProvider();
        const factory = new ethers.Contract(
            PROTOCOLS.aerodrome.factory,
            AERODROME_FACTORY_ABI,
            provider
        );

        const addrA = await resolveTokenAddressAsync(tokenA);
        const addrB = await resolveTokenAddressAsync(tokenB);

        if (!addrA || !addrB) return null;

        const poolAddress = await factory.getPool(addrA, addrB, stable);
        return poolAddress !== ethers.ZeroAddress ? poolAddress : null;
    } catch (e) {
        return null;
    }
}
