/**
 * Backtesting System
 * Tests strategies on real historical data with proper trade management
 */

import { OHLCV, TradingSignal } from './types';
import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import {
    calculateAllIndicators,
    generateMomentumSignal,
    generateMeanReversionSignal,
    analyzeMarketConditions
} from './indicators';
import { detectLiquiditySweep, detectMarketRegime } from './patterns';
import { getSessionScoreModifier, analyzeCurrentSession, isOptimalTradeWindow } from './sessions';

export interface TradeSetup {
    timestamp: string;
    strategy: 'momentum' | 'mean_reversion';
    entry: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    takeProfit3: number;
    signal: number; // Signal strength (0-100)
    reasoning: string[];
}

export interface TradeResult {
    setup: TradeSetup;
    outcome: 'win' | 'loss' | 'partial';
    exitPrice: number;
    exitReason: 'TP1' | 'TP2' | 'TP3' | 'STOP_LOSS' | 'TIMEOUT';
    pnl: number;
    pnlPercent: number;
    duration: number; // Candles held
}

/**
 * Generate a trade setup based on technical analysis
 */
export function generateTradeSetup(
    candles: OHLCV[],
    index: number,
    strategy: 'momentum' | 'mean_reversion'
): TradeSetup | null {
    // Need at least 30 candles before this point for indicators
    if (index < 30) return null;

    const recentCandles = candles.slice(Math.max(0, index - 30), index + 1);
    const prices = recentCandles.map(c => c.close);

    // Calculate indicators
    const indicators = calculateAllIndicators(prices);
    const conditions = analyzeMarketConditions(recentCandles, indicators);

    // Generate signal
    const momentumSignal = generateMomentumSignal(recentCandles, indicators);
    const meanReversionSignal = generateMeanReversionSignal(recentCandles, indicators);

    const signal = strategy === 'momentum' ? momentumSignal : meanReversionSignal;

    // Dynamic threshold based on strategy
    // Mean reversion works better at 65, momentum needs higher quality
    const threshold = strategy === 'mean_reversion' ? 65 : 75;
    if (signal < threshold) return null;

    const currentPrice = candles[index].close;
    let entry: number;
    let stopLoss: number;
    let tp1: number, tp2: number, tp3: number;
    const reasoning: string[] = [];

    if (strategy === 'momentum') {
        // Momentum setup: Enter on strength, use wider stops
        entry = currentPrice;

        // Stop loss: 3% below entry (widened from 2%)
        stopLoss = entry * 0.97;

        // Take profits: More realistic for 4h timeframe
        tp1 = entry * 1.01;   // 1% (reduced from 1.5%)
        tp2 = entry * 1.02;   // 2% (reduced from 3%)
        tp3 = entry * 1.035;  // 3.5% (reduced from 5%)

        reasoning.push(`Momentum setup with ${signal}/100 signal`);
        reasoning.push(`EMA: ${indicators.ema9 > indicators.ema21 ? 'Bullish alignment' : 'Testing crossover'}`);
        reasoning.push(`RSI: ${indicators.rsi.toFixed(1)} - ${indicators.rsi > 60 ? 'Strong momentum' : 'Building'}`);
        reasoning.push(`Trend: ${conditions.trend}, Volatility: ${conditions.volatility}`);

    } else {
        // Mean reversion setup: Enter at extremes, need even wider stops
        entry = currentPrice;

        // Stop loss: 4% below entry (widened from 3%)
        stopLoss = entry * 0.96;

        // Take profits: More realistic for mean reversion
        tp1 = entry * 1.015;  // 1.5% (reduced from 2%)
        tp2 = entry * 1.03;   // 3% (reduced from 4%)
        tp3 = entry * 1.045;  // 4.5% (reduced from 6%)

        reasoning.push(`Mean reversion setup with ${signal}/100 signal`);
        reasoning.push(`RSI: ${indicators.rsi.toFixed(1)} - ${indicators.rsi < 30 ? 'Oversold!' : 'Below mean'}`);
        reasoning.push(`BB Position: ${currentPrice < indicators.bollingerBands.lower * 1.02 ? 'Near lower band' : 'Reverting'}`);
        reasoning.push(`Trend: ${conditions.trend}, Volatility: ${conditions.volatility}`);
    }

    return {
        timestamp: candles[index].timestamp,
        strategy,
        entry,
        stopLoss,
        takeProfit1: tp1,
        takeProfit2: tp2,
        takeProfit3: tp3,
        signal,
        reasoning
    };
}

/**
 * Execute a trade setup on historical data and track the result
 */
export function executeTradeSetup(
    setup: TradeSetup,
    futureCandles: OHLCV[],
    maxHoldPeriod: number = 24 // Max candles to hold (24 hours for hourly data)
): TradeResult {
    let outcome: 'win' | 'loss' | 'partial' = 'loss';
    let exitPrice = setup.entry;
    let exitReason: 'TP1' | 'TP2' | 'TP3' | 'STOP_LOSS' | 'TIMEOUT' = 'TIMEOUT';
    let duration = 0;

    // Track which TPs have been hit
    let tp1Hit = false;
    let tp2Hit = false;

    // Simulate holding the position
    for (let i = 0; i < Math.min(futureCandles.length, maxHoldPeriod); i++) {
        const candle = futureCandles[i];
        duration = i + 1;

        // Check if stop loss was hit (using low of candle)
        if (candle.low <= setup.stopLoss) {
            outcome = tp1Hit || tp2Hit ? 'partial' : 'loss';
            exitPrice = setup.stopLoss;
            exitReason = 'STOP_LOSS';
            break;
        }

        // Check TP levels (using high of candle)
        if (!tp1Hit && candle.high >= setup.takeProfit1) {
            tp1Hit = true;
            // Partial profit taking - continue holding
        }

        if (!tp2Hit && candle.high >= setup.takeProfit2) {
            tp2Hit = true;
            // Take more profit - continue holding
        }

        if (candle.high >= setup.takeProfit3) {
            // TP3 hit - full exit
            outcome = 'win';
            exitPrice = setup.takeProfit3;
            exitReason = 'TP3';
            break;
        }

        // If only TP1 or TP2 hit and price is pulling back, exit there
        if (tp2Hit && candle.close < setup.takeProfit2 * 0.995) {
            outcome = 'win';
            exitPrice = setup.takeProfit2;
            exitReason = 'TP2';
            break;
        }

        if (tp1Hit && !tp2Hit && candle.close < setup.takeProfit1 * 0.995) {
            outcome = 'partial';
            exitPrice = setup.takeProfit1;
            exitReason = 'TP1';
            break;
        }
    }

    // If we reach max hold period without hitting any exits
    if (duration >= Math.min(futureCandles.length, maxHoldPeriod) && exitReason === 'TIMEOUT') {
        const lastCandle = futureCandles[Math.min(futureCandles.length - 1, maxHoldPeriod - 1)];
        exitPrice = lastCandle.close;

        if (tp1Hit || tp2Hit) {
            outcome = 'partial';
        } else if (exitPrice > setup.entry) {
            outcome = 'win';
        }
    }

    const pnl = exitPrice - setup.entry;
    const pnlPercent = (pnl / setup.entry) * 100;

    return {
        setup,
        outcome,
        exitPrice,
        exitReason,
        pnl,
        pnlPercent,
        duration
    };
}

/**
 * Run backtest on historical data
 */
export function runBacktest(
    candles: OHLCV[],
    strategy: 'momentum' | 'mean_reversion',
    signalThreshold: number = 70  // Increased to 70 - only take strongest setups
): TradeResult[] {
    const results: TradeResult[] = [];

    console.log(`\n🔄 Running backtest for ${strategy} strategy...`);
    console.log(`   Signal threshold: ${signalThreshold}/100`);
    console.log(`   Data points: ${candles.length} candles`);
    console.log(`   Period: ${candles[0].timestamp} to ${candles[candles.length - 1].timestamp}\n`);

    // Look for trade setups throughout the data
    for (let i = 30; i < candles.length - 24; i++) {
        const setup = generateTradeSetup(candles, i, strategy);

        if (!setup || setup.signal < signalThreshold) continue;

        // Get future candles to simulate trade execution
        const futureCandles = candles.slice(i + 1, i + 25); // Next 24 candles

        const result = executeTradeSetup(setup, futureCandles);
        results.push(result);

        // Skip ahead to avoid overlapping trades
        i += result.duration;
    }

    console.log(`✅ Backtest complete: ${results.length} trades executed\n`);

    return results;
}

/**
 * Calculate backtest statistics
 */
export function calculateBacktestStats(results: TradeResult[]) {
    const wins = results.filter(r => r.outcome === 'win').length;
    const losses = results.filter(r => r.outcome === 'loss').length;
    const partials = results.filter(r => r.outcome === 'partial').length;

    const winRate = results.length > 0 ? (wins / results.length) * 100 : 0;
    const totalPnl = results.reduce((sum, r) => sum + r.pnl, 0);
    const avgPnl = results.length > 0 ? totalPnl / results.length : 0;

    const avgWin = wins > 0
        ? results.filter(r => r.outcome === 'win').reduce((sum, r) => sum + r.pnl, 0) / wins
        : 0;

    const avgLoss = losses > 0
        ? Math.abs(results.filter(r => r.outcome === 'loss').reduce((sum, r) => sum + r.pnl, 0) / losses)
        : 0;

    const profitFactor = avgLoss > 0 ? (avgWin * wins) / (avgLoss * losses) : 0;

    return {
        totalTrades: results.length,
        wins,
        losses,
        partials,
        winRate: winRate.toFixed(1) + '%',
        totalPnl: totalPnl.toFixed(2),
        avgPnl: avgPnl.toFixed(2),
        avgWin: avgWin.toFixed(2),
        avgLoss: avgLoss.toFixed(2),
        profitFactor: profitFactor.toFixed(2),
        tp1Exits: results.filter(r => r.exitReason === 'TP1').length,
        tp2Exits: results.filter(r => r.exitReason === 'TP2').length,
        tp3Exits: results.filter(r => r.exitReason === 'TP3').length,
        stopLossExits: results.filter(r => r.exitReason === 'STOP_LOSS').length,
        timeoutExits: results.filter(r => r.exitReason === 'TIMEOUT').length
    };
}

// ============ GAME FUNCTIONS FOR AGENT USE ============

/**
 * Generate simulated OHLCV data for backtesting when real data unavailable
 */
function generateSimulatedOHLCV(symbol: string, count: number): OHLCV[] {
    const candles: OHLCV[] = [];
    let price = symbol === 'BTC' ? 95000 : symbol === 'ETH' ? 3500 : 100;
    let trend = 0;
    const volatility = symbol === 'BTC' ? 0.02 : symbol === 'ETH' ? 0.025 : 0.04;

    for (let i = 0; i < count; i++) {
        if (Math.random() < 0.05) trend = (Math.random() - 0.5) * 0.002;
        const change = (Math.random() - 0.5) * volatility + trend;
        const open = price;
        const close = price * (1 + change);
        const high = Math.max(open, close) * (1 + Math.random() * volatility * 0.5);
        const low = Math.min(open, close) * (1 - Math.random() * volatility * 0.5);
        candles.push({
            timestamp: new Date(Date.now() - (count - i) * 3600000).toISOString(),
            open, high, low, close,
            volume: 1000000 + Math.random() * 2000000
        });
        price = close;
    }
    return candles;
}

/**
 * Run backtest via GameFunction
 */
export const runBacktestFunction = new GameFunction({
    name: "run_backtest",
    description: `Run a backtest to validate a trading strategy on historical data.

    This helps you:
    1. Test strategy before risking real capital
    2. Find optimal parameters (stop loss, take profit)
    3. Understand win rate and profit factor
    4. Learn which setups work best

    Key Metrics:
    - Win Rate: % of profitable trades (target: >60%)
    - Profit Factor: Gross profits / Gross losses (target: >1.5)
    - Avg Win vs Avg Loss: How much you make vs lose per trade

    Use this BEFORE paper trading to validate your approach!`,
    args: [
        { name: "strategy", description: "Strategy: 'momentum' or 'mean_reversion'" },
        { name: "symbol", description: "Token symbol (e.g., 'BTC', 'ETH')" },
        { name: "signal_threshold", description: "Minimum signal strength 0-100 (default: 70)" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const strategy = (args.strategy || 'momentum') as 'momentum' | 'mean_reversion';
            const symbol = args.symbol?.toUpperCase() || 'BTC';
            const threshold = parseInt(args.signal_threshold || '70');

            logger(`Running ${strategy} backtest for ${symbol}...`);
            logger(`Signal threshold: ${threshold}/100`);

            // Generate simulated data (in production, fetch real OHLCV)
            const candles = generateSimulatedOHLCV(symbol, 500);

            // Run backtest
            const results = runBacktest(candles, strategy, threshold);
            const stats = calculateBacktestStats(results);

            logger(`\nBacktest Complete!`);
            logger(`  Trades: ${stats.totalTrades}`);
            logger(`  Win Rate: ${stats.winRate}`);
            logger(`  Profit Factor: ${stats.profitFactor}`);
            logger(`  Total PnL: $${stats.totalPnl}`);

            // Generate insights
            const insights: string[] = [];
            const winRateNum = parseFloat(stats.winRate);
            const pfNum = parseFloat(stats.profitFactor);

            if (winRateNum >= 60 && pfNum >= 1.5) {
                insights.push('✅ Strategy is VIABLE - consider paper trading');
            } else if (winRateNum >= 50 && pfNum >= 1.0) {
                insights.push('🟡 Strategy needs OPTIMIZATION - adjust parameters');
            } else {
                insights.push('⚠️ Strategy is UNDERPERFORMING - reconsider approach');
            }

            if (stats.stopLossExits > stats.tp3Exits * 2) {
                insights.push('Too many stop losses - consider wider stops or stricter entries');
            }

            if (stats.timeoutExits > stats.totalTrades * 0.3) {
                insights.push('Many time-based exits - strategy may lack momentum');
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    symbol,
                    strategy,
                    stats,
                    insights,
                    dataSource: 'SIMULATED - Use real data for production',
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Backtest failed: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Compare strategies via GameFunction
 */
export const compareStrategiesFunction = new GameFunction({
    name: "compare_strategies",
    description: `Compare momentum vs mean_reversion strategies to find the best one.

    Runs both strategies on same historical data and ranks them by:
    - Win rate
    - Profit factor
    - Total PnL

    Use this to decide which strategy to focus on!`,
    args: [
        { name: "symbol", description: "Token symbol (e.g., 'BTC', 'ETH')" }
    ] as const,
    executable: async (args, logger) => {
        try {
            const symbol = args.symbol?.toUpperCase() || 'BTC';
            logger(`Comparing strategies for ${symbol}...`);

            const candles = generateSimulatedOHLCV(symbol, 500);

            const strategies: ('momentum' | 'mean_reversion')[] = ['momentum', 'mean_reversion'];
            const comparisons: any[] = [];

            for (const strategy of strategies) {
                const results = runBacktest(candles, strategy, 70);
                const stats = calculateBacktestStats(results);

                const winRate = parseFloat(stats.winRate);
                const pf = parseFloat(stats.profitFactor);
                const score = winRate * 0.4 + pf * 30 + (stats.wins / Math.max(1, stats.totalTrades)) * 30;

                comparisons.push({
                    strategy,
                    trades: stats.totalTrades,
                    winRate: stats.winRate,
                    profitFactor: stats.profitFactor,
                    totalPnl: stats.totalPnl,
                    score: score.toFixed(0)
                });

                logger(`  ${strategy}: ${stats.winRate} win rate, ${stats.profitFactor} PF`);
            }

            // Sort by score
            comparisons.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));
            const best = comparisons[0];

            logger(`\nBest strategy: ${best.strategy}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    symbol,
                    ranking: comparisons,
                    recommendation: {
                        best: best.strategy,
                        reason: `Highest score (${best.score}) based on win rate and profit factor`,
                        action: `Focus paper trading on '${best.strategy}' strategy`
                    },
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Comparison failed: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get current session analysis for trading
 */
export const getSessionAnalysisFunction = new GameFunction({
    name: "get_session_analysis",
    description: `Get current trading session analysis including killzones and market opens.

    Helps you understand:
    1. Which global markets are open (Asian, London, NY)
    2. Whether you're in a high-probability trading window (killzone)
    3. When the next optimal trading window is
    4. Day-of-week trading characteristics

    Use this BEFORE trading to time your entries better!`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const session = analyzeCurrentSession();
            const isOptimal = isOptimalTradeWindow();
            const scoreModifier = getSessionScoreModifier();

            logger(`Current Session: ${session.currentSession}`);
            logger(`Active Killzone: ${session.activeKillzone || 'None'}`);
            logger(`Optimal Window: ${isOptimal ? 'YES' : 'NO'}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    ...session,
                    isOptimalWindow: isOptimal,
                    signalModifier: scoreModifier,
                    tradingAdvice: isOptimal
                        ? '🟢 Good time to trade - in killzone window'
                        : `🟡 Wait for ${session.nextKillzone} (${session.timeUntilNextKillzone})`,
                    timestamp: new Date().toISOString()
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Session analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
