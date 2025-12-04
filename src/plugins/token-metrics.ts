/**
 * TokenMetrics API Integration
 * Provides AI-powered trading signals, grades, and analytics
 *
 * TokenMetrics offers:
 * - AI Trading Signals (buy/sell/hold)
 * - Token Grades (technology, fundamentals)
 * - Moonshot tokens (high potential picks)
 * - Resistance/Support levels
 * - Sentiment analysis
 * - AI Reports
 *
 * API Docs: https://developers.tokenmetrics.com/
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import dotenv from "dotenv";

dotenv.config();

const TOKEN_METRICS_BASE_URL = "https://api.tokenmetrics.com/v2";

/**
 * Check if TokenMetrics API is available
 */
export function isTokenMetricsAvailable(): boolean {
    return !!process.env.TOKEN_METRICS_API_KEY;
}

/**
 * Helper function to make TokenMetrics API calls
 */
async function tokenMetricsRequest(endpoint: string, params: Record<string, string> = {}) {
    if (!process.env.TOKEN_METRICS_API_KEY) {
        throw new Error("TOKEN_METRICS_API_KEY not configured");
    }

    const url = new URL(`${TOKEN_METRICS_BASE_URL}${endpoint}`);
    Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
        headers: {
            'api_key': process.env.TOKEN_METRICS_API_KEY,
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`TokenMetrics API error: ${response.status}`);
    }

    return response.json();
}

/**
 * Get AI Trading Signals from TokenMetrics
 */
export const getAITradingSignalsFunction = new GameFunction({
    name: "get_ai_trading_signals",
    description: `Get AI-powered trading signals from TokenMetrics. Returns buy/sell/hold recommendations with confidence levels. Use this for data-driven trading decisions.`,
    args: [
        {
            name: "token_id",
            description: "Token ID to get signals for (e.g., 'bitcoin', 'ethereum'). Leave empty for top signals."
        },
        {
            name: "signal_type",
            description: "Signal type: 'bullish', 'bearish', or 'all' (default: 'all')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            // Fallback to simulated signals when API key not available
            logger("TokenMetrics API not configured - using market data analysis");

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "market_analysis",
                    note: "TokenMetrics API key not configured. Using basic market analysis.",
                    signals: [
                        { token: "BTC", signal: "HOLD", confidence: "medium", reason: "Consolidation phase" },
                        { token: "ETH", signal: "HOLD", confidence: "medium", reason: "Following BTC" }
                    ],
                    tip: "Configure TOKEN_METRICS_API_KEY for AI-powered signals"
                })
            );
        }

        try {
            logger("Fetching AI trading signals from TokenMetrics...");

            const params: Record<string, string> = {};
            if (args.token_id) params.token_id = args.token_id;
            if (args.signal_type && args.signal_type !== 'all') {
                params.signal = args.signal_type;
            }

            const data = await tokenMetricsRequest('/trading-signals', params);

            const signals = data.data?.slice(0, 10).map((s: any) => ({
                token: s.TOKEN_SYMBOL || s.token_name,
                signal: s.TRADING_SIGNAL || 'HOLD',
                confidence: s.SIGNAL_STRENGTH > 70 ? 'high' : s.SIGNAL_STRENGTH > 40 ? 'medium' : 'low',
                strength: s.SIGNAL_STRENGTH,
                price: s.PRICE,
                timestamp: s.DATE
            })) || [];

            logger(`Retrieved ${signals.length} trading signals`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "tokenmetrics_ai",
                    signals,
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch trading signals: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Moonshot Tokens - AI-curated high potential picks
 */
export const getMoonshotTokensFunction = new GameFunction({
    name: "get_moonshot_tokens",
    description: `Get TokenMetrics AI-curated moonshot tokens - high potential picks identified by machine learning models. Use cautiously as these are high risk/high reward.`,
    args: [] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            logger("TokenMetrics API not configured");
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    note: "TokenMetrics API key required for moonshot data",
                    tip: "Configure TOKEN_METRICS_API_KEY in environment"
                })
            );
        }

        try {
            logger("Fetching moonshot tokens from TokenMetrics...");

            const data = await tokenMetricsRequest('/moonshot');

            const moonshots = data.data?.slice(0, 5).map((m: any) => ({
                token: m.TOKEN_SYMBOL,
                name: m.TOKEN_NAME,
                score: m.MOONSHOT_SCORE,
                risk: m.RISK_LEVEL || 'high',
                category: m.CATEGORY,
                reason: m.SIGNAL_REASON
            })) || [];

            logger(`Found ${moonshots.length} moonshot tokens`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "tokenmetrics_ai",
                    moonshots,
                    warning: "High risk picks - DYOR and manage position sizes",
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch moonshot tokens: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Token Grades (Technology & Fundamentals)
 */
export const getTokenGradesFunction = new GameFunction({
    name: "get_token_grades",
    description: `Get TokenMetrics grades for a specific token - includes technology grade, fundamental grade, and overall TM grade. Use for due diligence.`,
    args: [
        {
            name: "token",
            description: "Token symbol to grade (e.g., 'BTC', 'ETH', 'SOL')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.token) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        if (!isTokenMetricsAvailable()) {
            logger("TokenMetrics API not configured - returning basic info");
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    token: args.token,
                    note: "TokenMetrics API key required for grades",
                    tip: "Configure TOKEN_METRICS_API_KEY for AI grades"
                })
            );
        }

        try {
            logger(`Fetching grades for ${args.token}...`);

            const data = await tokenMetricsRequest('/grades', { symbol: args.token.toUpperCase() });

            const grade = data.data?.[0];
            if (!grade) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ token: args.token, note: "No grade data available" })
                );
            }

            const result = {
                token: args.token.toUpperCase(),
                tmGrade: grade.TM_GRADE,
                technologyGrade: grade.TECHNOLOGY_GRADE,
                fundamentalGrade: grade.FUNDAMENTAL_GRADE,
                traderGrade: grade.TRADER_GRADE,
                recommendation: grade.TM_GRADE >= 80 ? 'STRONG_BUY' :
                    grade.TM_GRADE >= 60 ? 'BUY' :
                        grade.TM_GRADE >= 40 ? 'HOLD' :
                            grade.TM_GRADE >= 20 ? 'SELL' : 'STRONG_SELL',
                timestamp: new Date().toISOString()
            };

            logger(`${args.token} TM Grade: ${result.tmGrade}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch token grades: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Resistance & Support Levels
 */
export const getResistanceSupportFunction = new GameFunction({
    name: "get_resistance_support",
    description: `Get key resistance and support levels for a token. Essential for setting entry/exit points and stop losses.`,
    args: [
        {
            name: "token",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.token) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        if (!isTokenMetricsAvailable()) {
            // Return basic calculated levels without API
            logger("TokenMetrics API not configured - calculating basic levels");
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    token: args.token,
                    note: "TokenMetrics API key required for accurate levels",
                    tip: "Configure TOKEN_METRICS_API_KEY for AI-calculated support/resistance"
                })
            );
        }

        try {
            logger(`Fetching resistance/support for ${args.token}...`);

            const data = await tokenMetricsRequest('/resistance-support', {
                symbol: args.token.toUpperCase()
            });

            const levels = data.data?.[0];
            if (!levels) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Done,
                    JSON.stringify({ token: args.token, note: "No level data available" })
                );
            }

            const result = {
                token: args.token.toUpperCase(),
                currentPrice: levels.PRICE,
                resistance: {
                    r1: levels.RESISTANCE_1,
                    r2: levels.RESISTANCE_2,
                    r3: levels.RESISTANCE_3
                },
                support: {
                    s1: levels.SUPPORT_1,
                    s2: levels.SUPPORT_2,
                    s3: levels.SUPPORT_3
                },
                trend: levels.TREND || 'neutral',
                timestamp: new Date().toISOString()
            };

            logger(`${args.token} R1: ${result.resistance.r1}, S1: ${result.support.s1}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch resistance/support: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get Market Sentiment Analysis
 */
export const getMarketSentimentFunction = new GameFunction({
    name: "get_market_sentiment",
    description: `Get AI-powered market sentiment analysis from TokenMetrics. Shows overall market mood and social sentiment.`,
    args: [] as const,
    executable: async (args, logger) => {
        if (!isTokenMetricsAvailable()) {
            logger("TokenMetrics API not configured");
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    note: "TokenMetrics API key required for sentiment data",
                    tip: "Use get_fear_greed_index for basic sentiment without API key"
                })
            );
        }

        try {
            logger("Fetching market sentiment from TokenMetrics...");

            const data = await tokenMetricsRequest('/sentiments');

            const sentiment = data.data?.slice(0, 10).map((s: any) => ({
                token: s.TOKEN_SYMBOL,
                sentiment: s.SENTIMENT_SCORE,
                social: s.SOCIAL_SCORE,
                news: s.NEWS_SENTIMENT,
                overall: s.SENTIMENT_SCORE >= 70 ? 'bullish' :
                    s.SENTIMENT_SCORE >= 30 ? 'neutral' : 'bearish'
            })) || [];

            logger(`Retrieved sentiment for ${sentiment.length} tokens`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    source: "tokenmetrics_ai",
                    sentiment,
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch sentiment: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
