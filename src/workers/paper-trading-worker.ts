/**
 * Paper Trading Worker
 * Simulates trades to test strategies and learn patterns without risking real funds
 */

import { GameWorker, GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { stateManager } from '../state/state-manager';
import { getSwapQuoteFunction, analyzeTradeOpportunityFunction } from '../trading-functions';
import { Trade, TokenMetricsSignal } from '../types/agent-state';
import {
    calculateAllIndicators,
    generateMomentumSignal,
    generateMeanReversionSignal,
    analyzeMarketConditions
} from '../market-data/indicators';
import { OHLCV } from '../market-data/types';
import {
    getAITradingSignalsFunction,
    getTokenGradesFunction,
    getResistanceSupportFunction,
    getPricePredictionsFunction,
    getHourlySignalsFunction,
    askAIAgentFunction,
    getMoonshotTokensFunction,
    getHourlyOHLCVFunction,
    getDailyOHLCVFunction,
    getMarketMetricsFunction,
    isTokenMetricsAvailable,
    getApiUsageStats,
    getInvestorGradeFunction,
    getAIIndicesFunction,
    getQuantMetricsFunction,
    getCorrelationDataFunction
} from '../plugins/token-metrics';
// NEW: Import enhanced modules for better learning
import {
    analyzeCurrentSession,
    isOptimalTradeWindow,
    getSessionScoreModifier,
    getSessionBias,
    getDayOfWeekBias
} from '../market-data/sessions';
import {
    getOnChainAnalysisFunction,
    getWhaleAlertsFunction,
    getFundingRatesFunction,
    getOpenInterestFunction
} from '../market-data/onchain-analytics';
import {
    runBacktestFunction,
    compareStrategiesFunction,
    getSessionAnalysisFunction
} from '../market-data/backtest';

// Token symbol mapping for common addresses
const TOKEN_SYMBOLS: Record<string, string> = {
    '0x4200000000000000000000000000000000000006': 'WETH',
    '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
    // Add more as needed
};

/**
 * Get TM signal for a trade (uses cache if available)
 */
async function getTMSignalForTrade(tokenAddress: string, logger: (msg: string) => void): Promise<TokenMetricsSignal | null> {
    if (!isTokenMetricsAvailable()) {
        return null;
    }

    // Map address to symbol (default to unknown)
    const symbol = TOKEN_SYMBOLS[tokenAddress.toLowerCase()] || 'BTC';

    try {
        // First try to get trading signals
        const signalsResult = await getAITradingSignalsFunction.executable({ symbol }, logger);
        if (signalsResult.status === ExecutableGameFunctionStatus.Done) {
            const data = JSON.parse(signalsResult.feedback);
            if (data.signals && data.signals.length > 0) {
                const signal = data.signals[0];
                return {
                    signal: signal.signal === 'LONG' || signal.signal === 'BUY' ? 'LONG' :
                           signal.signal === 'SHORT' || signal.signal === 'SELL' ? 'SHORT' : 'HOLD',
                    confidence: signal.confidence || 50,
                    traderGrade: signal.grade || 50,
                    aligned: false // Will be set based on trade direction
                };
            }
        }

        // Fallback: try to get grades
        const gradesResult = await getTokenGradesFunction.executable({ symbol }, logger);
        if (gradesResult.status === ExecutableGameFunctionStatus.Done) {
            const data = JSON.parse(gradesResult.feedback);
            if (data.traderGrade) {
                return {
                    signal: data.traderGrade >= 60 ? 'LONG' : data.traderGrade <= 40 ? 'SHORT' : 'HOLD',
                    confidence: data.traderGrade || 50,
                    traderGrade: data.traderGrade || 50,
                    aligned: false
                };
            }
        }
    } catch (e) {
        logger(`⚠️  Could not fetch TM signal: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }

    return null;
}

/**
 * Simulate a paper trade - execute fake trade and record results for learning
 */
export const simulateTradeFunction = new GameFunction({
    name: "simulate_trade",
    description: "Execute a paper trade (no real money) and record results for learning. Use this to test trading strategies safely and build experience before live trading.",
    args: [
        {
            name: "strategy",
            description: "Strategy name: 'momentum' or 'mean_reversion'"
        },
        {
            name: "tokenIn",
            description: "Input token address (0x format, use 0x4200000000000000000000000000000000000006 for WETH on Base)"
        },
        {
            name: "tokenOut",
            description: "Output token address (0x format)"
        },
        {
            name: "amountIn",
            description: "Amount to trade in human-readable format (e.g., '0.1' for 0.1 ETH)"
        },
        {
            name: "reasoning",
            description: "Why this trade was chosen - will be recorded as a lesson"
        }
    ] as const,
    executable: async (args, logger) => {
        try {
            // Validate required arguments
            if (!args.strategy || !args.tokenIn || !args.tokenOut || !args.amountIn || !args.reasoning) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    "Missing required parameters: strategy, tokenIn, tokenOut, amountIn, reasoning"
                );
            }

            // Validate strategy
            if (!['momentum', 'mean_reversion'].includes(args.strategy)) {
                return new ExecutableGameFunctionResponse(
                    ExecutableGameFunctionStatus.Failed,
                    `Invalid strategy '${args.strategy}'. Must be 'momentum' or 'mean_reversion'`
                );
            }

            // Check current state to see strategy performance
            const currentState = stateManager.getState();
            const strategyStats = currentState.strategies.find(s => s.strategyName === args.strategy);

            logger(`📊 Current ${args.strategy} performance:`);
            logger(`   Trades: ${strategyStats?.trades || 0}`);
            logger(`   Win Rate: ${((strategyStats?.winRate || 0) * 100).toFixed(1)}%`);
            logger(`   Total PnL: $${(strategyStats?.totalPnL || 0).toFixed(2)}`);

            // Try to get real swap quote from Silverback DEX, fall back to simulated data
            logger(`\n💱 Getting swap quote...`);
            let quote: any;
            let useSimulatedQuote = false;

            const quoteResult = await getSwapQuoteFunction.executable({
                tokenIn: args.tokenIn,
                tokenOut: args.tokenOut,
                amountIn: args.amountIn
            }, logger);

            if (quoteResult.status === ExecutableGameFunctionStatus.Failed) {
                // No real liquidity available - use simulated quote for paper trading
                logger(`   ⚠️  Real quote unavailable, using simulated data for paper trade`);
                useSimulatedQuote = true;

                const amountInNum = parseFloat(args.amountIn);
                const simulatedOut = amountInNum * 0.997; // Assume 0.3% fee

                quote = {
                    amountOut: simulatedOut.toFixed(6),
                    priceImpact: '0.15%',
                    fee: '0.3%',
                    chain: 'SIMULATED'
                };
            } else {
                quote = JSON.parse(quoteResult.feedback);
            }

            logger(`   Expected out: ${quote.amountOut}`);
            logger(`   Price impact: ${quote.priceImpact}`);
            logger(`   Liquidity fee: ${quote.fee}${useSimulatedQuote ? ' (simulated)' : ''}`);

            // Fetch Token Metrics signal for comparison (if available)
            logger(`\n🤖 Checking Token Metrics AI signal...`);
            let tmSignal: TokenMetricsSignal | null = null;
            const tmUsage = getApiUsageStats();

            if (tmUsage.remaining > 0) {
                tmSignal = await getTMSignalForTrade(args.tokenOut, logger);
                if (tmSignal) {
                    // For momentum strategy, we're going LONG (buying)
                    // For mean reversion, depends on the setup
                    const tradeDirection = args.strategy === 'momentum' ? 'LONG' : 'LONG';
                    tmSignal.aligned = tmSignal.signal === tradeDirection || tmSignal.signal === 'HOLD';

                    logger(`   TM Signal: ${tmSignal.signal}`);
                    logger(`   TM Confidence: ${tmSignal.confidence}`);
                    logger(`   TM Trader Grade: ${tmSignal.traderGrade}`);
                    logger(`   Aligned with trade: ${tmSignal.aligned ? '✅ YES' : '❌ NO'}`);
                } else {
                    logger(`   No TM signal available (using internal analysis only)`);
                }
            } else {
                logger(`   TM API limit reached (${tmUsage.callsToday}/${tmUsage.dailyLimit}), skipping signal check`);
            }

            // Simulate execution with realistic slippage
            const baseSlippage = Math.random() * 0.5; // Random 0-0.5% slippage
            const priceImpact = parseFloat(quote.priceImpact.replace('%', ''));
            const totalSlippage = baseSlippage + (priceImpact / 2); // Price impact affects slippage

            const actualOut = parseFloat(quote.amountOut) * (1 - totalSlippage / 100);

            logger(`\n🎲 Simulating execution...`);
            logger(`   Base slippage: ${baseSlippage.toFixed(2)}%`);
            logger(`   Total slippage: ${totalSlippage.toFixed(2)}%`);
            logger(`   Actual out: ${actualOut.toFixed(6)}`);

            // Generate realistic price history for technical analysis (30 points)
            logger(`\n📊 Generating price history for technical analysis...`);
            const basePrice = 100; // Base price for simulation
            const trendStrength = Math.random() * 0.4 - 0.2; // -20% to +20% trend
            const prices: number[] = [];
            const volumes: number[] = [];

            for (let i = 0; i < 30; i++) {
                const trend = basePrice * (1 + (trendStrength * i / 30));
                const noise = (Math.random() - 0.5) * 2; // +/- 1% noise
                prices.push(trend + noise);
                volumes.push(1000000 + Math.random() * 500000);
            }

            // Create OHLCV candles
            const candles: OHLCV[] = prices.map((price, i) => ({
                timestamp: new Date(Date.now() - (30 - i) * 3600000).toISOString(),
                open: i > 0 ? prices[i - 1] : price,
                high: price * 1.005,
                low: price * 0.995,
                close: price,
                volume: volumes[i]
            }));

            // Calculate technical indicators
            const indicators = calculateAllIndicators(prices);
            const conditions = analyzeMarketConditions(candles, indicators);

            logger(`   EMA 9: ${indicators.ema9.toFixed(2)}`);
            logger(`   EMA 21: ${indicators.ema21.toFixed(2)}`);
            logger(`   RSI: ${indicators.rsi.toFixed(1)}`);
            logger(`   Trend: ${conditions.trend}`);
            logger(`   Momentum: ${conditions.momentum}`);

            // Generate strategy-specific signals
            const momentumSignal = generateMomentumSignal(candles, indicators);
            const meanReversionSignal = generateMeanReversionSignal(candles, indicators);

            logger(`   Momentum Signal: ${momentumSignal}/100`);
            logger(`   Mean Reversion Signal: ${meanReversionSignal}/100`);

            // Determine win probability based on technical analysis
            let winProbability = 0.5; // Base 50% chance
            let signal = 0;

            if (args.strategy === 'momentum') {
                signal = momentumSignal;
                // Strong momentum signal = higher win probability
                if (signal >= 70) {
                    winProbability = 0.85; // 85% win rate with strong signal
                } else if (signal >= 60) {
                    winProbability = 0.75; // 75% with good signal
                } else if (signal >= 55) {
                    winProbability = 0.65; // 65% with decent signal
                } else {
                    winProbability = 0.45; // Below 55 = poor setup, lower odds
                }
            } else if (args.strategy === 'mean_reversion') {
                signal = meanReversionSignal;
                // Strong mean reversion signal = higher win probability
                if (signal >= 70) {
                    winProbability = 0.80; // 80% win rate with strong signal
                } else if (signal >= 60) {
                    winProbability = 0.70; // 70% with good signal
                } else if (signal >= 55) {
                    winProbability = 0.60; // 60% with decent signal
                } else {
                    winProbability = 0.40; // Below 55 = poor setup, lower odds
                }
            }

            logger(`\n🎯 Trade Setup:`);
            logger(`   Strategy: ${args.strategy}`);
            logger(`   Signal Strength: ${signal}/100`);
            logger(`   Win Probability: ${(winProbability * 100).toFixed(0)}%`);

            // Determine outcome based on calculated probability
            const outcome: 'win' | 'loss' = Math.random() < winProbability ? 'win' : 'loss';

            // Calculate PnL (simplified - assumes we sell immediately)
            const amountInNum = parseFloat(args.amountIn);
            let pnl: number;

            if (outcome === 'win') {
                // Win: Price moved favorably, let's say 0.5-2% gain
                const gainPercent = 0.5 + (Math.random() * 1.5);
                pnl = amountInNum * (gainPercent / 100);
            } else {
                // Loss: Price moved against us, or hit stop loss
                const lossPercent = 0.3 + (Math.random() * 0.7); // 0.3-1% loss
                pnl = -amountInNum * (lossPercent / 100);
            }

            logger(`\n📈 Trade result: ${outcome.toUpperCase()}`);
            logger(`   PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`);

            // Build lessons array including TM signal alignment analysis
            const lessonsArray = [
                args.reasoning,
                `Technical Analysis: ${args.strategy === 'momentum' ? 'Momentum' : 'Mean Reversion'} signal = ${signal}/100`,
                `Indicators: EMA ${indicators.ema9 > indicators.ema21 ? 'bullish' : 'bearish'}, RSI ${indicators.rsi.toFixed(0)}, Trend ${conditions.trend}`,
                outcome === 'win'
                    ? `✅ WIN: Strong ${signal >= 60 ? 'technical setup' : 'lucky'} - ${conditions.trend} trend, ${conditions.volatility} volatility`
                    : `❌ LOSS: ${signal < 55 ? 'Weak signal' : 'Market unpredictability'} - Review indicators before similar setups`
            ];

            // Add TM signal lesson if available
            if (tmSignal) {
                const tmLesson = tmSignal.aligned
                    ? outcome === 'win'
                        ? `🤖 TM ALIGNED ✅ WIN: Following TM ${tmSignal.signal} signal (grade: ${tmSignal.traderGrade}) was correct!`
                        : `🤖 TM ALIGNED ❌ LOSS: TM signal was ${tmSignal.signal} but market moved against us`
                    : outcome === 'win'
                        ? `🤖 TM DIVERGED ✅ WIN: Traded against TM ${tmSignal.signal} signal and won - market timing beat AI`
                        : `🤖 TM DIVERGED ❌ LOSS: Ignored TM ${tmSignal.signal} signal (grade: ${tmSignal.traderGrade}) - should have followed?`;
                lessonsArray.push(tmLesson);
            }

            // Record the trade with technical analysis insights and TM signal
            const trade: Trade = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                strategy: args.strategy,
                tokenIn: args.tokenIn,
                tokenOut: args.tokenOut,
                amountIn: amountInNum,
                amountOut: actualOut,
                expectedOut: parseFloat(quote.amountOut),
                slippage: totalSlippage,
                priceImpact: priceImpact,
                outcome: outcome,
                pnl: pnl,
                marketConditions: {
                    volatility: conditions.volatility,
                    liquidityRating: quote.chain || 'GOOD',
                    trend: conditions.trend
                },
                lessons: lessonsArray,
                tmSignal: tmSignal || undefined
            };

            logger(`\n💾 Recording trade to database...`);
            await stateManager.recordTrade(trade);

            // Get updated metrics
            const updatedState = stateManager.getState();
            const updatedStrategy = updatedState.strategies.find(s => s.strategyName === args.strategy);

            logger(`\n✅ Trade recorded successfully!`);
            logger(`\n📊 Updated performance:`);
            logger(`   Total Trades: ${updatedState.metrics.totalTrades}`);
            logger(`   Overall Win Rate: ${(updatedState.metrics.winRate * 100).toFixed(1)}%`);
            logger(`   Total PnL: $${updatedState.metrics.totalPnL.toFixed(2)}`);
            logger(`\n📈 ${args.strategy} strategy:`);
            logger(`   Trades: ${updatedStrategy?.trades}`);
            logger(`   Win Rate: ${((updatedStrategy?.winRate || 0) * 100).toFixed(1)}%`);
            logger(`   PnL: $${(updatedStrategy?.totalPnL || 0).toFixed(2)}`);

            // Calculate TM signal accuracy from recent trades
            const tradesWithTM = updatedState.recentTrades.filter(t => t.tmSignal);
            const tmAlignedTrades = tradesWithTM.filter(t => t.tmSignal?.aligned);
            const tmAlignedWins = tmAlignedTrades.filter(t => t.outcome === 'win').length;
            const tmNonAlignedTrades = tradesWithTM.filter(t => !t.tmSignal?.aligned);
            const tmNonAlignedWins = tmNonAlignedTrades.filter(t => t.outcome === 'win').length;

            const tmAccuracy = tradesWithTM.length > 0 ? {
                tradesWithSignal: tradesWithTM.length,
                alignedTrades: tmAlignedTrades.length,
                alignedWinRate: tmAlignedTrades.length > 0
                    ? ((tmAlignedWins / tmAlignedTrades.length) * 100).toFixed(1) + '%'
                    : 'N/A',
                nonAlignedWinRate: tmNonAlignedTrades.length > 0
                    ? ((tmNonAlignedWins / tmNonAlignedTrades.length) * 100).toFixed(1) + '%'
                    : 'N/A',
                recommendation: tmAlignedTrades.length >= 5 && tmAlignedWins / tmAlignedTrades.length > 0.6
                    ? 'Following TM signals is working well!'
                    : 'Need more data to evaluate TM signal accuracy'
            } : null;

            if (tmAccuracy) {
                logger(`\n🤖 Token Metrics Signal Accuracy:`);
                logger(`   Trades with TM signal: ${tmAccuracy.tradesWithSignal}`);
                logger(`   Aligned with TM: ${tmAccuracy.alignedTrades}`);
                logger(`   Aligned win rate: ${tmAccuracy.alignedWinRate}`);
                logger(`   Non-aligned win rate: ${tmAccuracy.nonAlignedWinRate}`);
            }

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    success: true,
                    trade: {
                        id: trade.id,
                        strategy: trade.strategy,
                        outcome: trade.outcome,
                        pnl: pnl.toFixed(2),
                        slippage: totalSlippage.toFixed(2) + '%',
                        tmSignalAligned: tmSignal?.aligned ?? 'no_signal'
                    },
                    currentMetrics: {
                        totalTrades: updatedState.metrics.totalTrades,
                        winRate: (updatedState.metrics.winRate * 100).toFixed(1) + '%',
                        totalPnL: '$' + updatedState.metrics.totalPnL.toFixed(2)
                    },
                    strategyMetrics: {
                        strategy: args.strategy,
                        trades: updatedStrategy?.trades,
                        winRate: ((updatedStrategy?.winRate || 0) * 100).toFixed(1) + '%',
                        pnl: '$' + (updatedStrategy?.totalPnL || 0).toFixed(2)
                    },
                    tmSignalAccuracy: tmAccuracy
                }, null, 2)
            );

        } catch (e) {
            const error = e as Error;
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Paper trade failed: ${error.message}`
            );
        }
    }
});

/**
 * Paper Trading Worker
 * Handles simulated trading for learning and strategy testing
 * ENHANCED with session awareness, on-chain analytics, and backtesting
 */
export const paperTradingWorker = new GameWorker({
    id: "paper_trading_worker",
    name: "Paper Trading Worker",
    description: `Execute simulated trades to learn and improve strategies without risking real funds.

    This worker is for TESTING AND LEARNING ONLY - no real money is used.

    ╔═══════════════════════════════════════════════════════════════════╗
    ║                    ENHANCED LEARNING TOOLKIT                       ║
    ╚═══════════════════════════════════════════════════════════════════╝

    === NEW: SESSION-BASED TRADING (ICT Killzones) ===

    ALWAYS check session before trading:
    - get_session_analysis: See if you're in a high-probability window
    - London Open (07:00-10:00 UTC): Best for Asian range sweeps
    - NY Open (12:00-15:00 UTC): Best for London range sweeps
    - AVOID trading outside killzones for better win rate!

    === NEW: ON-CHAIN ANALYTICS ===

    Check whale behavior before trading:
    - get_onchain_analysis: See if whales are accumulating or distributing
    - get_whale_alerts: Spot large transactions moving to/from exchanges
    - get_funding_rates: Check if market is overleveraged (contrarian signal!)
    - get_open_interest: Understand market positioning

    === NEW: BACKTESTING ===

    Validate strategies before paper trading:
    - run_backtest: Test strategy on historical data
    - compare_strategies: Find which strategy works best

    === NEW: ADVANCED TOKEN METRICS ===

    - get_investor_grade: Long-term fundamental assessment
    - get_quant_metrics: Sharpe ratio, max drawdown, risk metrics
    - get_correlation_data: BTC correlation for diversification
    - get_ai_indices: AI model portfolios for allocation ideas

    === TOKEN METRICS INTEGRATION ===

    Core signals for 70% win rate:
    - get_ai_trading_signals: AI buy/sell/hold recommendations
    - get_token_grades: Technology and fundamental grades
    - get_resistance_support: Key price levels
    - IMPORTANT: ~16 calls/day limit. Results cached 4 hours.

    === OPTIMAL TRADING WORKFLOW ===

    BEFORE EACH TRADE:
    1. 📊 get_session_analysis → Am I in a killzone?
    2. 🐋 get_onchain_analysis → Are whales buying or selling?
    3. 💹 get_funding_rates → Is market overleveraged?
    4. 🤖 get_ai_trading_signals → What does TM recommend?
    5. 📈 analyze_trade_opportunity → Check my historical performance

    ONLY TRADE WHEN:
    - In a killzone window (session timing good)
    - Whales are accumulating (on-chain bullish)
    - Funding not extreme (no crowded trade)
    - Token Metrics agrees with direction

    Then: simulate_trade and LEARN from the outcome!

    === STRATEGIES ===

    - Momentum: Use in uptrends with session timing
    - Mean Reversion: Use at liquidity sweeps during killzones
    - Session Sweep: Trade Asian/London sweeps during opens

    === LEARNING EVOLUTION ===

    Phase 1 (0-50 trades): Use Token Metrics + Session timing
    Phase 2 (50-100 trades): Add on-chain confirmation
    Phase 3 (100+ trades): Full system integration
    Target: 70% win rate through systematic learning

    IMPORTANT: All trades are PRIVATE. Never share trade details publicly.`,

    functions: [
        // NEW: Session & Timing Analysis
        getSessionAnalysisFunction,           // Check killzones and market sessions

        // NEW: On-Chain Analytics
        getOnChainAnalysisFunction,           // Whale behavior + exchange flows
        getWhaleAlertsFunction,               // Large transaction alerts
        getFundingRatesFunction,              // Futures market positioning
        getOpenInterestFunction,              // Leverage analysis

        // NEW: Backtesting
        runBacktestFunction,                  // Validate strategy on historical data
        compareStrategiesFunction,            // Compare multiple strategies

        // Token Metrics AI signals (use for 70% win rate!)
        ...(isTokenMetricsAvailable() ? [
            getAITradingSignalsFunction,      // LONG/SHORT signals
            getTokenGradesFunction,           // TM grades (0-100)
            getResistanceSupportFunction,     // Entry/exit zones
            getPricePredictionsFunction,      // AI price targets
            getHourlySignalsFunction,         // Frequent signals
            getHourlyOHLCVFunction,           // Hourly candles
            getDailyOHLCVFunction,            // Daily candles
            getMarketMetricsFunction,         // Market sentiment
            askAIAgentFunction,               // Ask TM AI
            getMoonshotTokensFunction,        // High potential picks
            // NEW: Advanced Token Metrics
            getInvestorGradeFunction,         // Long-term fundamentals
            getQuantMetricsFunction,          // Risk metrics (Sharpe, drawdown)
            getCorrelationDataFunction,       // BTC correlation
            getAIIndicesFunction              // Model portfolios
        ] : []),

        // Your analysis and execution
        analyzeTradeOpportunityFunction,
        simulateTradeFunction
    ]
});
