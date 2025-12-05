/**
 * Scheduling and News Functions
 * Provides time awareness and news/sentiment data for the agent
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

/**
 * Get current time context and suggested task
 */
export const getTimeContextFunction = new GameFunction({
    name: "get_time_context",
    description: "Get current UTC time, day of week, and suggested task based on schedule. Call this at start of each session to know what you should focus on.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const now = new Date();
            const utcHour = now.getUTCHours();
            const utcMinutes = now.getUTCMinutes();
            const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
            const isWeekend = dayOfWeek === 'Saturday' || dayOfWeek === 'Sunday';

            // Determine time slot and suggested task
            let timeSlot: string;
            let suggestedTask: string;
            let priority: string;

            if (utcHour >= 8 && utcHour < 10) {
                timeSlot = 'morning';
                suggestedTask = 'Morning market overview - share key market data, fear/greed index, notable overnight moves';
                priority = 'market_data';
            } else if (utcHour >= 10 && utcHour < 14) {
                timeSlot = 'late_morning';
                suggestedTask = 'Check mentions and engage with community. Reply to questions before posting new content.';
                priority = 'engagement';
            } else if (utcHour >= 14 && utcHour < 16) {
                timeSlot = 'afternoon';
                suggestedTask = 'Share on-chain insights, alpha observations, or ecosystem updates';
                priority = 'insights';
            } else if (utcHour >= 16 && utcHour < 20) {
                timeSlot = 'late_afternoon';
                suggestedTask = 'Community engagement - reply to mentions, join discussions';
                priority = 'engagement';
            } else if (utcHour >= 20 && utcHour < 22) {
                timeSlot = 'evening';
                suggestedTask = 'Share building updates, product news, or educational content';
                priority = 'product';
            } else {
                timeSlot = 'off_hours';
                suggestedTask = 'Light engagement only - reply to urgent mentions if any. Avoid posting new content.';
                priority = 'minimal';
            }

            // Weekend adjustment
            if (isWeekend) {
                suggestedTask = `WEEKEND: Lower activity. ${suggestedTask}`;
                priority = 'weekend_' + priority;
            }

            const context = {
                current_time_utc: `${utcHour.toString().padStart(2, '0')}:${utcMinutes.toString().padStart(2, '0')} UTC`,
                day_of_week: dayOfWeek,
                is_weekend: isWeekend,
                time_slot: timeSlot,
                suggested_task: suggestedTask,
                priority: priority,
                posting_allowed: timeSlot !== 'off_hours',
                schedule_reference: {
                    morning: '8-10am UTC - Market data post',
                    afternoon: '2-4pm UTC - On-chain insights',
                    evening: '8-10pm UTC - Product/community update'
                }
            };

            logger(`Time: ${context.current_time_utc} (${dayOfWeek}) - ${timeSlot}`);
            logger(`Suggested: ${suggestedTask}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(context)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get time context: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Fetch crypto news from multiple sources
 */
export const getCryptoNewsFunction = new GameFunction({
    name: "get_crypto_news",
    description: "Get latest crypto news and headlines. Use this to stay informed about market events, regulatory news, and ecosystem developments.",
    args: [
        {
            name: "filter",
            description: "Filter by: 'all', 'rising' (trending), 'hot', 'bullish', 'bearish', 'important', 'lol'. Default: 'important'"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const filter = args.filter || 'important';

            // CryptoPanic API (free tier - no auth needed for public posts)
            const cryptoPanicUrl = `https://cryptopanic.com/api/v1/posts/?auth_token=&filter=${filter}&public=true`;

            logger(`Fetching crypto news (filter: ${filter})...`);

            // Try CryptoPanic
            let news: any[] = [];
            try {
                const response = await fetch(`https://cryptopanic.com/api/free/v1/posts/?filter=${filter}`);
                if (response.ok) {
                    const data = await response.json();
                    news = (data.results || []).slice(0, 10).map((item: any) => ({
                        title: item.title,
                        source: item.source?.title || 'Unknown',
                        published: item.published_at,
                        url: item.url,
                        sentiment: item.votes?.positive > item.votes?.negative ? 'bullish' :
                                  item.votes?.negative > item.votes?.positive ? 'bearish' : 'neutral',
                        currencies: item.currencies?.map((c: any) => c.code) || []
                    }));
                }
            } catch (e) {
                logger('CryptoPanic unavailable, trying alternative...');
            }

            // Fallback: Use CoinGecko's status updates
            if (news.length === 0) {
                try {
                    const cgResponse = await fetch('https://api.coingecko.com/api/v3/status_updates?per_page=10');
                    if (cgResponse.ok) {
                        const cgData = await cgResponse.json();
                        news = (cgData.status_updates || []).map((item: any) => ({
                            title: item.description?.substring(0, 100) + '...',
                            source: item.project?.name || 'CoinGecko',
                            published: item.created_at,
                            category: item.category,
                            sentiment: 'neutral'
                        }));
                    }
                } catch (e) {
                    logger('CoinGecko status updates unavailable');
                }
            }

            if (news.length === 0) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({
                        success: true,
                        count: 0,
                        message: 'No news available right now. Try posting about market data instead.',
                        news: []
                    })
                );
            }

            logger(`Found ${news.length} news items`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    count: news.length,
                    filter: filter,
                    news: news
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch news: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get DeFi Llama protocol data for deeper insights
 */
export const getDefiLlamaDataFunction = new GameFunction({
    name: "get_defillama_data",
    description: "Get DeFi protocol TVL data from DeFi Llama. Use for accurate TVL numbers and protocol rankings.",
    args: [
        {
            name: "type",
            description: "Data type: 'chains' (L1/L2 TVL), 'protocols' (top protocols), 'yields' (best yields). Default: 'chains'"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const dataType = args.type || 'chains';
            let url: string;
            let data: any;

            switch (dataType) {
                case 'chains':
                    url = 'https://api.llama.fi/v2/chains';
                    break;
                case 'protocols':
                    url = 'https://api.llama.fi/protocols';
                    break;
                case 'yields':
                    url = 'https://yields.llama.fi/pools';
                    break;
                default:
                    url = 'https://api.llama.fi/v2/chains';
            }

            logger(`Fetching DeFi Llama data (${dataType})...`);
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`DeFi Llama API error: ${response.status}`);
            }

            const rawData = await response.json();

            // Format based on type
            if (dataType === 'chains') {
                data = rawData.slice(0, 15).map((chain: any) => ({
                    name: chain.name,
                    tvl: `$${(chain.tvl / 1e9).toFixed(2)}B`,
                    tvl_raw: chain.tvl,
                    change_1d: chain.change_1d ? `${chain.change_1d.toFixed(2)}%` : 'N/A',
                    change_7d: chain.change_7d ? `${chain.change_7d.toFixed(2)}%` : 'N/A'
                }));
            } else if (dataType === 'protocols') {
                data = rawData.slice(0, 15).map((protocol: any) => ({
                    name: protocol.name,
                    tvl: `$${(protocol.tvl / 1e9).toFixed(2)}B`,
                    chain: protocol.chain,
                    category: protocol.category,
                    change_1d: protocol.change_1d ? `${protocol.change_1d.toFixed(2)}%` : 'N/A'
                }));
            } else if (dataType === 'yields') {
                // Filter for good yields on major chains
                const filtered = rawData.data
                    .filter((pool: any) =>
                        pool.tvlUsd > 1000000 &&
                        pool.apy > 1 &&
                        pool.apy < 100 &&
                        ['Ethereum', 'Base', 'Arbitrum', 'Optimism'].includes(pool.chain)
                    )
                    .sort((a: any, b: any) => b.apy - a.apy)
                    .slice(0, 15);

                data = filtered.map((pool: any) => ({
                    project: pool.project,
                    symbol: pool.symbol,
                    chain: pool.chain,
                    apy: `${pool.apy.toFixed(2)}%`,
                    tvl: `$${(pool.tvlUsd / 1e6).toFixed(1)}M`
                }));
            }

            logger(`Found ${data.length} ${dataType} entries`);
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    type: dataType,
                    count: data.length,
                    data: data
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch DeFi Llama data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get L2Beat data for Layer 2 insights
 */
export const getL2DataFunction = new GameFunction({
    name: "get_l2_data",
    description: "Get Layer 2 TVL and activity data. Great for Base ecosystem insights and L2 comparisons.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            logger('Fetching L2 data...');

            // Use DeFi Llama's chain data filtered for L2s
            const response = await fetch('https://api.llama.fi/v2/chains');
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const chains = await response.json();

            // Filter for known L2s
            const l2Names = ['Arbitrum', 'Optimism', 'Base', 'zkSync Era', 'Linea', 'Scroll', 'Polygon zkEVM', 'Manta', 'Blast', 'Mode'];
            const l2Data = chains
                .filter((chain: any) => l2Names.some(name => chain.name.toLowerCase().includes(name.toLowerCase())))
                .map((chain: any) => ({
                    name: chain.name,
                    tvl: `$${(chain.tvl / 1e9).toFixed(2)}B`,
                    tvl_raw: chain.tvl,
                    change_1d: chain.change_1d ? `${chain.change_1d > 0 ? '+' : ''}${chain.change_1d.toFixed(2)}%` : 'N/A',
                    change_7d: chain.change_7d ? `${chain.change_7d > 0 ? '+' : ''}${chain.change_7d.toFixed(2)}%` : 'N/A'
                }))
                .sort((a: any, b: any) => b.tvl_raw - a.tvl_raw);

            // Calculate totals and find Base specifically
            const totalL2Tvl = l2Data.reduce((sum: number, l2: any) => sum + l2.tvl_raw, 0);
            const baseData = l2Data.find((l2: any) => l2.name === 'Base');

            logger(`Found ${l2Data.length} L2s with total TVL $${(totalL2Tvl / 1e9).toFixed(2)}B`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    total_l2_tvl: `$${(totalL2Tvl / 1e9).toFixed(2)}B`,
                    base_tvl: baseData?.tvl || 'N/A',
                    base_rank: l2Data.findIndex((l2: any) => l2.name === 'Base') + 1,
                    l2_rankings: l2Data,
                    insight: baseData ?
                        `Base is #${l2Data.findIndex((l2: any) => l2.name === 'Base') + 1} L2 with ${baseData.tvl} TVL (${baseData.change_7d} 7d)` :
                        'Base data not available'
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch L2 data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get biggest price movers - tokens with significant price swings
 */
export const getPriceMoversFunction = new GameFunction({
    name: "get_price_movers",
    description: "Get tokens with biggest price movements in last 24h. Great for finding trading opportunities and market narratives. Returns top gainers and losers.",
    args: [
        {
            name: "category",
            description: "Filter by: 'all', 'defi', 'layer-1', 'layer-2', 'meme-token', 'ai-big-data'. Default: 'all'"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            const category = args.category || 'all';
            logger(`Fetching price movers (category: ${category})...`);

            // Use CoinGecko's markets endpoint sorted by price change
            let url = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=price_change_percentage_24h_desc&per_page=100&sparkline=false&price_change_percentage=1h,24h,7d';

            if (category !== 'all') {
                url += `&category=${category}`;
            }

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`CoinGecko API error: ${response.status}`);
            }

            const coins = await response.json();

            // Get top gainers (positive change)
            const gainers = coins
                .filter((c: any) => c.price_change_percentage_24h > 0)
                .slice(0, 10)
                .map((c: any) => ({
                    symbol: c.symbol.toUpperCase(),
                    name: c.name,
                    price: `$${c.current_price < 0.01 ? c.current_price.toFixed(6) : c.current_price.toFixed(2)}`,
                    change_1h: c.price_change_percentage_1h_in_currency ? `${c.price_change_percentage_1h_in_currency > 0 ? '+' : ''}${c.price_change_percentage_1h_in_currency.toFixed(1)}%` : 'N/A',
                    change_24h: `+${c.price_change_percentage_24h.toFixed(1)}%`,
                    change_7d: c.price_change_percentage_7d_in_currency ? `${c.price_change_percentage_7d_in_currency > 0 ? '+' : ''}${c.price_change_percentage_7d_in_currency.toFixed(1)}%` : 'N/A',
                    volume_24h: `$${(c.total_volume / 1e6).toFixed(1)}M`,
                    market_cap: `$${(c.market_cap / 1e9).toFixed(2)}B`
                }));

            // Get top losers (negative change)
            const losers = coins
                .filter((c: any) => c.price_change_percentage_24h < 0)
                .sort((a: any, b: any) => a.price_change_percentage_24h - b.price_change_percentage_24h)
                .slice(0, 10)
                .map((c: any) => ({
                    symbol: c.symbol.toUpperCase(),
                    name: c.name,
                    price: `$${c.current_price < 0.01 ? c.current_price.toFixed(6) : c.current_price.toFixed(2)}`,
                    change_1h: c.price_change_percentage_1h_in_currency ? `${c.price_change_percentage_1h_in_currency > 0 ? '+' : ''}${c.price_change_percentage_1h_in_currency.toFixed(1)}%` : 'N/A',
                    change_24h: `${c.price_change_percentage_24h.toFixed(1)}%`,
                    change_7d: c.price_change_percentage_7d_in_currency ? `${c.price_change_percentage_7d_in_currency > 0 ? '+' : ''}${c.price_change_percentage_7d_in_currency.toFixed(1)}%` : 'N/A',
                    volume_24h: `$${(c.total_volume / 1e6).toFixed(1)}M`,
                    market_cap: `$${(c.market_cap / 1e9).toFixed(2)}B`
                }));

            // Find notable swings (big moves in either direction)
            const bigSwings = coins
                .filter((c: any) => Math.abs(c.price_change_percentage_24h) > 10)
                .slice(0, 5)
                .map((c: any) => ({
                    symbol: c.symbol.toUpperCase(),
                    change_24h: `${c.price_change_percentage_24h > 0 ? '+' : ''}${c.price_change_percentage_24h.toFixed(1)}%`,
                    direction: c.price_change_percentage_24h > 0 ? 'PUMP' : 'DUMP'
                }));

            logger(`Found ${gainers.length} gainers, ${losers.length} losers, ${bigSwings.length} big swings`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    category: category,
                    summary: {
                        top_gainer: gainers[0] ? `${gainers[0].symbol} ${gainers[0].change_24h}` : 'N/A',
                        top_loser: losers[0] ? `${losers[0].symbol} ${losers[0].change_24h}` : 'N/A',
                        big_swings: bigSwings.length
                    },
                    gainers: gainers,
                    losers: losers,
                    big_swings: bigSwings,
                    insight: bigSwings.length > 0 ?
                        `Notable swings: ${bigSwings.map((s: any) => `${s.symbol} ${s.change_24h}`).join(', ')}` :
                        'No major swings (>10%) in the last 24h'
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch price movers: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get specific token price and recent performance
 */
export const getTokenPriceFunction = new GameFunction({
    name: "get_token_price",
    description: "Get current price and recent performance for a specific token. Use this to check specific coins mentioned in news or community discussions.",
    args: [
        {
            name: "token_id",
            description: "CoinGecko token ID (e.g., 'bitcoin', 'ethereum', 'solana', 'pepe', 'bonk')"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.token_id) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Token ID is required (e.g., 'bitcoin', 'ethereum', 'solana')"
                );
            }

            const tokenId = args.token_id.toLowerCase();
            logger(`Fetching price for ${tokenId}...`);

            const response = await fetch(
                `https://api.coingecko.com/api/v3/coins/${tokenId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=false`
            );

            if (!response.ok) {
                if (response.status === 404) {
                    return new ExecutableGameFunctionResponse(
                        ExecutableGameFunctionStatus.Failed,
                        `Token '${tokenId}' not found. Try the full CoinGecko ID (e.g., 'bitcoin', 'ethereum', 'solana').`
                    );
                }
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const price = data.market_data.current_price.usd;
            const change1h = data.market_data.price_change_percentage_1h_in_currency?.usd;
            const change24h = data.market_data.price_change_percentage_24h;
            const change7d = data.market_data.price_change_percentage_7d;
            const change30d = data.market_data.price_change_percentage_30d;
            const ath = data.market_data.ath.usd;
            const athChange = data.market_data.ath_change_percentage.usd;

            logger(`${data.symbol.toUpperCase()}: $${price} (${change24h > 0 ? '+' : ''}${change24h?.toFixed(1)}% 24h)`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    token: {
                        id: data.id,
                        symbol: data.symbol.toUpperCase(),
                        name: data.name,
                        price: `$${price < 0.01 ? price.toFixed(8) : price.toFixed(2)}`,
                        price_raw: price,
                        change_1h: change1h ? `${change1h > 0 ? '+' : ''}${change1h.toFixed(1)}%` : 'N/A',
                        change_24h: `${change24h > 0 ? '+' : ''}${change24h?.toFixed(1)}%`,
                        change_7d: `${change7d > 0 ? '+' : ''}${change7d?.toFixed(1)}%`,
                        change_30d: `${change30d > 0 ? '+' : ''}${change30d?.toFixed(1)}%`,
                        ath: `$${ath < 0.01 ? ath.toFixed(8) : ath.toFixed(2)}`,
                        ath_change: `${athChange?.toFixed(1)}%`,
                        market_cap: `$${(data.market_data.market_cap.usd / 1e9).toFixed(2)}B`,
                        volume_24h: `$${(data.market_data.total_volume.usd / 1e6).toFixed(1)}M`,
                        market_cap_rank: data.market_cap_rank
                    },
                    insight: Math.abs(change24h) > 5 ?
                        `${data.symbol.toUpperCase()} ${change24h > 0 ? 'pumping' : 'dumping'} ${Math.abs(change24h).toFixed(1)}% in 24h` :
                        `${data.symbol.toUpperCase()} relatively flat (${change24h > 0 ? '+' : ''}${change24h?.toFixed(1)}% 24h)`
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch token price: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
