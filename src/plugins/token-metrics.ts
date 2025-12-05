/**
 * TokenMetrics API Integration (Official SDK)
 * Provides AI-powered trading signals, grades, and analytics
 *
 * Features (from their 70% win rate signals):
 * - AI Trading Signals (long/short with confidence)
 * - Trader & Investor Grades
 * - Technical Analysis Grades
 * - Price Predictions
 * - Resistance/Support Levels
 * - Market Sentiment
 * - OHLCV Historical Data
 *
 * SDK Docs: https://github.com/token-metrics/tmai-api
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import dotenv from "dotenv";

dotenv.config();

// Import the official SDK
let TokenMetricsClient: any;
let client: any;

try {
    const tmaiApi = require('tmai-api');
    TokenMetricsClient = tmaiApi.TokenMetricsClient;
    if (process.env.TOKEN_METRICS_API_KEY) {
        client = new TokenMetricsClient(process.env.TOKEN_METRICS_API_KEY);
        console.log('📊 Token Metrics SDK initialized');
    }
} catch (e) {
    console.log('📊 Token Metrics SDK not available, using fallback');
}

// ============ RATE LIMITING & CACHING ============
// FREE TIER: 500 API calls/month (~16/day) - must be strategic

interface CacheEntry {
    data: any;
    timestamp: number;
}

const cache: Map<string, CacheEntry> = new Map();
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 hours - aggressive caching

// Track API calls
let apiCallsToday = 0;
let lastResetDate = new Date().toDateString();
const DAILY_LIMIT = 16; // ~500/month ÷ 30 days

function checkAndResetDailyCounter(): void {
    const today = new Date().toDateString();
    if (today !== lastResetDate) {
        console.log(`📊 Token Metrics: Resetting daily counter (yesterday: ${apiCallsToday} calls)`);
        apiCallsToday = 0;
        lastResetDate = today;
    }
}

function canMakeApiCall(): boolean {
    checkAndResetDailyCounter();
    return apiCallsToday < DAILY_LIMIT;
}

function getCached(key: string): any | null {
    const entry = cache.get(key);
    if (entry && Date.now() - entry.timestamp < CACHE_DURATION) {
        console.log(`📦 Token Metrics cache hit: ${key}`);
        return entry.data;
    }
    return null;
}

function setCache(key: string, data: any): void {
    cache.set(key, { data, timestamp: Date.now() });
}

function trackApiCall(endpoint: string): void {
    apiCallsToday++;
    console.log(`📊 Token Metrics API call #${apiCallsToday}/${DAILY_LIMIT} today: ${endpoint}`);
}

/**
 * Get current API usage stats
 */
export function getApiUsageStats(): { callsToday: number; remaining: number; dailyLimit: number } {
    checkAndResetDailyCounter();
    return {
        callsToday: apiCallsToday,
        remaining: DAILY_LIMIT - apiCallsToday,
        dailyLimit: DAILY_LIMIT
    };
}

/**
 * Check if TokenMetrics API is available
 */
export function isTokenMetricsAvailable(): boolean {
    return !!process.env.TOKEN_METRICS_API_KEY && !!client;
}

/**
 * Get AI Trading Signals - the core 70% win rate signals
 */
export const getAITradingSignalsFunction = new GameFunction({
    name: "get_ai_trading_signals",
    description: `Get Token Metrics AI trading signals with ~70% historical win rate. Returns LONG/SHORT recommendations with confidence levels. Use this BEFORE making trading decisions.

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours. Use strategically!`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH', 'SOL'). Leave empty for top signals across all tokens."
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            logger("TokenMetrics API not configured - using fallback");
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "fallback",
                    note: "Configure TOKEN_METRICS_API_KEY for AI signals with 70% win rate",
                    signals: []
                })
            );
        }

        const cacheKey = `signals:${args.symbol || 'all'}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "cache", ...cached })
            );
        }

        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached (${DAILY_LIMIT} calls). Try again tomorrow.`
            );
        }

        try {
            logger(`Fetching AI trading signals${args.symbol ? ` for ${args.symbol}` : ''}...`);

            const params: any = { limit: 20 };
            if (args.symbol) params.symbol = args.symbol.toUpperCase();

            const data = await client.tradingSignals.get(params);
            trackApiCall('tradingSignals');

            const signals = (data || []).slice(0, 15).map((s: any) => ({
                symbol: s.TOKEN_SYMBOL || s.symbol,
                signal: s.SIGNAL || s.signal, // LONG or SHORT
                confidence: s.SIGNAL_STRENGTH || s.confidence,
                grade: s.TM_TRADER_GRADE || s.grade,
                price: s.PRICE || s.price,
                date: s.DATE || s.date
            }));

            const result = {
                signals,
                bullish: signals.filter((s: any) => s.signal === 'LONG' || s.signal === 'BUY').length,
                bearish: signals.filter((s: any) => s.signal === 'SHORT' || s.signal === 'SELL').length,
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`Found ${result.bullish} bullish, ${result.bearish} bearish signals`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_ai", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch signals: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Trader Grades - AI grades optimized for short-term trading
 */
export const getTokenGradesFunction = new GameFunction({
    name: "get_token_grades",
    description: `Get Token Metrics AI grades for a token. Includes:
    - Trader Grade (short-term trading potential)
    - Investor Grade (long-term holding potential)
    - Technology Grade (tech fundamentals)

    Grades from 0-100. Higher = better opportunity.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH', 'SOL')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        if (!isTokenMetricsAvailable()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    symbol: args.symbol,
                    note: "Configure TOKEN_METRICS_API_KEY for AI grades"
                })
            );
        }

        const cacheKey = `grades:${args.symbol.toUpperCase()}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "cache", ...cached })
            );
        }

        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached. Try again tomorrow.`
            );
        }

        try {
            logger(`Fetching grades for ${args.symbol}...`);

            const data = await client.traderGrades.get({ symbol: args.symbol.toUpperCase() });
            trackApiCall('traderGrades');

            const token = data?.[0];
            if (!token) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No grade data found" })
                );
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                traderGrade: token.TM_TRADER_GRADE || token.traderGrade,
                investorGrade: token.TM_INVESTOR_GRADE || token.investorGrade,
                technologyGrade: token.TECHNOLOGY_GRADE || token.technologyGrade,
                price: token.PRICE || token.price,
                recommendation: (token.TM_TRADER_GRADE || 0) >= 70 ? 'STRONG_BUY' :
                    (token.TM_TRADER_GRADE || 0) >= 50 ? 'BUY' :
                    (token.TM_TRADER_GRADE || 0) >= 30 ? 'HOLD' : 'AVOID',
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: Trader Grade ${result.traderGrade}, Rec: ${result.recommendation}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_ai", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch grades: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Resistance & Support Levels
 */
export const getResistanceSupportFunction = new GameFunction({
    name: "get_resistance_support",
    description: `Get AI-calculated resistance and support levels for a token. Essential for:
    - Setting entry points (buy at support)
    - Setting exit points (sell at resistance)
    - Placing stop losses`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        if (!isTokenMetricsAvailable()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    symbol: args.symbol,
                    note: "Configure TOKEN_METRICS_API_KEY for support/resistance levels"
                })
            );
        }

        const cacheKey = `levels:${args.symbol.toUpperCase()}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "cache", ...cached })
            );
        }

        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached. Try again tomorrow.`
            );
        }

        try {
            logger(`Fetching support/resistance for ${args.symbol}...`);

            const data = await client.resistanceSupport.get({ symbol: args.symbol.toUpperCase() });
            trackApiCall('resistanceSupport');

            const levels = data?.[0];
            if (!levels) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No level data found" })
                );
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                currentPrice: levels.PRICE || levels.price,
                resistance: {
                    r1: levels.RESISTANCE_1 || levels.resistance1,
                    r2: levels.RESISTANCE_2 || levels.resistance2,
                    r3: levels.RESISTANCE_3 || levels.resistance3
                },
                support: {
                    s1: levels.SUPPORT_1 || levels.support1,
                    s2: levels.SUPPORT_2 || levels.support2,
                    s3: levels.SUPPORT_3 || levels.support3
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: R1=${result.resistance.r1}, S1=${result.support.s1}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_ai", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch levels: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Price Predictions
 */
export const getPricePredictionsFunction = new GameFunction({
    name: "get_price_predictions",
    description: `Get Token Metrics AI price predictions. Shows predicted price targets with confidence levels.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ note: "Configure TOKEN_METRICS_API_KEY for price predictions" })
            );
        }

        const cacheKey = `predictions:${args.symbol || 'all'}`;
        const cached = getCached(cacheKey);
        if (cached) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "cache", ...cached })
            );
        }

        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached. Try again tomorrow.`
            );
        }

        try {
            logger(`Fetching price predictions${args.symbol ? ` for ${args.symbol}` : ''}...`);

            const params: any = { limit: 10 };
            if (args.symbol) params.symbol = args.symbol.toUpperCase();

            const data = await client.pricePredictions.get(params);
            trackApiCall('pricePredictions');

            const predictions = (data || []).map((p: any) => ({
                symbol: p.TOKEN_SYMBOL || p.symbol,
                currentPrice: p.CURRENT_PRICE || p.currentPrice,
                predictedPrice: p.PREDICTED_PRICE || p.predictedPrice,
                confidence: p.CONFIDENCE || p.confidence,
                timeframe: p.TIMEFRAME || p.timeframe,
                potential: p.PREDICTED_PRICE && p.CURRENT_PRICE
                    ? (((p.PREDICTED_PRICE - p.CURRENT_PRICE) / p.CURRENT_PRICE) * 100).toFixed(1) + '%'
                    : 'N/A'
            }));

            const result = { predictions, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_ai", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch predictions: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Market Sentiment
 */
export const getMarketSentimentFunction = new GameFunction({
    name: "get_market_sentiment",
    description: `Get Token Metrics AI market sentiment analysis. Shows bullish/bearish sentiment scores.`,
    args: [] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ note: "Configure TOKEN_METRICS_API_KEY for sentiment data" })
            );
        }

        const cacheKey = 'sentiment:market';
        const cached = getCached(cacheKey);
        if (cached) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "cache", ...cached })
            );
        }

        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached. Try again tomorrow.`
            );
        }

        try {
            logger('Fetching market sentiment...');

            const data = await client.sentiments.get({ limit: 10 });
            trackApiCall('sentiments');

            const sentiments = (data || []).map((s: any) => ({
                symbol: s.TOKEN_SYMBOL || s.symbol,
                score: s.SENTIMENT_SCORE || s.sentimentScore,
                social: s.SOCIAL_SCORE || s.socialScore,
                mood: (s.SENTIMENT_SCORE || 0) >= 60 ? 'bullish' :
                    (s.SENTIMENT_SCORE || 0) >= 40 ? 'neutral' : 'bearish'
            }));

            const result = { sentiments, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_ai", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch sentiment: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get API Usage Stats
 */
export const getApiUsageFunction = new GameFunction({
    name: "get_token_metrics_usage",
    description: "Check how many Token Metrics API calls you've used today vs the daily limit.",
    args: [] as const,
    executable: async (args, logger) => {
        const stats = getApiUsageStats();
        logger(`Token Metrics: ${stats.callsToday}/${stats.dailyLimit} calls used today`);

        return new ExecutableGameFunctionResponse(
            ExecutableGameFunctionStatus.Done,
            JSON.stringify({
                callsToday: stats.callsToday,
                remaining: stats.remaining,
                dailyLimit: stats.dailyLimit,
                monthlyLimit: 500,
                cacheEntries: cache.size,
                cacheDurationHours: CACHE_DURATION / (60 * 60 * 1000)
            })
        );
    }
});
