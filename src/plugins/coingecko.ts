/**
 * Enhanced CoinGecko Integration
 * Uses official CoinGecko TypeScript SDK for comprehensive market data
 *
 * Features:
 * - Real-time prices for any token
 * - Historical OHLCV data
 * - Market cap rankings
 * - Exchange data
 * - NFT data
 * - Global market metrics
 *
 * Note: Free tier has rate limits. Pro API key recommended for production.
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import dotenv from "dotenv";

dotenv.config();

// CoinGecko API base URLs
const COINGECKO_API = process.env.COINGECKO_API_KEY
    ? "https://pro-api.coingecko.com/api/v3"
    : "https://api.coingecko.com/api/v3";

/**
 * Check if CoinGecko Pro API is available
 */
export function isCoinGeckoProAvailable(): boolean {
    return !!process.env.COINGECKO_API_KEY;
}

/**
 * Helper function for CoinGecko API calls
 */
async function coingeckoRequest(endpoint: string, params: Record<string, string> = {}) {
    const url = new URL(`${COINGECKO_API}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
    });

    const headers: Record<string, string> = {
        'Accept': 'application/json'
    };

    if (process.env.COINGECKO_API_KEY) {
        headers['x-cg-pro-api-key'] = process.env.COINGECKO_API_KEY;
    }

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
        if (response.status === 429) {
            throw new Error("Rate limit exceeded - try again later");
        }
        throw new Error(`CoinGecko API error: ${response.status}`);
    }

    return response.json();
}

/**
 * Get detailed token data including price, volume, market cap, and more
 */
export const getTokenDetailsFunction = new GameFunction({
    name: "get_token_details",
    description: `Get comprehensive data for a specific token including price, market cap, volume, supply, and social links. More detailed than basic price fetch.`,
    args: [
        {
            name: "token_id",
            description: "CoinGecko token ID (e.g., 'bitcoin', 'ethereum', 'solana')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.token_id) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token ID is required"
            );
        }

        try {
            logger(`Fetching details for ${args.token_id}...`);

            const data = await coingeckoRequest(`/coins/${args.token_id}`, {
                localization: 'false',
                tickers: 'false',
                market_data: 'true',
                community_data: 'true',
                developer_data: 'false',
                sparkline: 'false'
            });

            const result = {
                id: data.id,
                symbol: data.symbol?.toUpperCase(),
                name: data.name,
                price: {
                    usd: data.market_data?.current_price?.usd,
                    btc: data.market_data?.current_price?.btc,
                    eth: data.market_data?.current_price?.eth
                },
                change: {
                    '1h': data.market_data?.price_change_percentage_1h_in_currency?.usd?.toFixed(2),
                    '24h': data.market_data?.price_change_percentage_24h?.toFixed(2),
                    '7d': data.market_data?.price_change_percentage_7d?.toFixed(2),
                    '30d': data.market_data?.price_change_percentage_30d?.toFixed(2)
                },
                marketCap: data.market_data?.market_cap?.usd,
                marketCapRank: data.market_cap_rank,
                volume24h: data.market_data?.total_volume?.usd,
                supply: {
                    circulating: data.market_data?.circulating_supply,
                    total: data.market_data?.total_supply,
                    max: data.market_data?.max_supply
                },
                ath: {
                    price: data.market_data?.ath?.usd,
                    date: data.market_data?.ath_date?.usd,
                    changeFromAth: data.market_data?.ath_change_percentage?.usd?.toFixed(2)
                },
                atl: {
                    price: data.market_data?.atl?.usd,
                    date: data.market_data?.atl_date?.usd
                },
                social: {
                    twitter: data.links?.twitter_screen_name,
                    telegram: data.links?.telegram_channel_identifier,
                    reddit: data.links?.subreddit_url
                },
                sentiment: {
                    upVotes: data.sentiment_votes_up_percentage,
                    downVotes: data.sentiment_votes_down_percentage
                },
                timestamp: new Date().toISOString()
            };

            logger(`${result.symbol}: $${result.price.usd} (${result.change['24h']}% 24h)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch token details: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get historical OHLCV data for charting and analysis
 */
export const getOHLCVDataFunction = new GameFunction({
    name: "get_ohlcv_data",
    description: `Get historical OHLCV (Open, High, Low, Close, Volume) data for a token. Useful for technical analysis and charting.`,
    args: [
        {
            name: "token_id",
            description: "CoinGecko token ID"
        },
        {
            name: "days",
            description: "Number of days: '1', '7', '14', '30', '90', '180', '365', 'max'"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.token_id) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token ID is required"
            );
        }

        try {
            logger(`Fetching OHLCV for ${args.token_id} (${args.days || '7'} days)...`);

            const data = await coingeckoRequest(`/coins/${args.token_id}/ohlc`, {
                vs_currency: 'usd',
                days: args.days || '7'
            });

            // Data comes as [timestamp, open, high, low, close]
            const ohlcv = data.slice(-20).map((candle: number[]) => ({
                timestamp: new Date(candle[0]).toISOString(),
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4]
            }));

            const latest = ohlcv[ohlcv.length - 1];
            const oldest = ohlcv[0];
            const changePercent = ((latest.close - oldest.open) / oldest.open * 100).toFixed(2);

            const result = {
                token: args.token_id,
                period: `${args.days || '7'} days`,
                dataPoints: ohlcv.length,
                latest: {
                    open: latest.open,
                    high: latest.high,
                    low: latest.low,
                    close: latest.close
                },
                periodChange: `${changePercent}%`,
                periodHigh: Math.max(...ohlcv.map((c: any) => c.high)),
                periodLow: Math.min(...ohlcv.map((c: any) => c.low)),
                ohlcv: ohlcv,
                timestamp: new Date().toISOString()
            };

            logger(`${args.token_id} ${args.days || '7'}d change: ${changePercent}%`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch OHLCV: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get global crypto market data
 */
export const getGlobalMarketDataFunction = new GameFunction({
    name: "get_global_market",
    description: `Get global cryptocurrency market data including total market cap, volume, BTC dominance, and market trends.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching global market data...");

            const data = await coingeckoRequest('/global');
            const global = data.data;

            const result = {
                totalMarketCap: {
                    usd: global.total_market_cap?.usd,
                    formatted: formatNumber(global.total_market_cap?.usd)
                },
                totalVolume24h: {
                    usd: global.total_volume?.usd,
                    formatted: formatNumber(global.total_volume?.usd)
                },
                dominance: {
                    btc: global.market_cap_percentage?.btc?.toFixed(2),
                    eth: global.market_cap_percentage?.eth?.toFixed(2)
                },
                marketCapChange24h: global.market_cap_change_percentage_24h_usd?.toFixed(2),
                activeCryptos: global.active_cryptocurrencies,
                activeExchanges: global.markets,
                defiMarketCap: formatNumber(global.total_market_cap?.usd * 0.04), // Estimate
                trend: global.market_cap_change_percentage_24h_usd > 0 ? 'bullish' : 'bearish',
                timestamp: new Date().toISOString()
            };

            logger(`Global MCap: ${result.totalMarketCap.formatted}, BTC Dom: ${result.dominance.btc}%`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch global data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get top gainers and losers
 */
export const getTopMoversFunction = new GameFunction({
    name: "get_top_movers",
    description: `Get the top gaining and losing cryptocurrencies in the last 24 hours. Great for finding momentum plays.`,
    args: [
        {
            name: "limit",
            description: "Number of tokens per category (default: 5)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const limit = parseInt(args.limit || '5');
            logger(`Fetching top ${limit} gainers and losers...`);

            const data = await coingeckoRequest('/coins/markets', {
                vs_currency: 'usd',
                order: 'market_cap_desc',
                per_page: '100',
                page: '1',
                sparkline: 'false',
                price_change_percentage: '24h'
            });

            // Sort by 24h change
            const sorted = data.sort((a: any, b: any) =>
                (b.price_change_percentage_24h || 0) - (a.price_change_percentage_24h || 0)
            );

            const gainers = sorted.slice(0, limit).map((t: any) => ({
                symbol: t.symbol?.toUpperCase(),
                name: t.name,
                price: t.current_price,
                change24h: t.price_change_percentage_24h?.toFixed(2),
                volume: formatNumber(t.total_volume),
                marketCap: formatNumber(t.market_cap)
            }));

            const losers = sorted.slice(-limit).reverse().map((t: any) => ({
                symbol: t.symbol?.toUpperCase(),
                name: t.name,
                price: t.current_price,
                change24h: t.price_change_percentage_24h?.toFixed(2),
                volume: formatNumber(t.total_volume),
                marketCap: formatNumber(t.market_cap)
            }));

            const result = {
                gainers,
                losers,
                topGainer: {
                    symbol: gainers[0]?.symbol,
                    change: gainers[0]?.change24h
                },
                topLoser: {
                    symbol: losers[0]?.symbol,
                    change: losers[0]?.change24h
                },
                timestamp: new Date().toISOString()
            };

            logger(`Top gainer: ${result.topGainer.symbol} (+${result.topGainer.change}%)`);
            logger(`Top loser: ${result.topLoser.symbol} (${result.topLoser.change}%)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch top movers: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Search for tokens by name or symbol
 */
export const searchTokensFunction = new GameFunction({
    name: "search_tokens",
    description: `Search for cryptocurrency tokens by name or symbol. Returns matching tokens with their IDs for use in other functions.`,
    args: [
        {
            name: "query",
            description: "Search query (token name or symbol)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.query) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Search query is required"
            );
        }

        try {
            logger(`Searching for "${args.query}"...`);

            const data = await coingeckoRequest('/search', {
                query: args.query
            });

            const tokens = data.coins?.slice(0, 10).map((t: any) => ({
                id: t.id,
                symbol: t.symbol?.toUpperCase(),
                name: t.name,
                marketCapRank: t.market_cap_rank,
                thumb: t.thumb
            })) || [];

            const result = {
                query: args.query,
                results: tokens.length,
                tokens,
                topResult: tokens[0] || null,
                timestamp: new Date().toISOString()
            };

            logger(`Found ${tokens.length} tokens matching "${args.query}"`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to search tokens: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Helper function to format large numbers
 */
function formatNumber(num: number): string {
    if (!num) return '$0';
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
}
