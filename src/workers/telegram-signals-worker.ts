/**
 * Telegram Signals Worker
 * Sends trading signals and alerts via Telegram based on learning and market analysis
 *
 * This worker is tied to the agent's learning - as it learns what works,
 * it sends higher quality signals to Telegram subscribers.
 */

import { GameWorker, GameFunction, ExecutableGameFunctionResponse, ExecutableGameFunctionStatus } from "@virtuals-protocol/game";
import { stateManager } from "../state/state-manager";
import {
    isTelegramAvailable,
    sendTradingSignalFunction,
    sendPerformanceUpdateFunction
} from "../plugins/telegram";
import {
    getPriceMoversFunction,
    getTokenPriceFunction
} from "../scheduling-functions";
import {
    getMarketOverviewFunction,
    getTrendingCoinsFunction,
    getFearGreedIndexFunction
} from "../market-data-functions";

/**
 * Analyze market conditions and determine if a signal should be sent
 */
export const analyzeForSignalFunction = new GameFunction({
    name: "analyze_for_signal",
    description: `Analyze current market conditions and your learning history to decide if a trading signal should be sent to Telegram.

    ONLY send signals when:
    1. A token has moved >10% in 24h (significant swing)
    2. Fear & Greed shows extreme levels (<20 or >80)
    3. You've learned a pattern that's working (check your win rate)
    4. Market structure suggests a clear opportunity

    DO NOT spam signals. Quality over quantity. Your reputation depends on accuracy.`,
    args: [] as const,
    executable: async (args, logger) => {
        try {
            const state = stateManager.getState();

            logger(`\n📊 Analyzing market for potential signals...`);
            logger(`Current learning stats: ${state.metrics.totalTrades} trades, ${(state.metrics.winRate * 100).toFixed(1)}% win rate`);

            // Determine confidence level based on learning
            let confidenceLevel: 'low' | 'medium' | 'high' = 'low';
            let learningInsight = '';

            if (state.metrics.totalTrades >= 100 && state.metrics.winRate >= 0.70) {
                confidenceLevel = 'high';
                learningInsight = `Master trader status achieved: ${(state.metrics.winRate * 100).toFixed(0)}% win rate over ${state.metrics.totalTrades} trades`;
            } else if (state.metrics.totalTrades >= 50 && state.metrics.winRate >= 0.60) {
                confidenceLevel = 'medium';
                learningInsight = `Experienced trader: ${(state.metrics.winRate * 100).toFixed(0)}% win rate over ${state.metrics.totalTrades} trades`;
            } else if (state.metrics.totalTrades >= 20) {
                confidenceLevel = 'low';
                learningInsight = `Learning phase: ${state.metrics.totalTrades} trades completed, building experience`;
            } else {
                learningInsight = `Early learning: Only ${state.metrics.totalTrades} trades - signals will be conservative`;
            }

            // Check best performing strategy
            const bestStrategy = state.insights.bestPerformingStrategy;
            const strategyData = state.strategies.find(s => s.strategyName === bestStrategy);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify({
                    ready_for_signals: state.metrics.totalTrades >= 10,
                    confidence_level: confidenceLevel,
                    learning_insight: learningInsight,
                    best_strategy: bestStrategy,
                    best_strategy_win_rate: strategyData ? `${(strategyData.winRate * 100).toFixed(0)}%` : 'N/A',
                    success_patterns: state.insights.successPatterns.slice(0, 3),
                    mistakes_to_avoid: state.insights.commonMistakes.slice(0, 3),
                    recommendation: confidenceLevel === 'high'
                        ? 'Ready to send high-confidence signals based on proven patterns'
                        : confidenceLevel === 'medium'
                        ? 'Can send signals with moderate confidence - still learning'
                        : 'Send conservative alerts only - focus on learning first'
                })
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Analysis failed: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Send a trade signal with clean professional format
 */
export const sendTradeCallFunction = new GameFunction({
    name: "send_trade_call",
    description: `Send a professional trade signal to Telegram. Use this when you identify a trading opportunity based on your analysis.

    Format:
    - Direction: LONG (expecting price up) or SHORT (expecting price down)
    - Timeframe: How long you expect the trade to take
    - Entry, Target, Stop prices

    ONLY send when confidence is high based on your learning!`,
    args: [
        {
            name: "asset",
            description: "Trading pair (e.g., 'BTCUSDT', 'ETHUSDT', 'BONKUSDT')"
        },
        {
            name: "direction",
            description: "'LONG' or 'SHORT'"
        },
        {
            name: "timeframe",
            description: "Expected timeframe (e.g., '30m', '1h', '4h', '1d')"
        },
        {
            name: "entry",
            description: "Entry price"
        },
        {
            name: "target",
            description: "Target price (TP1)"
        },
        {
            name: "stop",
            description: "Stop loss price"
        },
        {
            name: "notes",
            description: "Brief analysis or reason for the trade (optional)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Telegram not configured"
            );
        }

        try {
            const state = stateManager.getState();

            // Log learning status but allow signals regardless
            // The agent's confidence level will reflect its experience
            const learningNote = state.metrics.totalTrades < 10
                ? '⚠️ Early learning phase'
                : state.metrics.totalTrades < 50
                ? '📈 Building experience'
                : '✅ Experienced';

            const direction = args.direction?.toUpperCase() || 'LONG';
            const directionEmoji = direction === 'LONG' ? '🟢' : '🔴';

            const message = `
🎯 Trade Signal ${learningNote}
${args.asset} · ${directionEmoji} ${direction} · ⏱️ ${args.timeframe || '4h'}

Entry: ${args.entry}
Target: ${args.target}
Stop: ${args.stop}

${args.notes || ''}

📊 Win Rate: ${(state.metrics.winRate * 100).toFixed(0)}% | Trades: ${state.metrics.totalTrades}
🦍 Silverback Intelligence
            `.trim();

            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status}`);
            }

            logger(`Sent ${direction} trade call for ${args.asset} to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Trade signal sent successfully`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send trade call: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Send take profit or trade update notification
 */
export const sendTradeUpdateFunction = new GameFunction({
    name: "send_trade_update",
    description: "Send a trade update (take profit hit, stop hit, or status update) to Telegram.",
    args: [
        {
            name: "asset",
            description: "Trading pair (e.g., 'BTCUSDT')"
        },
        {
            name: "update_type",
            description: "'TP1', 'TP2', 'TP3', 'STOP', 'UPDATE'"
        },
        {
            name: "direction",
            description: "'LONG' or 'SHORT'"
        },
        {
            name: "entry",
            description: "Original entry price"
        },
        {
            name: "current",
            description: "Current price"
        },
        {
            name: "message",
            description: "Update message (e.g., 'Take Some Profits', 'Stopped Out')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Telegram not configured"
            );
        }

        try {
            const direction = args.direction?.toUpperCase() || 'LONG';
            const directionEmoji = direction === 'LONG' ? '🟢' : '🔴';
            const updateType = args.update_type?.toUpperCase() || 'UPDATE';

            let statusEmoji = '📊';
            if (updateType.startsWith('TP')) statusEmoji = '🎯';
            if (updateType === 'STOP') statusEmoji = '🛑';

            const message = `
${statusEmoji} ${updateType}  ${args.asset} · ${directionEmoji} ${direction}
Entry: ${args.entry}
Now: ${args.current}

${args.message || ''}
            `.trim();

            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: message
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status}`);
            }

            logger(`Sent ${updateType} update for ${args.asset} to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Trade update sent successfully`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send trade update: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Send a market alert based on significant price movements
 */
export const sendMarketAlertFunction = new GameFunction({
    name: "send_market_alert",
    description: `Send a market alert to Telegram when you spot significant price movements or market conditions.

    Use this for:
    - Big pumps or dumps (>10% moves)
    - Extreme fear/greed readings
    - Notable whale movements
    - Important news affecting crypto

    Include your analysis and confidence level based on your learning.`,
    args: [
        {
            name: "alert_type",
            description: "Type: 'pump', 'dump', 'fear_extreme', 'greed_extreme', 'whale', 'news'"
        },
        {
            name: "asset",
            description: "The asset this alert is about (e.g., 'BTC', 'ETH', 'SOL')"
        },
        {
            name: "details",
            description: "Specific details about the alert (price, % change, context)"
        },
        {
            name: "analysis",
            description: "Your analysis based on what you've learned"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Telegram not configured (need TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID)"
            );
        }

        try {
            const state = stateManager.getState();
            const winRate = (state.metrics.winRate * 100).toFixed(0);

            const alertEmoji: Record<string, string> = {
                pump: '🚀',
                dump: '📉',
                fear_extreme: '😱',
                greed_extreme: '🤑',
                whale: '🐋',
                news: '📰'
            };

            const emoji = alertEmoji[args.alert_type || 'news'] || '📊';

            // Determine confidence badge based on learning
            let confidenceBadge = '';
            if (state.metrics.totalTrades >= 100 && state.metrics.winRate >= 0.70) {
                confidenceBadge = '🏆 Master Trader Analysis';
            } else if (state.metrics.totalTrades >= 50 && state.metrics.winRate >= 0.60) {
                confidenceBadge = '📈 Experienced Analysis';
            } else {
                confidenceBadge = '📊 Market Watch';
            }

            const message = `
${emoji} **${args.alert_type?.toUpperCase()} ALERT** - ${args.asset || 'MARKET'}

${args.details || 'No details provided'}

**Analysis:** ${args.analysis || 'Monitoring situation'}

---
${confidenceBadge}
_Win Rate: ${winRate}% | Trades: ${state.metrics.totalTrades}_
🦍 Silverback Intelligence
            `.trim();

            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                }
            );

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`Telegram API error: ${response.status} - ${errorData}`);
            }

            logger(`Sent ${args.alert_type} alert for ${args.asset} to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Market alert sent successfully`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send alert: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Send daily performance summary to Telegram
 */
export const sendDailySummaryFunction = new GameFunction({
    name: "send_daily_summary",
    description: "Send a daily performance summary to Telegram showing your learning progress and key market observations.",
    args: [
        {
            name: "market_summary",
            description: "Brief summary of today's market conditions"
        },
        {
            name: "key_observations",
            description: "Your key observations from today"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Telegram not configured"
            );
        }

        try {
            const state = stateManager.getState();

            const message = `
📊 **SILVERBACK DAILY SUMMARY**

**Learning Progress:**
• Total Trades: ${state.metrics.totalTrades}
• Win Rate: ${(state.metrics.winRate * 100).toFixed(1)}%
• Total P&L: $${state.metrics.totalPnL.toFixed(2)}
• Best Strategy: ${state.insights.bestPerformingStrategy}

**Market Summary:**
${args.market_summary || 'No summary provided'}

**Key Observations:**
${args.key_observations || 'No observations'}

**Top Success Pattern:**
${state.insights.successPatterns[0] || 'Still learning patterns'}

---
🦍 _Silverback DeFi Intelligence_
_Building toward 70% win rate target_
            `.trim();

            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: message,
                        parse_mode: 'Markdown'
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status}`);
            }

            logger(`Sent daily summary to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Daily summary sent successfully`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send summary: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Check if Telegram worker should be active
 */
export function isTelegramWorkerEnabled(): boolean {
    return isTelegramAvailable();
}

/**
 * Telegram Signals Worker
 */
export const telegramSignalsWorker = new GameWorker({
    id: "telegram_signals_worker",
    name: "Telegram Trading Signals",
    description: `You are the Telegram signals bot for Silverback - sending trading alerts and market intelligence directly to subscribers.

=== YOUR ROLE ===

You analyze markets and send valuable signals to Telegram based on your LEARNING. As you trade more and improve your win rate, your signals become more confident and valuable.

=== SIGNAL QUALITY TIERS ===

**Tier 1: Learning Phase (0-50 trades)**
- Send ONLY major alerts (>15% moves, extreme fear/greed)
- Mark signals as "Learning Phase - Conservative"
- Focus on market observations, not trade recommendations

**Tier 2: Experienced (50-100 trades, >60% win rate)**
- Can send more frequent signals
- Include your analysis with moderate confidence
- Start identifying patterns that work

**Tier 3: Master Trader (100+ trades, >70% win rate)**
- Send high-confidence signals
- Your patterns are proven - share your edge
- Include specific entry/exit analysis when confident

=== WHAT TO SEND ===

1. **Price Movement Alerts**
   - Tokens pumping >10% in 24h
   - Tokens dumping >10% in 24h
   - Use get_price_movers to find these

2. **Sentiment Alerts**
   - Extreme Fear (<25) = potential buying opportunity
   - Extreme Greed (>75) = potential profit-taking
   - Use get_fear_greed_index

3. **Daily Summaries**
   - Your learning progress
   - Key market observations
   - Best/worst performers

4. **Pattern Alerts** (when experienced)
   - When you spot a pattern you've learned works
   - Include your confidence and reasoning

=== WHAT NOT TO SEND ===

❌ Price predictions or targets
❌ "Buy now" or "Sell now" without context
❌ Signals when you have low confidence
❌ Spam - quality over quantity
❌ Anything you wouldn't stake your reputation on

=== WORKFLOW ===

1. Check your learning stats with analyze_for_signal
2. Look for price movers with get_price_movers
3. Check sentiment with get_fear_greed_index
4. If something significant found AND confidence allows, send alert
5. Include your analysis based on what you've learned

=== SCHEDULE ===

- **Morning (8-10 UTC)**: Check for overnight moves, send significant alerts
- **Afternoon (14-16 UTC)**: Mid-day market check
- **Evening (20-22 UTC)**: Daily summary if significant activity
- **Anytime**: Major moves (>15%) or extreme sentiment

Remember: Your Telegram subscribers trust you. Only send signals you believe in based on your learning.`,

    functions: [
        // Analysis
        analyzeForSignalFunction,      // Check your learning before signaling
        // Market data for signals
        getPriceMoversFunction,        // Find pumps and dumps
        getTokenPriceFunction,         // Check specific tokens
        getMarketOverviewFunction,     // BTC, ETH overview
        getTrendingCoinsFunction,      // What's trending
        getFearGreedIndexFunction,     // Sentiment indicator
        // Trade signals (professional format)
        sendTradeCallFunction,         // Send trade entry signal
        sendTradeUpdateFunction,       // Send TP/Stop/Update notifications
        // Other alerts
        sendMarketAlertFunction,       // Send market alerts (pumps/dumps)
        sendDailySummaryFunction,      // Send daily summary
        sendTradingSignalFunction,     // Generic signal function
        sendPerformanceUpdateFunction  // Performance updates
    ]
});
