/**
 * Virtuals Protocol Integration
 * Fetches $BACK token data from Virtuals platform API
 *
 * Endpoints used:
 * - /api/tokens/{address}/holders - Holder count and distribution
 * - /api/dex/token-reserves/{address} - Liquidity and price data
 * - /vp-api/trades - Recent trades
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

// $BACK Token Configuration
export const BACK_TOKEN = {
    address: "0x558881c4959e9cf961a7E1815FCD6586906babd2",
    poolAddress: "0x9b8c88fd9372a3c8f3526e71ffd5de0972006bba", // DEX pool for price data
    name: "Silverback",
    symbol: "BACK",
    chain: "Base",
    purchaseLink: "https://app.virtuals.io/prototypes/0x558881c4959e9cf961a7E1815FCD6586906babd2",
    dexLink: "https://silverbackdefi.app",
    geckoTerminalLink: "https://www.geckoterminal.com/base/pools/0x9b8c88fd9372a3c8f3526e71ffd5de0972006bba"
};

// API Base URLs
const GECKO_TERMINAL_BASE = "https://api.geckoterminal.com/api/v2";
const API2_BASE = "https://api2.virtuals.io/api";
const VP_API_BASE = "https://vp-api.virtuals.io/vp-api";

// Cache for API responses (15 minute cache)
interface CacheEntry {
    data: any;
    timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes

function getCachedData(key: string): any | null {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
        return entry.data;
    }
    return null;
}

function setCachedData(key: string, data: any): void {
    cache.set(key, { data, timestamp: Date.now() });
}

// Helper to make API calls
async function fetchVirtualsAPI(url: string): Promise<any> {
    const response = await fetch(url, {
        headers: {
            'Accept': 'application/json',
            'User-Agent': 'Silverback-Agent/1.0'
        }
    });

    if (!response.ok) {
        throw new Error(`Virtuals API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

/**
 * Get $BACK token holder count and distribution
 */
export const getBackHoldersFunction = new GameFunction({
    name: "get_back_holders",
    description: `Get the current holder count and distribution for $BACK token on Virtuals Protocol. Returns holder statistics useful for community updates and promotional content.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const cacheKey = "back_holders";
            const cached = getCachedData(cacheKey);

            if (cached) {
                logger(`📊 Using cached holder data`);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify(cached)
                );
            }

            logger(`🦍 Fetching $BACK holder data from Virtuals...`);

            const url = `${API2_BASE}/tokens/${BACK_TOKEN.address}/holders`;
            const data = await fetchVirtualsAPI(url);

            const result = {
                token: BACK_TOKEN.symbol,
                tokenAddress: BACK_TOKEN.address,
                chain: BACK_TOKEN.chain,
                holders: data.totalHolders || data.holders?.length || data.count || 0,
                topHolders: data.holders?.slice(0, 5) || [],
                purchaseLink: BACK_TOKEN.purchaseLink,
                timestamp: new Date().toISOString()
            };

            setCachedData(cacheKey, result);
            logger(`✅ Found ${result.holders} $BACK holders`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );

        } catch (e) {
            const error = e as Error;
            logger(`❌ Error fetching holders: ${error.message}`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch holder data: ${error.message}`
            );
        }
    }
});

/**
 * Get $BACK token price and market data from GeckoTerminal (primary) or Virtuals (fallback)
 */
export const getBackTokenDataFunction = new GameFunction({
    name: "get_back_token_data",
    description: `Get comprehensive $BACK token data including price, market cap, volume, and liquidity from GeckoTerminal. Use this for promotional tweets and community updates about $BACK.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const cacheKey = "back_token_data";
            const cached = getCachedData(cacheKey);

            if (cached) {
                logger(`📊 Using cached token data`);
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify(cached)
                );
            }

            logger(`🦍 Fetching $BACK token data from GeckoTerminal...`);

            let poolData: any = null;
            let tokenData: any = {};

            // Primary: Try GeckoTerminal API for pool data
            try {
                const geckoUrl = `${GECKO_TERMINAL_BASE}/networks/base/pools/${BACK_TOKEN.poolAddress}`;
                const response = await fetch(geckoUrl, {
                    headers: {
                        'Accept': 'application/json',
                        'User-Agent': 'Silverback-Agent/1.0'
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    poolData = data.data?.attributes;
                    logger(`✅ GeckoTerminal data retrieved`);
                }
            } catch (e) {
                logger(`⚠️ GeckoTerminal not available, trying Virtuals API...`);
            }

            // Fallback: Try Virtuals API
            if (!poolData) {
                try {
                    const reservesUrl = `${API2_BASE}/dex/token-reserves/${BACK_TOKEN.address}`;
                    tokenData = await fetchVirtualsAPI(reservesUrl);
                } catch (e) {
                    try {
                        const altUrl = `${API2_BASE}/virtuals/${BACK_TOKEN.address}`;
                        tokenData = await fetchVirtualsAPI(altUrl);
                    } catch (e2) {
                        logger(`⚠️ Virtuals API also not available`);
                    }
                }
            }

            // Extract data from GeckoTerminal pool response
            const result = {
                token: BACK_TOKEN.symbol,
                name: BACK_TOKEN.name,
                address: BACK_TOKEN.address,
                poolAddress: BACK_TOKEN.poolAddress,
                chain: BACK_TOKEN.chain,
                // GeckoTerminal data (primary)
                price: poolData?.base_token_price_usd || tokenData.price || tokenData.priceUsd || null,
                priceChange24h: poolData?.price_change_percentage?.h24 || tokenData.priceChange24h || null,
                priceChange1h: poolData?.price_change_percentage?.h1 || null,
                priceChange6h: poolData?.price_change_percentage?.h6 || null,
                marketCap: poolData?.market_cap_usd || poolData?.fdv_usd || tokenData.marketCap || null,
                volume24h: poolData?.volume_usd?.h24 || tokenData.volume24h || null,
                liquidity: poolData?.reserve_in_usd || tokenData.liquidity || null,
                // Pool info
                poolName: poolData?.name || null,
                dexName: poolData?.dex?.name || "Virtuals",
                // Transaction counts
                txns24h: poolData?.transactions?.h24 ? {
                    buys: poolData.transactions.h24.buys,
                    sells: poolData.transactions.h24.sells,
                    total: poolData.transactions.h24.buys + poolData.transactions.h24.sells
                } : null,
                // Links
                purchaseLink: BACK_TOKEN.purchaseLink,
                dexLink: BACK_TOKEN.dexLink,
                geckoTerminalLink: BACK_TOKEN.geckoTerminalLink,
                dataSource: poolData ? "GeckoTerminal" : "Virtuals",
                timestamp: new Date().toISOString()
            };

            setCachedData(cacheKey, result);

            logger(`✅ $BACK data retrieved (source: ${result.dataSource}):`);
            if (result.price) logger(`   Price: $${parseFloat(result.price).toFixed(8)}`);
            if (result.priceChange24h) logger(`   24h Change: ${result.priceChange24h}%`);
            if (result.marketCap) logger(`   Market Cap: $${formatNumber(result.marketCap)}`);
            if (result.volume24h) logger(`   24h Volume: $${formatNumber(result.volume24h)}`);
            if (result.liquidity) logger(`   Liquidity: $${formatNumber(result.liquidity)}`);
            if (result.txns24h) logger(`   24h Txns: ${result.txns24h.total} (${result.txns24h.buys} buys, ${result.txns24h.sells} sells)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );

        } catch (e) {
            const error = e as Error;
            logger(`❌ Error fetching token data: ${error.message}`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch token data: ${error.message}`
            );
        }
    }
});

/**
 * Get recent $BACK trades from Virtuals
 */
export const getBackRecentTradesFunction = new GameFunction({
    name: "get_back_recent_trades",
    description: `Get recent trades for $BACK token on Virtuals Protocol. Shows buying/selling activity to gauge community interest.`,
    args: [
        {
            name: "limit",
            description: "Number of recent trades to fetch (default: 10, max: 50)",
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const limit = Math.min(parseInt(args.limit || "10"), 50);

            logger(`🦍 Fetching last ${limit} $BACK trades...`);

            const url = `${VP_API_BASE}/trades?tokenAddress=${BACK_TOKEN.address}&limit=${limit}&chainID=0&txSender=&tradeSideOption=0`;
            const data = await fetchVirtualsAPI(url);

            const trades = (data.trades || data || []).slice(0, limit);

            // Calculate summary
            const buyCount = trades.filter((t: any) => t.side === 'buy' || t.type === 'buy').length;
            const sellCount = trades.filter((t: any) => t.side === 'sell' || t.type === 'sell').length;
            const totalVolume = trades.reduce((sum: number, t: any) => sum + (t.amount || t.value || 0), 0);

            const result = {
                token: BACK_TOKEN.symbol,
                address: BACK_TOKEN.address,
                recentTrades: trades.length,
                summary: {
                    buys: buyCount,
                    sells: sellCount,
                    buyPressure: buyCount > sellCount ? "bullish" : sellCount > buyCount ? "bearish" : "neutral",
                    totalVolume: totalVolume
                },
                trades: trades.map((t: any) => ({
                    type: t.side || t.type || 'unknown',
                    amount: t.amount || t.value,
                    price: t.price,
                    time: t.timestamp || t.time || t.createdAt
                })),
                purchaseLink: BACK_TOKEN.purchaseLink,
                timestamp: new Date().toISOString()
            };

            logger(`✅ Found ${trades.length} recent trades (${buyCount} buys, ${sellCount} sells)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );

        } catch (e) {
            const error = e as Error;
            logger(`❌ Error fetching trades: ${error.message}`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch trades: ${error.message}`
            );
        }
    }
});

/**
 * Generate promotional content for $BACK token
 */
export const generateBackPromoFunction = new GameFunction({
    name: "generate_back_promo",
    description: `Generate promotional content for $BACK token with current stats. Returns formatted content ready for Twitter with the Virtuals purchase link. Use this to promote $BACK and help reach the bonding goal.`,
    args: [
        {
            name: "style",
            description: "Promo style: 'stats' (data-focused), 'hype' (excitement), 'educational' (explain value), 'milestone' (celebrate achievements)",
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const style = args.style || "stats";

            logger(`🦍 Generating $BACK promo content (style: ${style})...`);

            // Try to get fresh data from GeckoTerminal (primary) or Virtuals (fallback)
            let poolData: any = null;
            let tokenData: any = {};
            let holderData: any = {};

            // Primary: GeckoTerminal for price data
            try {
                const geckoUrl = `${GECKO_TERMINAL_BASE}/networks/base/pools/${BACK_TOKEN.poolAddress}`;
                const response = await fetch(geckoUrl, {
                    headers: { 'Accept': 'application/json' }
                });
                if (response.ok) {
                    const data = await response.json();
                    poolData = data.data?.attributes;
                    logger(`✅ GeckoTerminal data retrieved for promo`);
                }
            } catch (e) {
                logger(`⚠️ GeckoTerminal not available`);
            }

            // Fallback: Virtuals API
            if (!poolData) {
                try {
                    const reservesUrl = `${API2_BASE}/virtuals/${BACK_TOKEN.address}`;
                    tokenData = await fetchVirtualsAPI(reservesUrl);
                } catch (e) {
                    logger(`⚠️ Could not fetch live token data`);
                }
            }

            try {
                const holdersUrl = `${API2_BASE}/tokens/${BACK_TOKEN.address}/holders`;
                holderData = await fetchVirtualsAPI(holdersUrl);
            } catch (e) {
                logger(`⚠️ Could not fetch live holder data`);
            }

            const holders = holderData.totalHolders || holderData.count || "growing";
            const price = poolData?.base_token_price_usd || tokenData.price || tokenData.priceUsd;
            const mcap = poolData?.market_cap_usd || poolData?.fdv_usd || tokenData.marketCap || tokenData.mcap;
            const volume24h = poolData?.volume_usd?.h24;
            const priceChange24h = poolData?.price_change_percentage?.h24;

            // Generate content based on style
            let content = "";
            const link = BACK_TOKEN.purchaseLink;

            switch (style) {
                case "stats":
                    content = `🦍 $BACK Token Stats\n\n`;
                    if (holders !== "growing") content += `👥 Holders: ${holders}\n`;
                    if (price) content += `💰 Price: $${parseFloat(price).toFixed(8)}\n`;
                    if (priceChange24h) content += `📈 24h: ${parseFloat(priceChange24h) >= 0 ? '+' : ''}${parseFloat(priceChange24h).toFixed(2)}%\n`;
                    if (mcap) content += `📊 MCap: $${formatNumber(mcap)}\n`;
                    if (volume24h) content += `💹 24h Vol: $${formatNumber(volume24h)}\n`;
                    content += `\nJoin the pack on Virtuals:\n${link}`;
                    break;

                case "hype":
                    content = `🦍 The Silverback pack is growing!\n\n`;
                    content += `$BACK is building real DeFi infrastructure:\n`;
                    content += `✅ Live DEX on Base\n`;
                    content += `✅ AI-powered trading agent\n`;
                    content += `✅ Revenue sharing for holders\n\n`;
                    content += `Get in early on Virtuals:\n${link}`;
                    break;

                case "educational":
                    content = `🦍 Why $BACK?\n\n`;
                    content += `Silverback isn't just another token - it's:\n\n`;
                    content += `1️⃣ A real DEX generating fees\n`;
                    content += `2️⃣ An autonomous AI trading agent\n`;
                    content += `3️⃣ Revenue shared with holders\n\n`;
                    content += `Join the pack:\n${link}`;
                    break;

                case "milestone":
                    content = `🦍 Silverback Milestone!\n\n`;
                    if (holders !== "growing") content += `We've hit ${holders} holders!\n\n`;
                    content += `The pack is growing stronger every day.\n`;
                    content += `Help us bond on Virtuals:\n${link}`;
                    break;

                default:
                    content = `🦍 $BACK by Silverback DeFi\n\n`;
                    content += `Real infrastructure. Real trading. Real value.\n\n`;
                    content += `Join on Virtuals:\n${link}`;
            }

            const result = {
                content: content,
                style: style,
                link: link,
                characterCount: content.length,
                twitterReady: content.length <= 280,
                tokenData: {
                    holders: holders,
                    price: price,
                    priceChange24h: priceChange24h,
                    marketCap: mcap,
                    volume24h: volume24h,
                    dataSource: poolData ? "GeckoTerminal" : "Virtuals"
                },
                timestamp: new Date().toISOString()
            };

            logger(`✅ Generated promo content (${content.length} chars)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );

        } catch (e) {
            const error = e as Error;
            logger(`❌ Error generating promo: ${error.message}`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to generate promo: ${error.message}`
            );
        }
    }
});

// Helper function to format numbers
function formatNumber(num: number | string): string {
    const n = typeof num === 'string' ? parseFloat(num) : num;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
}

// Export all functions
export const virtualsFunctions = [
    getBackHoldersFunction,
    getBackTokenDataFunction,
    getBackRecentTradesFunction,
    generateBackPromoFunction
];

// Check if Virtuals integration is available (always true - public API)
export function isVirtualsAvailable(): boolean {
    return true;
}

console.log('🦍 Virtuals Protocol integration initialized');
console.log(`   $BACK Token: ${BACK_TOKEN.address}`);
console.log(`   Pool: ${BACK_TOKEN.poolAddress}`);
console.log(`   Purchase: ${BACK_TOKEN.purchaseLink}`);
console.log(`   GeckoTerminal: ${BACK_TOKEN.geckoTerminalLink}`);
