/**
 * Learning Worker
 * Analyzes trading performance and generates insights for continuous improvement
 */

import { GameWorker, GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { stateManager } from '../state/state-manager';
import { SilverbackState } from '../types/agent-state';

/**
 * Generate recommendations based on current performance
 */
function generateRecommendations(state: SilverbackState): string[] {
    const recs: string[] = [];

    // Overall performance assessment
    if (state.metrics.totalTrades > 10) {
        const targetWinRate = 0.70; // 70% target
        if (state.metrics.winRate >= targetWinRate) {
            recs.push(`🎯 TARGET ACHIEVED: ${(state.metrics.winRate * 100).toFixed(1)}% win rate exceeds 70% target!`);
        } else if (state.metrics.winRate >= 0.60) {
            recs.push(`📈 Good progress: ${(state.metrics.winRate * 100).toFixed(1)}% win rate. Continue refining to reach 70% target.`);
        } else if (state.metrics.winRate >= 0.50) {
            recs.push(`⚠️  Below target: ${(state.metrics.winRate * 100).toFixed(1)}% win rate. Analyze losing trades and adjust strategy.`);
        } else {
            recs.push(`🚨 Underperforming: ${(state.metrics.winRate * 100).toFixed(1)}% win rate. Consider pausing and reviewing approach.`);
        }
    }

    // Strategy-specific recommendations
    const activeStrategies = state.strategies.filter(s => s.trades > 5);

    if (activeStrategies.length > 0) {
        const best = activeStrategies.reduce((a, b) => a.winRate > b.winRate ? a : b);
        const worst = activeStrategies.reduce((a, b) => a.winRate < b.winRate ? a : b);

        if (best.winRate > 0.65) {
            recs.push(`✅ FOCUS: ${best.strategyName} strategy has ${(best.winRate * 100).toFixed(0)}% win rate - use this more often`);
        }

        if (worst.winRate < 0.45 && worst.trades > 10) {
            recs.push(`⏸️  PAUSE: ${worst.strategyName} strategy only ${(worst.winRate * 100).toFixed(0)}% win rate - needs improvement or avoid`);
        }

        // Compare strategies
        if (activeStrategies.length === 2) {
            const diff = Math.abs(best.winRate - worst.winRate);
            if (diff > 0.15) {
                recs.push(`📊 ${best.strategyName} outperforming ${worst.strategyName} by ${(diff * 100).toFixed(0)} percentage points`);
            }
        }
    }

    // Market condition insights
    if (state.insights.optimalMarketConditions && state.insights.optimalMarketConditions !== 'unknown') {
        recs.push(`🌡️  Best performance in ${state.insights.optimalMarketConditions} volatility markets - focus trades there`);
    }

    // Common mistakes
    if (state.insights.commonMistakes.length > 0) {
        const topMistake = state.insights.commonMistakes[0];
        recs.push(`⚠️  Common mistake: "${topMistake}" - avoid this pattern`);
    }

    // Success patterns
    if (state.insights.successPatterns.length > 0) {
        const topPattern = state.insights.successPatterns[0];
        recs.push(`✨ Success pattern: "${topPattern}" - repeat this approach`);
    }

    // PnL assessment
    if (state.metrics.totalPnL > 0) {
        recs.push(`💰 Profitable: $${state.metrics.totalPnL.toFixed(2)} total PnL - maintain discipline`);
    } else if (state.metrics.totalPnL < 0) {
        recs.push(`📉 Losses: $${state.metrics.totalPnL.toFixed(2)} total PnL - review risk management`);
    }

    // Sample size recommendation
    if (state.metrics.totalTrades < 20) {
        recs.push(`📝 Need more data: ${state.metrics.totalTrades} trades completed - aim for 100+ for statistical significance`);
    } else if (state.metrics.totalTrades >= 100) {
        recs.push(`📊 Strong dataset: ${state.metrics.totalTrades} trades - insights are statistically significant`);
    }

    return recs;
}

/**
 * Analyze trading performance and provide insights
 */
export const analyzePerformanceFunction = new GameFunction({
    name: "analyze_performance",
    description: "Analyze overall trading performance, compare strategies, and generate actionable recommendations for improvement. Use this to understand what's working and what needs adjustment.",
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const state = stateManager.getState();

            logger(`\n📊 === SILVERBACK PERFORMANCE ANALYSIS ===\n`);

            // Overall Performance
            logger(`📈 Overall Performance:`);
            logger(`   Total Trades: ${state.metrics.totalTrades}`);
            logger(`   Winning Trades: ${state.metrics.winningTrades}`);
            logger(`   Losing Trades: ${state.metrics.losingTrades}`);
            logger(`   Win Rate: ${(state.metrics.winRate * 100).toFixed(1)}% ${state.metrics.winRate >= 0.70 ? '🎯' : state.metrics.winRate >= 0.60 ? '📈' : '⚠️'}`);
            logger(`   Total PnL: $${state.metrics.totalPnL.toFixed(2)} ${state.metrics.totalPnL > 0 ? '💰' : '📉'}`);
            logger(`   Target: 70% win rate\n`);

            // Strategy Comparison
            logger(`📊 Strategy Breakdown:\n`);

            const analysis = {
                overallPerformance: {
                    totalTrades: state.metrics.totalTrades,
                    winRate: (state.metrics.winRate * 100).toFixed(1) + '%',
                    totalPnL: state.metrics.totalPnL.toFixed(2),
                    trend: state.metrics.totalPnL > 0 ? 'profitable' : state.metrics.totalPnL < 0 ? 'unprofitable' : 'breakeven',
                    targetProgress: `${((state.metrics.winRate / 0.70) * 100).toFixed(0)}% toward 70% target`
                },
                strategyComparison: state.strategies.map(s => {
                    let recommendation: string;
                    if (s.trades < 5) {
                        recommendation = 'need_more_data';
                    } else if (s.winRate > 0.65) {
                        recommendation = 'use_more';
                    } else if (s.winRate > 0.55) {
                        recommendation = 'promising';
                    } else if (s.winRate > 0.45) {
                        recommendation = 'test_more';
                    } else {
                        recommendation = 'pause';
                    }

                    logger(`   ${s.strategyName}:`);
                    logger(`      Trades: ${s.trades}`);
                    logger(`      Win Rate: ${(s.winRate * 100).toFixed(1)}%`);
                    logger(`      Avg Win: $${s.avgWin.toFixed(2)}`);
                    logger(`      Avg Loss: $${s.avgLoss.toFixed(2)}`);
                    logger(`      Total PnL: $${s.totalPnL.toFixed(2)}`);
                    logger(`      Status: ${s.status}`);
                    logger(`      Recommendation: ${recommendation}\n`);

                    return {
                        name: s.strategyName,
                        trades: s.trades,
                        winRate: (s.winRate * 100).toFixed(1) + '%',
                        avgWin: '$' + s.avgWin.toFixed(2),
                        avgLoss: '$' + s.avgLoss.toFixed(2),
                        pnl: '$' + s.totalPnL.toFixed(2),
                        status: s.status,
                        recommendation: recommendation
                    };
                }),
                insights: {
                    bestStrategy: state.insights.bestPerformingStrategy,
                    worstStrategy: state.insights.worstPerformingStrategy,
                    optimalConditions: state.insights.optimalMarketConditions,
                    commonMistakes: state.insights.commonMistakes,
                    successPatterns: state.insights.successPatterns
                },
                recommendations: generateRecommendations(state)
            };

            // Display insights
            logger(`💡 Key Insights:`);
            logger(`   Best Strategy: ${analysis.insights.bestStrategy}`);
            logger(`   Worst Strategy: ${analysis.insights.worstStrategy}`);
            logger(`   Optimal Conditions: ${analysis.insights.optimalConditions}\n`);

            if (analysis.insights.successPatterns.length > 0) {
                logger(`✨ Success Patterns:`);
                analysis.insights.successPatterns.slice(0, 3).forEach((pattern, i) => {
                    logger(`   ${i + 1}. ${pattern}`);
                });
                logger('');
            }

            if (analysis.insights.commonMistakes.length > 0) {
                logger(`⚠️  Common Mistakes:`);
                analysis.insights.commonMistakes.slice(0, 3).forEach((mistake, i) => {
                    logger(`   ${i + 1}. ${mistake}`);
                });
                logger('');
            }

            // Display recommendations
            logger(`🎯 Recommendations:\n`);
            analysis.recommendations.forEach((rec, i) => {
                logger(`   ${i + 1}. ${rec}`);
            });

            logger(`\n=== END ANALYSIS ===\n`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(analysis, null, 2)
            );

        } catch (e) {
            const error = e as Error;
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Performance analysis failed: ${error.message}`
            );
        }
    }
});

/**
 * Learning & Analysis Worker
 * Analyzes performance and generates insights for improvement
 */
export const learningWorker = new GameWorker({
    id: "learning_worker",
    name: "Learning & Analysis Worker",
    description: `Analyze trading performance and provide insights for continuous improvement.

    Capabilities:
    1. Analyze overall trading metrics (win rate, PnL, trade count)
    2. Compare strategy effectiveness (momentum vs mean_reversion)
    3. Identify optimal market conditions for each strategy
    4. Extract patterns from winning and losing trades
    5. Generate actionable recommendations for improvement
    6. Track progress toward 70% win rate target

    Use this worker to:
    - Understand what's working and what's not
    - Get data-driven strategy recommendations
    - Learn from both mistakes and successes
    - Optimize strategy selection based on performance
    - Guide decision-making with statistical insights
    - Monitor progress toward master trader status (70% win rate)

    Analysis includes:
    - Overall performance metrics vs 70% target
    - Strategy win rates and PnL comparison
    - Best/worst performing strategies
    - Optimal market conditions (volatility/trend)
    - Common mistakes to avoid
    - Success patterns to repeat
    - Specific recommendations for improvement

    IMPORTANT: All analysis is PRIVATE and used internally for learning only. Never share performance data publicly without permission.`,

    functions: [analyzePerformanceFunction]
});
