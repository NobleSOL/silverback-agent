/**
 * TokenMetrics API Integration (REST API with SDK fallback)
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
 * Note: SDK has ESM issues on some Node versions, using REST API as primary
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import dotenv from "dotenv";

dotenv.config();

// ============ REST API CLIENT ============
const API_KEY = process.env.TOKEN_METRICS_API_KEY;
const BASE_URL = 'https://api.tokenmetrics.com/v2';

// Generic client interface to match SDK structure
interface TMClient {
    get: (endpoint: string, params?: Record<string, any>) => Promise<any>;
}

let client: TMClient | null = null;

if (API_KEY) {
    // Use REST API directly (more reliable than SDK with ESM issues)
    client = {
        get: async (endpoint: string, params?: Record<string, any>) => {
            const url = new URL(`${BASE_URL}/${endpoint}`);
            if (params) {
                Object.entries(params).forEach(([key, value]) => {
                    if (value !== undefined) url.searchParams.append(key, String(value));
                });
            }

            const response = await fetch(url.toString(), {
                headers: {
                    'accept': 'application/json',
                    'api_key': API_KEY
                }
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status} ${response.statusText}`);
            }

            return response.json();
        }
    };
    console.log('📊 Token Metrics REST API initialized');
} else {
    console.log('📊 Token Metrics: No API key configured (TOKEN_METRICS_API_KEY)');
}

// Helper to call API endpoints
async function callAPI(endpoint: string, params?: Record<string, any>): Promise<any> {
    if (!client) throw new Error('Token Metrics client not initialized');
    return client.get(endpoint, params);
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

            const data = await callAPI('trading-signals', params);
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
    description: `Get Token Metrics AI grades for a token.

    Datapoints:
    - tm_grade: Short-term Trader Grade (0-100) - overall trading potential
    - fundamental_grade: Long-term outlook grade (0-100)
    - signal: Current signal (1=bullish, -1=bearish, 0=neutral)
    - signal_str: String signal ("bullish", "bearish", "neutral")
    - momentum: Price momentum indicator
    - volatility: Token volatility level
    - market_cap_rank: Ranking by market cap

    Grade interpretation:
    - 70-100: STRONG_BUY - excellent short-term opportunity
    - 50-69: BUY - good opportunity
    - 30-49: HOLD - neutral, wait for better entry
    - 0-29: AVOID - poor outlook

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
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

            const data = await callAPI('trader-grades', { symbol: args.symbol.toUpperCase() });
            trackApiCall('tmGrades');

            const gradeData = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;
            if (!gradeData) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No grade data found" })
                );
            }

            const tmGrade = gradeData.TM_GRADE || gradeData.tm_grade || 0;
            const fundamentalGrade = gradeData.FUNDAMENTAL_GRADE || gradeData.fundamental_grade || 0;
            const signal = gradeData.SIGNAL || gradeData.signal;

            const result = {
                // Token info
                tokenId: gradeData.TOKEN_ID || gradeData.token_id,
                symbol: args.symbol.toUpperCase(),
                name: gradeData.TOKEN_NAME || gradeData.token_name,

                // Core grades (0-100)
                tmGrade: tmGrade,
                fundamentalGrade: fundamentalGrade,

                // Signal data
                signal: signal, // 1, -1, or 0
                signalStr: signal === 1 ? 'bullish' : signal === -1 ? 'bearish' : 'neutral',

                // Additional metrics
                momentum: gradeData.MOMENTUM || gradeData.momentum,
                volatility: gradeData.VOLATILITY || gradeData.volatility,
                marketCapRank: gradeData.MARKET_CAP_RANK || gradeData.market_cap_rank,

                // Price info
                price: gradeData.PRICE || gradeData.price,
                priceChange24h: gradeData.PRICE_CHANGE_24H || gradeData.price_change_24h,

                // Computed recommendation
                recommendation: tmGrade >= 70 ? 'STRONG_BUY' :
                    tmGrade >= 50 ? 'BUY' :
                    tmGrade >= 30 ? 'HOLD' : 'AVOID',

                // Action guidance
                action: signal === 1 && tmGrade >= 50 ? 'CONSIDER_LONG' :
                    signal === -1 && tmGrade < 30 ? 'CONSIDER_SHORT' : 'WAIT',

                date: gradeData.DATE || gradeData.date,
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: TM Grade ${result.tmGrade}, Signal: ${result.signalStr}, Action: ${result.action}`);

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
    description: `Get AI-calculated resistance and support levels for a token.

    Datapoints:
    - token_id: Token ID for identifying cryptocurrency
    - token_name: Name of the crypto asset (e.g., Bitcoin)
    - token_symbol: Symbol of the crypto asset (e.g., BTC)
    - resistance_1/2/3: Price levels where selling pressure may increase (R1 nearest)
    - support_1/2/3: Price levels where buying pressure may increase (S1 nearest)
    - historical_resistance_support_levels: Historical list of all R/S levels
    - price: Current token price
    - app_link: Link to Token Metrics token details page

    Trading Strategy:
    - BUY near support levels (S1, S2, S3) - price likely to bounce
    - SELL near resistance levels (R1, R2, R3) - price likely to face resistance
    - Set STOP LOSS just below support for longs
    - Set TAKE PROFIT just below resistance for longs

    Example: If BTC at $95,000, S1=$93,000, R1=$98,000
    - Good entry: near $93,000 (S1)
    - Take profit: near $98,000 (R1)
    - Stop loss: below $93,000

    Use Case: Figure out good points to take profit and set stop losses.

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
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

            const data = await callAPI('resistance-support', { symbol: args.symbol.toUpperCase() });
            trackApiCall('resistanceSupport');

            const rawData = Array.isArray(data) ? data : (data as any)?.data || [];
            const levels = rawData[0];
            if (!levels) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No level data found" })
                );
            }

            // Token identification
            const tokenId = levels.TOKEN_ID || levels.token_id;
            const tokenName = levels.TOKEN_NAME || levels.token_name;
            const tokenSymbol = levels.TOKEN_SYMBOL || levels.token_symbol || args.symbol.toUpperCase();
            const slug = levels.SLUG || levels.slug;

            const currentPrice = levels.PRICE || levels.price || 0;
            const r1 = levels.RESISTANCE_1 || levels.resistance_1;
            const r2 = levels.RESISTANCE_2 || levels.resistance_2;
            const r3 = levels.RESISTANCE_3 || levels.resistance_3;
            const s1 = levels.SUPPORT_1 || levels.support_1;
            const s2 = levels.SUPPORT_2 || levels.support_2;
            const s3 = levels.SUPPORT_3 || levels.support_3;

            // Calculate distance to nearest levels
            const distanceToR1 = r1 ? ((r1 - currentPrice) / currentPrice * 100).toFixed(2) : null;
            const distanceToS1 = s1 ? ((currentPrice - s1) / currentPrice * 100).toFixed(2) : null;

            // Determine position relative to levels
            let position = 'middle';
            if (distanceToS1 && parseFloat(distanceToS1) < 2) position = 'near_support';
            if (distanceToR1 && parseFloat(distanceToR1) < 2) position = 'near_resistance';

            // Extract historical levels if available
            const historicalLevels = levels.HISTORICAL_RESISTANCE_SUPPORT_LEVELS ||
                levels.historical_resistance_support_levels || null;

            // Build app link
            const appLink = slug
                ? `https://app.tokenmetrics.com/token/${slug}`
                : tokenId
                    ? `https://app.tokenmetrics.com/token/${tokenId}`
                    : null;

            const result = {
                // Token identification
                tokenId: tokenId,
                tokenName: tokenName,
                symbol: tokenSymbol,
                slug: slug,

                currentPrice: currentPrice,

                // Resistance levels (price ceilings)
                resistance: {
                    r1: r1, // Nearest resistance
                    r2: r2,
                    r3: r3  // Furthest resistance
                },

                // Support levels (price floors)
                support: {
                    s1: s1, // Nearest support
                    s2: s2,
                    s3: s3  // Furthest support
                },

                // Historical levels (if available)
                historicalLevels: historicalLevels,

                // Analysis
                analysis: {
                    distanceToR1Pct: distanceToR1 ? `${distanceToR1}%` : null,
                    distanceToS1Pct: distanceToS1 ? `${distanceToS1}%` : null,
                    position: position, // 'near_support', 'near_resistance', or 'middle'
                    suggestion: position === 'near_support' ? 'GOOD_ENTRY_ZONE' :
                        position === 'near_resistance' ? 'TAKE_PROFIT_ZONE' : 'WAIT_FOR_BETTER_ENTRY',
                    stopLossLevel: s1 ? `Below $${s1} (S1)` : null,
                    takeProfitLevel: r1 ? `Near $${r1} (R1)` : null
                },

                // Links
                appLink: appLink,

                date: levels.DATE || levels.date,
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${tokenSymbol}: R1=${r1}, S1=${s1}, Position: ${position}`);

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

            const data = await callAPI('price-prediction', params);
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

            const data = await callAPI('hourly-trading-signals', params);
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

            // AI Agent uses POST request
            const response = await fetch(`${BASE_URL}/ai-agent`, {
                method: 'POST',
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/json',
                    'api_key': API_KEY!
                },
                body: JSON.stringify({ question: args.question })
            });

            if (!response.ok) {
                throw new Error(`AI Agent API error: ${response.status}`);
            }

            const result = await response.json();
            trackApiCall('aiAgent');

            const answer = result.answer || result.data?.answer || result.response || JSON.stringify(result);

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

            const data = await callAPI('moonshot-tokens', {
                type: args.type || 'active',
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
            const data = await callAPI('market-metrics', { limit: 10 });
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

/**
 * Get Hourly OHLCV Data - for technical analysis
 */
export const getHourlyOHLCVFunction = new GameFunction({
    name: "get_hourly_ohlcv",
    description: `Get hourly OHLCV (Open, High, Low, Close, Volume) data for a token.

    Datapoints:
    - open: Price at start of the hour
    - high: Highest price during the hour
    - low: Lowest price during the hour
    - close: Price at end of the hour
    - volume: Total trading volume during the hour
    - timestamp: The hour timestamp

    Use cases:
    - Technical analysis (candlestick patterns)
    - Identify price trends and momentum
    - Calculate indicators (RSI, MACD, etc.)
    - Measure volatility (high-low range)
    - Track volume spikes

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        },
        {
            name: "limit",
            description: "Number of hourly candles to fetch (default: 24)"
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
                    note: "Configure TOKEN_METRICS_API_KEY for OHLCV data"
                })
            );
        }

        const limit = parseInt(args.limit || '24', 10);
        const cacheKey = `ohlcv:${args.symbol.toUpperCase()}:${limit}`;
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
            logger(`Fetching hourly OHLCV for ${args.symbol}...`);

            const data = await callAPI('hourly-ohlcv', {
                symbol: args.symbol.toUpperCase(),
                limit: limit
            });
            trackApiCall('hourlyOhlcv');

            const ohlcvData = Array.isArray(data) ? data : (data as any)?.data || [];
            const candles = ohlcvData.map((c: any) => ({
                timestamp: c.TIMESTAMP || c.timestamp,
                open: c.OPEN || c.open,
                high: c.HIGH || c.high,
                low: c.LOW || c.low,
                close: c.CLOSE || c.close,
                volume: c.VOLUME || c.volume
            }));

            // Calculate some basic stats
            const latestCandle = candles[0];
            const priceRange = latestCandle ? (latestCandle.high - latestCandle.low) : 0;
            const priceRangePct = latestCandle ? ((priceRange / latestCandle.low) * 100).toFixed(2) : 0;

            // Simple trend detection
            let trend = 'sideways';
            if (candles.length >= 3) {
                const recentCloses = candles.slice(0, 3).map((c: any) => c.close);
                if (recentCloses[0] > recentCloses[1] && recentCloses[1] > recentCloses[2]) {
                    trend = 'uptrend';
                } else if (recentCloses[0] < recentCloses[1] && recentCloses[1] < recentCloses[2]) {
                    trend = 'downtrend';
                }
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                candles: candles,
                analysis: {
                    latestPrice: latestCandle?.close,
                    hourlyHigh: latestCandle?.high,
                    hourlyLow: latestCandle?.low,
                    hourlyVolume: latestCandle?.volume,
                    priceRangePct: `${priceRangePct}%`,
                    shortTermTrend: trend
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: Latest ${latestCandle?.close}, Trend: ${trend}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
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
 * Get Daily OHLCV Data - for longer-term analysis
 */
export const getDailyOHLCVFunction = new GameFunction({
    name: "get_daily_ohlcv",
    description: `Get daily OHLCV (Open, High, Low, Close, Volume) data for a token.

    Datapoints:
    - open: Price at start of the day
    - high: Highest price during the day
    - low: Lowest price during the day
    - close: Price at end of the day
    - volume: Total trading volume during the day
    - date: The day's date

    Use cases:
    - Longer-term trend analysis (days/weeks)
    - Daily candlestick patterns
    - Calculate daily indicators
    - Compare daily volatility
    - Track volume trends over time

    Better than hourly for:
    - Swing trading decisions
    - Multi-day trend identification
    - Support/resistance confirmation

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        },
        {
            name: "limit",
            description: "Number of daily candles to fetch (default: 30)"
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
                    note: "Configure TOKEN_METRICS_API_KEY for OHLCV data"
                })
            );
        }

        const limit = parseInt(args.limit || '30', 10);
        const cacheKey = `daily_ohlcv:${args.symbol.toUpperCase()}:${limit}`;
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
            logger(`Fetching daily OHLCV for ${args.symbol}...`);

            const data = await callAPI('daily-ohlcv', {
                symbol: args.symbol.toUpperCase(),
                limit: limit
            });
            trackApiCall('dailyOhlcv');

            const ohlcvData = Array.isArray(data) ? data : (data as any)?.data || [];
            const candles = ohlcvData.map((c: any) => ({
                date: c.DATE || c.date,
                open: c.OPEN || c.open,
                high: c.HIGH || c.high,
                low: c.LOW || c.low,
                close: c.CLOSE || c.close,
                volume: c.VOLUME || c.volume
            }));

            // Calculate stats
            const latestCandle = candles[0];
            const priceRange = latestCandle ? (latestCandle.high - latestCandle.low) : 0;
            const dailyRangePct = latestCandle ? ((priceRange / latestCandle.low) * 100).toFixed(2) : 0;

            // Calculate 7-day and 30-day trends
            let weekTrend = 'sideways';
            let monthTrend = 'sideways';

            if (candles.length >= 7) {
                const weekChange = ((candles[0].close - candles[6].close) / candles[6].close * 100);
                weekTrend = weekChange > 3 ? 'uptrend' : weekChange < -3 ? 'downtrend' : 'sideways';
            }

            if (candles.length >= 30) {
                const monthChange = ((candles[0].close - candles[29].close) / candles[29].close * 100);
                monthTrend = monthChange > 10 ? 'uptrend' : monthChange < -10 ? 'downtrend' : 'sideways';
            }

            // Calculate average volume
            const avgVolume = candles.length > 0
                ? candles.reduce((sum: number, c: any) => sum + (c.volume || 0), 0) / candles.length
                : 0;
            const volumeVsAvg = latestCandle && avgVolume
                ? ((latestCandle.volume - avgVolume) / avgVolume * 100).toFixed(1)
                : 0;

            const result = {
                symbol: args.symbol.toUpperCase(),
                candles: candles,
                analysis: {
                    latestPrice: latestCandle?.close,
                    dailyHigh: latestCandle?.high,
                    dailyLow: latestCandle?.low,
                    dailyVolume: latestCandle?.volume,
                    dailyRangePct: `${dailyRangePct}%`,
                    weekTrend: weekTrend,
                    monthTrend: monthTrend,
                    volumeVsAvgPct: `${volumeVsAvg}%`,
                    avgVolume: avgVolume
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: Latest ${latestCandle?.close}, Week: ${weekTrend}, Month: ${monthTrend}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch daily OHLCV: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Market Metrics - Overall crypto market health indicators
 */
export const getMarketMetricsFunction = new GameFunction({
    name: "get_market_metrics",
    description: `Get Token Metrics overall crypto market health indicators.

    Provides "Bullish" and "Bearish" signals on the ENTIRE crypto market based on
    market conditions and trend analysis. Essential for understanding market sentiment.

    Datapoints:
    - rect_signal: Market recommendation (-1=Bearish, 0=Neutral, 1=Bullish)
    - tm_grade_signal: TM grade system signal (-1=Bearish, 0=Neutral, 1=Bullish)
    - tm_grade_perc_high_coins: % of coins with high TM grade (bullish strength)
    - total_crypto_mcap: Total market cap (USD)
    - btc_price: Bitcoin price (USD)
    - btc_market_cap: Bitcoin market cap (USD)
    - alts_market_cap: Altcoin market cap (USD)
    - alts_indicator: Altcoin strength vs BTC
    - vol_index: Volatility index (market risk/uncertainty)
    - vol_10: Short-term volatility (10-day)
    - vol_90: Long-term volatility (90-day)
    - above_ma: % of tokens above moving average (momentum)

    Trading Strategy:
    - rect_signal=1 + tm_grade_signal=1 → Market bullish, FAVOR LONGS
    - rect_signal=-1 + tm_grade_signal=-1 → Market bearish, FAVOR SHORTS or CASH
    - High tm_grade_perc_high_coins (>60%) → Strong bullish momentum
    - vol_10 > vol_90 → Increasing volatility, be cautious
    - above_ma > 60% → Market momentum bullish

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "limit",
            description: "Number of days of data to fetch (default: 7)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable() || !client) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    note: "Configure TOKEN_METRICS_API_KEY for market metrics"
                })
            );
        }

        const limit = parseInt(args.limit || '7', 10);
        const cacheKey = `market_metrics:${limit}`;
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
            logger('Fetching market metrics...');

            const data = await callAPI('market-metrics', { limit: limit });
            trackApiCall('marketMetrics');

            const metricsData = Array.isArray(data) ? data : (data as any)?.data || [];
            const metrics = metricsData.map((m: any) => ({
                // Date
                date: m.DATE || m.date,

                // Market Signals
                rectSignal: m.RECT_SIGNAL || m.rect_signal, // -1, 0, 1
                tmGradeSignal: m.TM_GRADE_SIGNAL || m.tm_grade_signal, // -1, 0, 1
                tmGradePercHighCoins: m.TM_GRADE_PERC_HIGH_COINS || m.tm_grade_perc_high_coins,

                // Market Caps
                totalCryptoMcap: m.TOTAL_CRYPTO_MCAP || m.total_crypto_mcap,
                btcMarketCap: m.BTC_MARKET_CAP || m.btc_market_cap,
                altsMarketCap: m.ALTS_MARKET_CAP || m.alts_market_cap,

                // Prices
                btcPrice: m.BTC_PRICE || m.btc_price,

                // Indicators
                altsIndicator: m.ALTS_INDICATOR || m.alts_indicator,
                aboveMA: m.ABOVE_MA || m.above_ma,

                // Volatility
                volIndex: m.VOL_INDEX || m.vol_index,
                vol10: m.VOL_10 || m.vol_10,
                vol_90: m.VOL_90 || m.vol_90
            }));

            // Get latest metrics for analysis
            const latest = metrics[0] || {};

            // Interpret signals
            const rectSignalStr = latest.rectSignal === 1 ? 'BULLISH' :
                latest.rectSignal === -1 ? 'BEARISH' : 'NEUTRAL';
            const tmSignalStr = latest.tmGradeSignal === 1 ? 'BULLISH' :
                latest.tmGradeSignal === -1 ? 'BEARISH' : 'NEUTRAL';

            // Overall market mood
            let marketMood = 'NEUTRAL';
            if (latest.rectSignal === 1 && latest.tmGradeSignal === 1) {
                marketMood = 'BULLISH';
            } else if (latest.rectSignal === -1 && latest.tmGradeSignal === -1) {
                marketMood = 'BEARISH';
            } else if (latest.rectSignal === 1 || latest.tmGradeSignal === 1) {
                marketMood = 'SLIGHTLY_BULLISH';
            } else if (latest.rectSignal === -1 || latest.tmGradeSignal === -1) {
                marketMood = 'SLIGHTLY_BEARISH';
            }

            // Volatility assessment
            let volatilityStatus = 'NORMAL';
            if (latest.vol10 && latest.vol_90) {
                if (latest.vol10 > latest.vol_90 * 1.2) {
                    volatilityStatus = 'ELEVATED';
                } else if (latest.vol10 < latest.vol_90 * 0.8) {
                    volatilityStatus = 'LOW';
                }
            }

            // Momentum assessment
            let momentumStatus = 'NEUTRAL';
            if (latest.aboveMA > 60) {
                momentumStatus = 'BULLISH';
            } else if (latest.aboveMA < 40) {
                momentumStatus = 'BEARISH';
            }

            // Trading guidance
            let tradingGuidance = 'WAIT';
            if (marketMood === 'BULLISH' && momentumStatus === 'BULLISH') {
                tradingGuidance = 'FAVOR_LONGS';
            } else if (marketMood === 'BEARISH' && momentumStatus === 'BEARISH') {
                tradingGuidance = 'FAVOR_SHORTS_OR_CASH';
            } else if (volatilityStatus === 'ELEVATED') {
                tradingGuidance = 'REDUCE_POSITION_SIZE';
            }

            const result = {
                metrics: metrics,
                latest: {
                    date: latest.date,
                    btcPrice: latest.btcPrice,
                    totalMarketCap: latest.totalCryptoMcap,
                    rectSignal: `${latest.rectSignal} (${rectSignalStr})`,
                    tmGradeSignal: `${latest.tmGradeSignal} (${tmSignalStr})`,
                    percentHighGradeCoins: latest.tmGradePercHighCoins,
                    aboveMovingAverage: latest.aboveMA
                },
                analysis: {
                    marketMood: marketMood,
                    volatilityStatus: volatilityStatus,
                    momentumStatus: momentumStatus,
                    tradingGuidance: tradingGuidance,
                    explanation: `Market is ${marketMood.toLowerCase().replace('_', ' ')} with ${volatilityStatus.toLowerCase()} volatility. ${latest.aboveMA ? `${latest.aboveMA}% of tokens` : 'Many tokens'} above MA.`
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`Market: ${marketMood}, Volatility: ${volatilityStatus}, Guidance: ${tradingGuidance}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch market metrics: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Investor Grade - Long-term fundamental assessment
 * Different from Trader Grade which focuses on short-term technical signals
 */
export const getInvestorGradeFunction = new GameFunction({
    name: "get_investor_grade",
    description: `Get Token Metrics INVESTOR Grade - long-term fundamental assessment.

    This is DIFFERENT from Trader Grade:
    - Trader Grade: Short-term technical signals (days/weeks)
    - Investor Grade: Long-term fundamentals (months/years)

    Datapoints:
    - investor_grade: Overall long-term score (0-100)
    - technology_grade: Tech quality, innovation, scalability
    - fundamental_grade: Tokenomics, team, adoption
    - valuation_grade: Is it overvalued or undervalued?
    - ta_grade: Technical analysis component

    Use for:
    - Portfolio allocation decisions
    - Long-term hold vs trade decisions
    - Identifying fundamentally strong tokens

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
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
                    note: "Configure TOKEN_METRICS_API_KEY for investor grades"
                })
            );
        }

        const cacheKey = `investor_grades:${args.symbol.toUpperCase()}`;
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
            logger(`Fetching Investor Grade for ${args.symbol}...`);

            const data = await callAPI('investor-grades', { symbol: args.symbol.toUpperCase() });
            trackApiCall('investorGrades');

            const gradeData = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;
            if (!gradeData) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No investor grade data found" })
                );
            }

            const investorGrade = gradeData.INVESTOR_GRADE || gradeData.investor_grade || 0;
            const techGrade = gradeData.TECHNOLOGY_GRADE || gradeData.technology_grade || 0;
            const fundamentalGrade = gradeData.FUNDAMENTAL_GRADE || gradeData.fundamental_grade || 0;
            const valuationGrade = gradeData.VALUATION_GRADE || gradeData.valuation_grade || 0;
            const taGrade = gradeData.TA_GRADE || gradeData.ta_grade || 0;

            // Determine recommendation
            let recommendation: string;
            let holdPeriod: string;
            if (investorGrade >= 80) {
                recommendation = 'STRONG_ACCUMULATE';
                holdPeriod = 'Long-term hold (1+ years)';
            } else if (investorGrade >= 65) {
                recommendation = 'ACCUMULATE';
                holdPeriod = 'Medium-term hold (6-12 months)';
            } else if (investorGrade >= 50) {
                recommendation = 'HOLD';
                holdPeriod = 'Monitor for changes';
            } else if (investorGrade >= 35) {
                recommendation = 'REDUCE';
                holdPeriod = 'Consider taking profits';
            } else {
                recommendation = 'AVOID';
                holdPeriod = 'Weak fundamentals';
            }

            // Compare to trader grade for divergence detection
            const traderGrade = gradeData.TM_GRADE || gradeData.tm_grade || 0;
            let divergence: string | null = null;
            if (Math.abs(investorGrade - traderGrade) > 20) {
                if (investorGrade > traderGrade) {
                    divergence = 'INVESTOR > TRADER: Good long-term fundamentals but short-term weakness. Accumulation opportunity?';
                } else {
                    divergence = 'TRADER > INVESTOR: Short-term momentum but weak fundamentals. Trade, don\'t invest.';
                }
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                investorGrade: investorGrade,
                components: {
                    technology: techGrade,
                    fundamental: fundamentalGrade,
                    valuation: valuationGrade,
                    technicalAnalysis: taGrade
                },
                traderGrade: traderGrade, // For comparison
                divergence: divergence,
                recommendation: recommendation,
                holdPeriod: holdPeriod,
                analysis: {
                    isUndervalued: valuationGrade >= 60,
                    hasSolidTech: techGrade >= 60,
                    strongFundamentals: fundamentalGrade >= 60,
                    overallOutlook: investorGrade >= 60 ? 'POSITIVE' : investorGrade >= 40 ? 'NEUTRAL' : 'NEGATIVE'
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: Investor Grade ${investorGrade}, Recommendation: ${recommendation}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch investor grade: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Token Metrics AI Indices - Model portfolios
 */
export const getAIIndicesFunction = new GameFunction({
    name: "get_ai_indices",
    description: `Get Token Metrics AI-powered model portfolios (Indices).

    These are curated crypto portfolios based on different strategies:
    - Passive Index: Low-risk, diversified holdings
    - Active Trader: Higher turnover, momentum-based
    - DeFi Index: DeFi-focused tokens
    - AI/Metaverse: Emerging tech tokens

    Datapoints:
    - index_name: Name of the portfolio
    - tokens: List of tokens with weights
    - rebalance_date: When portfolio was last rebalanced
    - performance: Historical returns

    Use for:
    - Portfolio diversification ideas
    - Understanding sector allocations
    - Learning institutional allocation strategies

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "index_type",
            description: "Index type: 'passive', 'active', 'defi', 'ai', or 'all' (default: all)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable() || !client) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    note: "Configure TOKEN_METRICS_API_KEY for AI indices"
                })
            );
        }

        const indexType = args.index_type?.toLowerCase() || 'all';
        const cacheKey = `indices:${indexType}`;
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
            logger(`Fetching AI Indices (${indexType})...`);

            const data = await callAPI('indices', { limit: 20 });
            trackApiCall('indices');

            const indicesData = Array.isArray(data) ? data : (data as any)?.data || [];
            const indices = indicesData.map((idx: any) => ({
                indexId: idx.INDEX_ID || idx.index_id,
                name: idx.INDEX_NAME || idx.index_name,
                description: idx.DESCRIPTION || idx.description,
                tokens: idx.TOKENS || idx.tokens || [],
                weights: idx.WEIGHTS || idx.weights || [],
                performance: {
                    daily: idx.DAILY_RETURN || idx.daily_return,
                    weekly: idx.WEEKLY_RETURN || idx.weekly_return,
                    monthly: idx.MONTHLY_RETURN || idx.monthly_return,
                    yearly: idx.YEARLY_RETURN || idx.yearly_return
                },
                rebalanceDate: idx.REBALANCE_DATE || idx.rebalance_date,
                riskLevel: idx.RISK_LEVEL || idx.risk_level
            }));

            const result = {
                indexType: indexType,
                indices: indices,
                topPerformer: indices.reduce((best: any, curr: any) =>
                    (curr.performance?.monthly || 0) > (best?.performance?.monthly || 0) ? curr : best, null),
                learningInsights: [
                    'AI indices show how professionals allocate across crypto sectors',
                    'Compare your portfolio allocation to these benchmarks',
                    'Note rebalance dates - major allocation shifts signal market views'
                ],
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`Found ${indices.length} AI indices`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch indices: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Quantitative Metrics - Advanced analytics
 */
export const getQuantMetricsFunction = new GameFunction({
    name: "get_quant_metrics",
    description: `Get advanced quantitative metrics for a token.

    Datapoints:
    - sharpe_ratio: Risk-adjusted return (higher is better, >1 is good)
    - sortino_ratio: Downside risk-adjusted return
    - max_drawdown: Largest peak-to-trough decline
    - volatility: Standard deviation of returns
    - beta: Correlation with BTC (>1 = more volatile than BTC)
    - alpha: Excess return vs BTC

    Use for:
    - Risk assessment before trading
    - Portfolio risk management
    - Comparing tokens on risk-adjusted basis

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'ETH', 'SOL')"
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
                    note: "Configure TOKEN_METRICS_API_KEY for quant metrics"
                })
            );
        }

        const cacheKey = `quant:${args.symbol.toUpperCase()}`;
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
            logger(`Fetching quant metrics for ${args.symbol}...`);

            const data = await callAPI('quantmetrics', { symbol: args.symbol.toUpperCase() });
            trackApiCall('quantMetrics');

            const metricsData = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;
            if (!metricsData) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ symbol: args.symbol, note: "No quant metrics found" })
                );
            }

            const sharpe = metricsData.SHARPE_RATIO || metricsData.sharpe_ratio || 0;
            const sortino = metricsData.SORTINO_RATIO || metricsData.sortino_ratio || 0;
            const maxDrawdown = metricsData.MAX_DRAWDOWN || metricsData.max_drawdown || 0;
            const volatility = metricsData.VOLATILITY || metricsData.volatility || 0;
            const beta = metricsData.BETA || metricsData.beta || 1;
            const alpha = metricsData.ALPHA || metricsData.alpha || 0;

            // Risk assessment
            let riskLevel: string;
            let positionSizeAdvice: string;
            if (volatility > 100 || maxDrawdown < -50) {
                riskLevel = 'EXTREME';
                positionSizeAdvice = 'Maximum 0.5% of portfolio per trade';
            } else if (volatility > 70 || maxDrawdown < -30) {
                riskLevel = 'HIGH';
                positionSizeAdvice = 'Maximum 1% of portfolio per trade';
            } else if (volatility > 40) {
                riskLevel = 'MEDIUM';
                positionSizeAdvice = 'Maximum 2% of portfolio per trade';
            } else {
                riskLevel = 'LOW';
                positionSizeAdvice = 'Standard position sizing (up to 3%)';
            }

            // Quality assessment
            let qualityScore: string;
            if (sharpe > 2 && sortino > 2) {
                qualityScore = 'EXCELLENT - Strong risk-adjusted returns';
            } else if (sharpe > 1 && sortino > 1) {
                qualityScore = 'GOOD - Positive risk-adjusted returns';
            } else if (sharpe > 0) {
                qualityScore = 'FAIR - Marginal risk-adjusted returns';
            } else {
                qualityScore = 'POOR - Negative risk-adjusted returns';
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                metrics: {
                    sharpeRatio: sharpe,
                    sortinoRatio: sortino,
                    maxDrawdown: `${maxDrawdown}%`,
                    volatility: `${volatility}%`,
                    beta: beta,
                    alpha: `${alpha}%`
                },
                interpretation: {
                    sharpe: sharpe > 1 ? 'Good risk-adjusted return' : 'Below-average risk-adjusted return',
                    beta: beta > 1.5 ? 'Much more volatile than BTC' : beta > 1 ? 'More volatile than BTC' : 'Less volatile than BTC',
                    drawdown: maxDrawdown < -40 ? 'High drawdown risk' : 'Manageable drawdown'
                },
                riskAssessment: {
                    level: riskLevel,
                    positionSizeAdvice: positionSizeAdvice,
                    qualityScore: qualityScore
                },
                tradingImplications: {
                    useWiderStops: volatility > 50,
                    reduceLeverage: beta > 1.5,
                    expectDrawdowns: maxDrawdown < -30
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: Sharpe ${sharpe.toFixed(2)}, Risk: ${riskLevel}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch quant metrics: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Token Correlation Data
 */
export const getCorrelationDataFunction = new GameFunction({
    name: "get_correlation_data",
    description: `Get correlation data between tokens and BTC/market.

    Understanding correlation helps with:
    - Portfolio diversification (low correlation = better diversification)
    - Risk management (high BTC correlation = moves with market)
    - Finding uncorrelated alpha opportunities

    Correlation ranges from -1 to 1:
    - 1.0: Moves exactly with BTC
    - 0.0: No relationship to BTC
    - -1.0: Moves opposite to BTC (rare in crypto)

    IMPORTANT: ~16 calls/day limit. Results cached 4 hours.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'ETH', 'SOL')"
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
                    note: "Configure TOKEN_METRICS_API_KEY for correlation data"
                })
            );
        }

        const cacheKey = `correlation:${args.symbol.toUpperCase()}`;
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
            logger(`Fetching correlation data for ${args.symbol}...`);

            // Try to get from quant metrics or dedicated endpoint
            const data = await callAPI('quantmetrics', { symbol: args.symbol.toUpperCase() });
            trackApiCall('correlation');

            const metricsData = Array.isArray(data) ? data[0] : (data as any)?.data?.[0] || data;

            const btcCorrelation = metricsData?.BTC_CORRELATION || metricsData?.btc_correlation ||
                metricsData?.BETA || metricsData?.beta || 0.8; // Default high correlation

            // Interpret correlation
            let correlationLevel: string;
            let diversificationValue: string;
            if (btcCorrelation > 0.8) {
                correlationLevel = 'VERY_HIGH';
                diversificationValue = 'LOW - Moves closely with BTC, limited diversification benefit';
            } else if (btcCorrelation > 0.6) {
                correlationLevel = 'HIGH';
                diversificationValue = 'MODERATE - Some diversification benefit';
            } else if (btcCorrelation > 0.3) {
                correlationLevel = 'MEDIUM';
                diversificationValue = 'GOOD - Meaningful diversification benefit';
            } else {
                correlationLevel = 'LOW';
                diversificationValue = 'EXCELLENT - Strong diversification benefit';
            }

            const result = {
                symbol: args.symbol.toUpperCase(),
                btcCorrelation: btcCorrelation,
                correlationLevel: correlationLevel,
                diversificationValue: diversificationValue,
                tradingImplications: {
                    inBullMarket: btcCorrelation > 0.7
                        ? 'Will likely rise with BTC - good for momentum'
                        : 'May outperform or underperform BTC independently',
                    inBearMarket: btcCorrelation > 0.7
                        ? 'Will likely fall with BTC - consider hedging'
                        : 'May provide some downside protection',
                    forPortfolio: btcCorrelation < 0.5
                        ? 'Good diversifier - add to portfolio'
                        : 'Limited diversification - already correlated to BTC'
                },
                timestamp: new Date().toISOString()
            };

            setCache(cacheKey, result);
            logger(`${args.symbol}: BTC Correlation ${btcCorrelation.toFixed(2)} (${correlationLevel})`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({ source: "tokenmetrics_sdk", ...result })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch correlation: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
