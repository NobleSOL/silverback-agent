/**
 * Market Data Functions for Data-Driven Tweets
 * Provides real market data so the agent can post with actual numbers and context
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

/**
 * Fetch current market overview from public APIs
 */
export const getMarketOverviewFunction = new GameFunction({
    name: "get_market_overview",
    description: `Get current crypto market data to use in tweets. ALWAYS call this BEFORE posting any market-related tweet. Returns BTC/ETH prices, 24h changes, and market trends. Use these REAL numbers in your tweets - never make up statistics.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching current market data from CoinGecko...");

            // Fetch BTC, ETH, and key metrics including 7-day change for better trend detection
            const response = await fetch(
                'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin,ethereum,usd-coin,tether&order=market_cap_desc&sparkline=false&price_change_percentage=24h,7d,30d'
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`);
            }

            const data = await response.json();

            // Parse response array into objects by id
            const btc = data.find((c: any) => c.id === 'bitcoin');
            const eth = data.find((c: any) => c.id === 'ethereum');
            const usdc = data.find((c: any) => c.id === 'usd-coin');
            const usdt = data.find((c: any) => c.id === 'tether');

            // Calculate stablecoin market cap (USDC + USDT)
            const stablecoinMarketCap = (usdc?.market_cap || 0) + (usdt?.market_cap || 0);

            // Determine market trend using 7-day and 30-day changes for better accuracy
            // A market is bullish when zoomed out if 7d change is positive, bearish otherwise
            const btc7dChange = btc?.price_change_percentage_7d_in_currency || 0;
            const btc30dChange = btc?.price_change_percentage_30d_in_currency || 0;
            const btc24hChange = btc?.price_change_percentage_24h_in_currency || 0;

            // Use weighted average: 50% weight on 7d, 30% on 30d, 20% on 24h
            const trendScore = (btc7dChange * 0.5) + (btc30dChange * 0.3) + (btc24hChange * 0.2);
            const marketTrend = trendScore > 2 ? 'bullish' : trendScore < -2 ? 'bearish' : 'neutral';

            const result = {
                bitcoin: {
                    price: btc?.current_price || 0,
                    change24h: btc?.price_change_percentage_24h_in_currency?.toFixed(2) || '0',
                    change7d: btc?.price_change_percentage_7d_in_currency?.toFixed(2) || '0',
                    change30d: btc?.price_change_percentage_30d_in_currency?.toFixed(2) || '0',
                    marketCap: formatLargeNumber(btc?.market_cap || 0),
                    volume24h: formatLargeNumber(btc?.total_volume || 0)
                },
                ethereum: {
                    price: eth?.current_price || 0,
                    change24h: eth?.price_change_percentage_24h_in_currency?.toFixed(2) || '0',
                    change7d: eth?.price_change_percentage_7d_in_currency?.toFixed(2) || '0',
                    change30d: eth?.price_change_percentage_30d_in_currency?.toFixed(2) || '0',
                    marketCap: formatLargeNumber(eth?.market_cap || 0),
                    volume24h: formatLargeNumber(eth?.total_volume || 0)
                },
                stablecoins: {
                    totalMarketCap: formatLargeNumber(stablecoinMarketCap),
                    usdcMarketCap: formatLargeNumber(usdc?.market_cap || 0),
                    usdtMarketCap: formatLargeNumber(usdt?.market_cap || 0)
                },
                marketTrend,
                trendDetails: {
                    btc24hChange: btc24hChange.toFixed(2),
                    btc7dChange: btc7dChange.toFixed(2),
                    btc30dChange: btc30dChange.toFixed(2),
                    trendScore: trendScore.toFixed(2),
                    note: "Trend based on weighted average: 50% 7d + 30% 30d + 20% 24h change"
                },
                timestamp: new Date().toISOString()
            };

            logger(`Market data: BTC $${result.bitcoin.price.toLocaleString()} (${result.bitcoin.change24h}%), ETH $${result.ethereum.price.toLocaleString()} (${result.ethereum.change24h}%)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch market data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get DeFi TVL and protocol metrics
 */
export const getDefiMetricsFunction = new GameFunction({
    name: "get_defi_metrics",
    description: `Get current DeFi ecosystem metrics (TVL, top protocols). Use this data when posting about DeFi trends. Always include actual numbers from this function.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching DeFi metrics from DefiLlama...");

            const response = await fetch('https://api.llama.fi/protocols');

            if (!response.ok) {
                throw new Error(`DefiLlama API error: ${response.status}`);
            }

            const protocols = await response.json();

            // Get total TVL from top protocols
            const totalTvl = protocols.slice(0, 100).reduce((sum: number, p: any) => sum + (p.tvl || 0), 0);

            // Get top 5 protocols by TVL
            const topProtocols = protocols
                .sort((a: any, b: any) => (b.tvl || 0) - (a.tvl || 0))
                .slice(0, 5)
                .map((p: any) => ({
                    name: p.name,
                    tvl: formatLargeNumber(p.tvl || 0),
                    category: p.category,
                    chain: p.chain
                }));

            // Get Base chain stats
            const baseProtocols = protocols.filter((p: any) =>
                p.chains?.includes('Base') || p.chain === 'Base'
            );
            const baseTvl = baseProtocols.reduce((sum: number, p: any) => sum + (p.tvl || 0), 0);

            const result = {
                totalTvl: formatLargeNumber(totalTvl),
                topProtocols,
                baseChain: {
                    protocolCount: baseProtocols.length,
                    tvl: formatLargeNumber(baseTvl)
                },
                timestamp: new Date().toISOString()
            };

            logger(`DeFi TVL: ${result.totalTvl}, Base TVL: ${result.baseChain.tvl}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch DeFi metrics: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Virtuals Protocol ecosystem data
 */
export const getVirtualsDataFunction = new GameFunction({
    name: "get_virtuals_ecosystem",
    description: `Get information about Virtuals Protocol ecosystem and VIRTUAL token. Use this when promoting Silverback's launch on Virtuals or discussing the AI agent ecosystem.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching Virtuals Protocol data...");

            // Fetch VIRTUAL token data from CoinGecko
            const response = await fetch(
                'https://api.coingecko.com/api/v3/coins/virtuals-protocol'
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`);
            }

            const data = await response.json();

            const result = {
                virtualToken: {
                    price: data.market_data?.current_price?.usd || 0,
                    change24h: data.market_data?.price_change_percentage_24h?.toFixed(2) || '0',
                    marketCap: formatLargeNumber(data.market_data?.market_cap?.usd || 0),
                    volume24h: formatLargeNumber(data.market_data?.total_volume?.usd || 0),
                    allTimeHigh: data.market_data?.ath?.usd || 0,
                    rank: data.market_cap_rank || 'N/A'
                },
                silverback: {
                    status: "Live on Virtuals Protocol",
                    network: "Base",
                    dexUrl: "https://silverbackdefi.app",
                    features: ["Non-inflationary tokenomics", "Revenue sharing via buybacks", "AI-powered trading agent"]
                },
                ecosystem: {
                    description: "Virtuals Protocol enables AI agents with tokenized ownership",
                    launchPlatform: "Unicorn Tokenomics model"
                },
                timestamp: new Date().toISOString()
            };

            logger(`VIRTUAL: $${result.virtualToken.price.toFixed(4)} (${result.virtualToken.change24h}%), MCap: ${result.virtualToken.marketCap}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch Virtuals data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get trending and top movers across crypto
 */
export const getTrendingCoinsFunction = new GameFunction({
    name: "get_trending_coins",
    description: `Get trending coins and top movers. Use this to find what's hot in the market for varied tweet content. Returns trending searches and top gainers/losers.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching trending coins...");

            // Fetch trending searches
            const trendingResponse = await fetch(
                'https://api.coingecko.com/api/v3/search/trending'
            );

            if (!trendingResponse.ok) {
                throw new Error(`CoinGecko trending API error: ${trendingResponse.status}`);
            }

            const trendingData = await trendingResponse.json();

            // Extract trending coins
            const trendingCoins = trendingData.coins?.slice(0, 7).map((item: any) => ({
                name: item.item?.name,
                symbol: item.item?.symbol?.toUpperCase(),
                rank: item.item?.market_cap_rank,
                priceChange24h: item.item?.data?.price_change_percentage_24h?.usd?.toFixed(2) || 'N/A'
            })) || [];

            const result = {
                trending: trendingCoins,
                categories: ["memecoins", "ai-tokens", "layer-2", "defi"],
                timestamp: new Date().toISOString(),
                tip: "Use these trending coins for varied tweet content"
            };

            logger(`Found ${trendingCoins.length} trending coins`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch trending coins: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get altcoin data for diverse content
 */
export const getAltcoinDataFunction = new GameFunction({
    name: "get_altcoin_data",
    description: `Get data on major altcoins (SOL, AVAX, MATIC, LINK, etc.) for varied tweet content. Use this to discuss assets beyond BTC/ETH.`,
    args: [
        {
            name: "category",
            description: "Category: 'l2' (Layer 2s), 'defi' (DeFi tokens), 'ai' (AI tokens), 'meme' (Memecoins), or 'all'"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const category = args.category?.toLowerCase() || 'all';
            logger(`Fetching ${category} altcoin data...`);

            // Token IDs by category
            const tokensByCategory: Record<string, string[]> = {
                l2: ['matic-network', 'arbitrum', 'optimism', 'immutable-x', 'metis-token'],
                defi: ['uniswap', 'aave', 'chainlink', 'maker', 'lido-dao', 'curve-dao-token'],
                ai: ['render-token', 'fetch-ai', 'singularitynet', 'akash-network', 'bittensor'],
                meme: ['dogecoin', 'shiba-inu', 'pepe', 'bonk', 'dogwifcoin', 'floki'],
                major: ['solana', 'cardano', 'avalanche-2', 'polkadot', 'near']
            };

            // Get tokens based on category
            let tokenIds: string[];
            if (category === 'all') {
                tokenIds = [...tokensByCategory.l2.slice(0, 2), ...tokensByCategory.defi.slice(0, 2), ...tokensByCategory.ai.slice(0, 2), ...tokensByCategory.meme.slice(0, 2)];
            } else {
                tokenIds = tokensByCategory[category] || tokensByCategory.major;
            }

            const response = await fetch(
                `https://api.coingecko.com/api/v3/simple/price?ids=${tokenIds.join(',')}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`
            );

            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`);
            }

            const data = await response.json();

            const tokens = Object.entries(data).map(([id, values]: [string, any]) => ({
                id,
                price: values.usd,
                change24h: values.usd_24h_change?.toFixed(2) || '0',
                marketCap: formatLargeNumber(values.usd_market_cap || 0)
            })).sort((a, b) => parseFloat(b.change24h) - parseFloat(a.change24h));

            const result = {
                category,
                tokens,
                topGainer: tokens[0],
                topLoser: tokens[tokens.length - 1],
                timestamp: new Date().toISOString()
            };

            logger(`Fetched ${tokens.length} ${category} tokens`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch altcoin data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Fear & Greed Index for market sentiment
 */
export const getFearGreedIndexFunction = new GameFunction({
    name: "get_fear_greed_index",
    description: `Get the Crypto Fear & Greed Index for market sentiment analysis. Use this to add sentiment context to your market tweets.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger("Fetching Fear & Greed Index...");

            const response = await fetch('https://api.alternative.me/fng/?limit=7');

            if (!response.ok) {
                throw new Error(`Fear & Greed API error: ${response.status}`);
            }

            const data = await response.json();
            const current = data.data?.[0];
            const weekAgo = data.data?.[6];

            const result = {
                current: {
                    value: parseInt(current?.value || '50'),
                    classification: current?.value_classification || 'Neutral',
                    timestamp: current?.timestamp
                },
                weekAgo: {
                    value: parseInt(weekAgo?.value || '50'),
                    classification: weekAgo?.value_classification || 'Neutral'
                },
                trend: parseInt(current?.value || '50') > parseInt(weekAgo?.value || '50') ? 'improving' : 'declining',
                interpretation: getInterpretation(parseInt(current?.value || '50'))
            };

            logger(`Fear & Greed: ${result.current.value} (${result.current.classification})`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch Fear & Greed Index: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Helper function to interpret Fear & Greed value
 */
function getInterpretation(value: number): string {
    if (value <= 25) return "Extreme fear - historically good buying opportunity";
    if (value <= 45) return "Fear - market cautious, potential opportunity";
    if (value <= 55) return "Neutral - market undecided";
    if (value <= 75) return "Greed - market optimistic, watch for overextension";
    return "Extreme greed - historically time for caution";
}

/**
 * Helper function to format large numbers
 */
function formatLargeNumber(num: number): string {
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`;
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
    return `$${num.toFixed(2)}`;
}
