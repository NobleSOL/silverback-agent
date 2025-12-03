/**
 * Market Analysis Worker
 * Provides technical analysis and trading signals based on market data
 */

import { GameWorker, GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import {
    calculateAllIndicators,
    analyzeMarketConditions,
    generateMomentumSignal,
    generateMeanReversionSignal
} from '../market-data/indicators';
import { OHLCV, TradingSignal } from '../market-data/types';

/**
 * Analyze current market conditions and generate trading signal
 */
export const analyzeMarketFunction = new GameFunction({
    name: "analyze_market",
    description: "Analyze market conditions using technical indicators (EMA, RSI, Bollinger Bands) and generate trading signals for momentum and mean reversion strategies. Requires recent price data.",
    args: [
        {
            name: "priceData",
            description: "JSON array of recent prices (at least 30 data points for accurate analysis)"
        },
        {
            name: "volumeData",
            description: "JSON array of corresponding volume data (same length as priceData)"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            if (!args.priceData || !args.volumeData) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Missing required parameters: priceData and volumeData are required"
                );
            }

            logger(`\n📊 === MARKET ANALYSIS ===\n`);

            // Parse input data
            let prices: number[];
            let volumes: number[];

            try {
                prices = JSON.parse(args.priceData);
                volumes = JSON.parse(args.volumeData);
            } catch (e) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Invalid JSON format for priceData or volumeData"
                );
            }

            // Validate data
            if (!Array.isArray(prices) || !Array.isArray(volumes)) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "priceData and volumeData must be arrays"
                );
            }

            if (prices.length !== volumes.length) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "priceData and volumeData must have the same length"
                );
            }

            if (prices.length < 30) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `Need at least 30 data points for accurate analysis. Received: ${prices.length}`
                );
            }

            logger(`   Analyzing ${prices.length} data points...`);
            logger(`   Price range: $${Math.min(...prices).toFixed(2)} - $${Math.max(...prices).toFixed(2)}`);
            logger(`   Current price: $${prices[prices.length - 1].toFixed(2)}\n`);

            // Create OHLCV candles from price/volume data
            const candles: OHLCV[] = prices.map((price, i) => ({
                timestamp: new Date(Date.now() - (prices.length - i) * 3600000).toISOString(),
                open: i > 0 ? prices[i - 1] : price,
                high: price * 1.005, // Simulated high
                low: price * 0.995,  // Simulated low
                close: price,
                volume: volumes[i]
            }));

            // Calculate technical indicators
            logger(`📈 Calculating technical indicators...\n`);
            const indicators = calculateAllIndicators(prices);

            logger(`   EMA (9-period): $${indicators.ema9.toFixed(2)}`);
            logger(`   EMA (21-period): $${indicators.ema21.toFixed(2)}`);
            logger(`   EMA Alignment: ${indicators.ema9 > indicators.ema21 ? '✅ Bullish' : '⚠️ Bearish'}\n`);

            logger(`   RSI (14-period): ${indicators.rsi.toFixed(2)}`);
            if (indicators.rsi > 70) {
                logger(`   RSI Status: 🔴 Overbought`);
            } else if (indicators.rsi < 30) {
                logger(`   RSI Status: 🟢 Oversold`);
            } else {
                logger(`   RSI Status: 🟡 Neutral\n`);
            }

            logger(`   Bollinger Bands:`);
            logger(`      Upper: $${indicators.bollingerBands.upper.toFixed(2)}`);
            logger(`      Middle: $${indicators.bollingerBands.middle.toFixed(2)}`);
            logger(`      Lower: $${indicators.bollingerBands.lower.toFixed(2)}\n`);

            // Analyze market conditions
            logger(`🌡️  Analyzing market conditions...\n`);
            const conditions = analyzeMarketConditions(candles, indicators);

            logger(`   Trend: ${conditions.trend === 'up' ? '📈 Uptrend' : conditions.trend === 'down' ? '📉 Downtrend' : '➡️ Sideways'}`);
            logger(`   Volatility: ${conditions.volatility === 'high' ? '🔥 High' : conditions.volatility === 'medium' ? '🌡️ Medium' : '❄️ Low'}`);
            logger(`   Volume: ${conditions.volume === 'increasing' ? '📈 Increasing' : conditions.volume === 'decreasing' ? '📉 Decreasing' : '➡️ Stable'}`);
            logger(`   Momentum: ${conditions.momentum === 'bullish' ? '🟢 Bullish' : conditions.momentum === 'bearish' ? '🔴 Bearish' : '🟡 Neutral'}\n`);

            // Generate strategy signals
            logger(`🎯 Generating trading signals...\n`);

            const momentumSignal = generateMomentumSignal(candles, indicators);
            const meanReversionSignal = generateMeanReversionSignal(candles, indicators);

            logger(`   Momentum Strategy: ${momentumSignal}/100`);
            logger(`   Mean Reversion Strategy: ${meanReversionSignal}/100\n`);

            // Determine best strategy and action
            const currentPrice = prices[prices.length - 1];
            let recommendedStrategy: 'momentum' | 'mean_reversion';
            let action: 'buy' | 'sell' | 'hold';
            let confidence: number;
            let reasoning: string[] = [];

            if (momentumSignal > meanReversionSignal && momentumSignal >= 55) {
                recommendedStrategy = 'momentum';
                action = 'buy';
                confidence = momentumSignal;
                reasoning.push(`Momentum signal (${momentumSignal}/100) stronger than mean reversion`);

                if (indicators.ema9 > indicators.ema21) {
                    reasoning.push(`Bullish EMA alignment (9 > 21)`);
                }
                if (indicators.rsi > 40 && indicators.rsi < 70) {
                    reasoning.push(`RSI in favorable range (${indicators.rsi.toFixed(1)})`);
                }
                if (conditions.volume === 'increasing') {
                    reasoning.push(`Volume confirming trend`);
                }
            } else if (meanReversionSignal >= 55) {
                recommendedStrategy = 'mean_reversion';
                action = 'buy';
                confidence = meanReversionSignal;
                reasoning.push(`Mean reversion signal (${meanReversionSignal}/100) indicates oversold condition`);

                if (indicators.rsi < 30) {
                    reasoning.push(`RSI oversold (${indicators.rsi.toFixed(1)} < 30)`);
                }
                if (currentPrice < indicators.bollingerBands.lower * 1.02) {
                    reasoning.push(`Price near lower Bollinger Band`);
                }
                reasoning.push(`Good mean reversion opportunity`);
            } else {
                recommendedStrategy = momentumSignal > meanReversionSignal ? 'momentum' : 'mean_reversion';
                action = 'hold';
                confidence = Math.max(momentumSignal, meanReversionSignal);
                reasoning.push(`No strong signal detected (momentum: ${momentumSignal}, mean_reversion: ${meanReversionSignal})`);
                reasoning.push(`Wait for clearer setup`);
            }

            logger(`\n🎯 === RECOMMENDATION ===\n`);
            logger(`   Strategy: ${recommendedStrategy.toUpperCase()}`);
            logger(`   Action: ${action.toUpperCase()}`);
            logger(`   Confidence: ${confidence}/100`);
            logger(`   Reasoning:`);
            reasoning.forEach((reason, i) => {
                logger(`      ${i + 1}. ${reason}`);
            });
            logger(`\n=== END ANALYSIS ===\n`);

            const signal: TradingSignal = {
                strategy: recommendedStrategy,
                action,
                confidence,
                reasoning,
                indicators,
                conditions
            };

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(signal, null, 2)
            );

        } catch (e) {
            const error = e as Error;
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Market analysis failed: ${error.message}`
            );
        }
    }
});

/**
 * Market Analysis Worker
 * Provides technical analysis and trading signals
 */
export const marketAnalysisWorker = new GameWorker({
    id: "market_analysis_worker",
    name: "Market Analysis Worker",
    description: `Analyze market conditions using professional technical analysis and generate trading signals.

    Capabilities:
    1. Calculate technical indicators (EMA, RSI, Bollinger Bands)
    2. Analyze market conditions (trend, volatility, volume, momentum)
    3. Generate strategy-specific signals (momentum vs mean reversion)
    4. Provide actionable trading recommendations with confidence scores

    Use this worker to:
    - Determine if market conditions favor momentum or mean reversion strategy
    - Get buy/sell/hold recommendations with detailed reasoning
    - Understand current technical setup before placing trades
    - Validate trading ideas with multiple indicators
    - Identify optimal entry points based on technical analysis

    Analysis includes:
    - EMA (9 & 21 period) for trend identification
    - RSI (14 period) for overbought/oversold conditions
    - Bollinger Bands (20 period, 2 std dev) for mean reversion signals
    - Volume analysis for confirmation
    - Market condition assessment (trend, volatility, momentum)
    - Strategy-specific signal generation (0-100 confidence scores)

    IMPORTANT: All analysis is based on technical indicators only. Always combine with risk management and position sizing rules.`,

    functions: [analyzeMarketFunction]
});
