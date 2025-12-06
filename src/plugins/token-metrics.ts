/**
 * TokenMetrics API Integration (Official SDK)
 * Provides AI-powered trading signals, grades, and analytics
 *
 * Features (from their 70% win rate signals):
 * - AI Trading Signals (long/short with confidence)
 * - TM Grades (Trader & Investor grades)
 * - Hourly Trading Signals
 * - Price Predictions
 * - Resistance/Support Levels
 * - AI Agent for market insights
 *
 * SDK Docs: https://www.npmjs.com/package/tmai-api
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { TokenMetricsClient } from 'tmai-api';
import dotenv from "dotenv";

dotenv.config();

// ============ SDK CLIENT INITIALIZATION ============
const API_KEY = process.env.TOKEN_METRICS_API_KEY;
let client: TokenMetricsClient | null = null;

if (API_KEY) {
    try {
        client = new TokenMetricsClient(API_KEY);
        console.log('📊 Token Metrics SDK initialized');
    } catch (e) {
        console.log('📊 Token Metrics SDK init error:', e instanceof Error ? e.message : e);
    }
} else {
    console.log('📊 Token Metrics: No API key configured (TOKEN_METRICS_API_KEY)');
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
    return !!API_KEY && !!client;
}

/**
 * Get AI Trading Signals - the core 70% win rate signals
 */
export const getAITradingSignalsFunction = new GameFunction({
    name: "get_ai_trading_signals",
    description: `Get Token Metrics AI trading signals with ~70% historical win rate.

    Signal values:
    - trading_signal: 1 (bullish/long), -1 (bearish/short), 0 (no signal)
    - token_trend: current trend direction (up/down/sideways)
    - trading_signals_returns: cumulative ROI of following this strategy
    - holding_returns: ROI if you just held (for comparison)
    - tm_grade: short-term trader grade (0-100)
    - fundamental_grade: long-term outlook grade

    Use this BEFORE making trading decisions!
    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH', 'SOL'). Leave empty for top signals across all tokens."
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable() || !client) {
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

            const signalData = Array.isArray(data) ? data : (data as any)?.data || [];
            const signals = signalData.slice(0, 15).map((s: any) => ({
                // Token identification
                tokenId: s.TOKEN_ID || s.token_id,
                symbol: s.TOKEN_SYMBOL || s.token_symbol || s.symbol,
                name: s.TOKEN_NAME || s.token_name,

                // Signal data (1 = bullish, -1 = bearish, 0 = neutral)
                tradingSignal: s.TRADING_SIGNAL || s.trading_signal,
                signalStr: s.TOKEN_SIGNAL_STR || s.token_signal_str, // "bullish", "bearish", "neutral"

                // Trend data
                trend: s.TOKEN_TREND || s.token_trend,
                trendStr: s.TOKEN_TREND_STR || s.token_trend_str, // "up", "down", "sideways"

                // Performance comparison
                strategyReturns: s.TRADING_SIGNALS_RETURNS || s.trading_signals_returns, // Strategy ROI
                holdingReturns: s.HOLDING_RETURNS || s.holding_returns, // Buy & hold ROI

                // Grades
                tmGrade: s.TM_GRADE || s.tm_grade, // Short-term grade
                fundamentalGrade: s.FUNDAMENTAL_GRADE || s.fundamental_grade, // Long-term grade

                // Metadata
                date: s.DATE || s.date,
                price: s.PRICE || s.price
            }));

            // Summarize signals
            const bullishSignals = signals.filter((s: any) => s.tradingSignal === 1 || s.signalStr === 'bullish');
            const bearishSignals = signals.filter((s: any) => s.tradingSignal === -1 || s.signalStr === 'bearish');

            const result = {
                signals,
                summary: {
                    bullish: bullishSignals.length,
                    bearish: bearishSignals.length,
                    neutral: signals.length - bullishSignals.length - bearishSignals.length,
                    topBullish: bullishSignals.slice(0, 3).map((s: any) => s.symbol),
                    topBearish: bearishSignals.slice(0, 3).map((s: any) => s.symbol)
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`Found ${result.summary.bullish} bullish, ${result.summary.bearish} bearish signals`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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
 * Get TM Grades - AI grades for trading
 */
export const getTokenGradesFunction = new GameFunction({
    name: "get_token_grades",
    description: `Get Token Metrics AI grades for a token. Includes:
    - TM Grade (overall trading potential)
    - Fundamental Grade
    - Momentum indicators

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

        if (!isTokenMetricsAvailable() || !client) {
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
            logger(`Fetching TM grades for ${args.symbol}...`);

            const data = await client.tmGrades.get({ symbol: args.symbol.toUpperCase() });
            trackApiCall('tmGrades');

            const gradeData = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;
            if (!gradeData) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No grade data found" })
                );
            }

            const tmGrade = gradeData.TM_GRADE || gradeData.tm_grade || gradeData.grade || 0;
            const result = {
                symbol: args.symbol.toUpperCase(),
                tmGrade: tmGrade,
                fundamentalGrade: gradeData.FUNDAMENTAL_GRADE || gradeData.fundamental_grade,
                signal: gradeData.SIGNAL || gradeData.signal,
                momentum: gradeData.MOMENTUM || gradeData.momentum,
                price: gradeData.PRICE || gradeData.price,
                recommendation: tmGrade >= 70 ? 'STRONG_BUY' :
                    tmGrade >= 50 ? 'BUY' :
                    tmGrade >= 30 ? 'HOLD' : 'AVOID',
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: TM Grade ${result.tmGrade}, Rec: ${result.recommendation}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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

        if (!isTokenMetricsAvailable() || !client) {
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

            const levels = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;
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
                    r1: levels.RESISTANCE_1 || levels.resistance_1,
                    r2: levels.RESISTANCE_2 || levels.resistance_2,
                    r3: levels.RESISTANCE_3 || levels.resistance_3
                },
                support: {
                    s1: levels.SUPPORT_1 || levels.support_1,
                    s2: levels.SUPPORT_2 || levels.support_2,
                    s3: levels.SUPPORT_3 || levels.support_3
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: R1=${result.resistance.r1}, S1=${result.support.s1}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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
        if (!isTokenMetricsAvailable() || !client) {
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

            const params: any = {};
            if (args.symbol) params.symbol = args.symbol.toUpperCase();

            const data = await client.pricePrediction.get(params);
            trackApiCall('pricePrediction');

            const predictionData = Array.isArray(data) ? data : (data as any)?.data || [];
            const predictions = predictionData.map((p: any) => ({
                symbol: p.TOKEN_SYMBOL || p.token_symbol || p.symbol,
                currentPrice: p.CURRENT_PRICE || p.current_price,
                predictedPrice: p.PREDICTED_PRICE || p.predicted_price,
                bullScenario: p.BULL_SCENARIO || p.bull_scenario,
                bearScenario: p.BEAR_SCENARIO || p.bear_scenario,
                potential: p.PREDICTED_PRICE && p.CURRENT_PRICE
                    ? (((p.PREDICTED_PRICE - p.CURRENT_PRICE) / p.CURRENT_PRICE) * 100).toFixed(1) + '%'
                    : 'N/A'
            }));

            const result = { predictions, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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
 * Get Hourly Trading Signals - more frequent signals
 */
export const getHourlySignalsFunction = new GameFunction({
    name: "get_hourly_signals",
    description: `Get Token Metrics hourly trading signals. More frequent updates than daily signals.`,
    args: [
        {
            name: "token_id",
            description: "Token ID (e.g., '3375' for BTC, '3306' for ETH)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable() || !client) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ note: "Configure TOKEN_METRICS_API_KEY for hourly signals" })
            );
        }

        const cacheKey = `hourly:${args.token_id || 'all'}`;
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
            logger(`Fetching hourly signals${args.token_id ? ` for token ${args.token_id}` : ''}...`);

            const params: any = { limit: 10 };
            if (args.token_id) params.token_id = args.token_id;

            const data = await client.hourlyTradingSignals.get(params);
            trackApiCall('hourlyTradingSignals');

            const signalData = Array.isArray(data) ? data : (data as any)?.data || [];
            const signals = signalData.map((s: any) => ({
                tokenId: s.TOKEN_ID || s.token_id,
                symbol: s.TOKEN_SYMBOL || s.token_symbol,
                signal: s.SIGNAL || s.signal,
                price: s.PRICE || s.price,
                timestamp: s.TIMESTAMP || s.timestamp || s.DATE || s.date
            }));

            const result = { signals, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch hourly signals: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Ask AI Agent - get market insights from Token Metrics AI
 */
export const askAIAgentFunction = new GameFunction({
    name: "ask_tm_ai",
    description: `Ask the Token Metrics AI agent for market insights. Great for:
    - Market analysis questions
    - Token forecasts
    - Trading strategy advice`,
    args: [
        {
            name: "question",
            description: "Your question about crypto markets (e.g., 'What is your analysis of Bitcoin?')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.question) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Question is required"
            );
        }

        if (!isTokenMetricsAvailable() || !client) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ note: "Configure TOKEN_METRICS_API_KEY for AI agent" })
            );
        }

        // Don't cache AI responses - they should be fresh
        if (!canMakeApiCall()) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Daily API limit reached. Try again tomorrow.`
            );
        }

        try {
            logger(`Asking TM AI: "${args.question}"...`);

            const answer = await client.aiAgent.getAnswerText(args.question);
            trackApiCall('aiAgent');

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "tokenmetrics_ai",
                    question: args.question,
                    answer: answer,
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to get AI response: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Moonshot Tokens - AI-curated high potential picks
 */
export const getMoonshotTokensFunction = new GameFunction({
    name: "get_moonshot_tokens",
    description: `Get Token Metrics AI-curated moonshot tokens with high breakout potential. Great for finding hidden gems.`,
    args: [
        {
            name: "type",
            description: "Type of moonshots: 'active' or 'all' (default: active)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable() || !client) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ note: "Configure TOKEN_METRICS_API_KEY for moonshot tokens" })
            );
        }

        const cacheKey = `moonshots:${args.type || 'active'}`;
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
            logger(`Fetching moonshot tokens...`);

            const data = await client.moonshotTokens.get({
                type: (args.type || 'active') as 'active' | 'past',
                sort_by: 'roi_pct',
                limit: 10
            });
            trackApiCall('moonshotTokens');

            const tokenData = Array.isArray(data) ? data : (data as any)?.data || [];
            const tokens = tokenData.map((t: any) => ({
                symbol: t.TOKEN_SYMBOL || t.token_symbol || t.symbol,
                name: t.TOKEN_NAME || t.token_name || t.name,
                roi: t.ROI_PCT || t.roi_pct,
                grade: t.TM_GRADE || t.tm_grade,
                price: t.PRICE || t.price
            }));

            const result = { tokens, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch moonshots: ${e instanceof Error ? e.message : 'Unknown error'}`
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
        if (!isTokenMetricsAvailable() || !client) {
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

            // Use market metrics as sentiment proxy
            const data = await client.marketMetrics.get({ limit: 10 });
            trackApiCall('marketMetrics');

            const metricsData = Array.isArray(data) ? data : (data as any)?.data || [];
            const sentiments = metricsData.map((s: any) => ({
                date: s.DATE || s.date,
                indicator: s.BULLISH_BEARISH_INDICATOR || s.bullish_bearish_indicator,
                btcDominance: s.BTC_DOMINANCE || s.btc_dominance,
                totalMarketCap: s.TOTAL_MARKET_CAP || s.total_market_cap,
                mood: (s.BULLISH_BEARISH_INDICATOR || 0) >= 60 ? 'bullish' :
                    (s.BULLISH_BEARISH_INDICATOR || 0) >= 40 ? 'neutral' : 'bearish'
            }));

            const result = { sentiments, timestamp: new Date().toISOString() };
            setCache(cacheKey, result);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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
                cacheDurationHours: CACHE_DURATION / (60 * 60 * 1000),
                apiAvailable: isTokenMetricsAvailable()
            })
        );
    }
});
