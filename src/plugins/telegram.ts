/**
 * Telegram Plugin Integration
 * Enables trading signals and alerts to be sent to Telegram
 *
 * Future Use Cases:
 * - Send trade entry/exit signals
 * - Alert on significant market movements
 * - Share performance updates
 * - Community notifications
 */

import TelegramPlugin from "@virtuals-protocol/game-telegram-plugin";
import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import dotenv from "dotenv";

dotenv.config();

let telegramPlugin: TelegramPlugin | null = null;

/**
 * Initialize and get the Telegram plugin
 */
export function createTelegramPlugin() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.log("⚠️ TELEGRAM_BOT_TOKEN not set - Telegram disabled");
        return null;
    }

    telegramPlugin = new TelegramPlugin({
        credentials: {
            botToken: process.env.TELEGRAM_BOT_TOKEN,
        },
    });

    console.log("✅ Telegram plugin initialized");
    return telegramPlugin;
}

/**
 * Get the Telegram worker for adding to agent
 */
export function getTelegramWorker() {
    if (!telegramPlugin) {
        const plugin = createTelegramPlugin();
        if (!plugin) return null;
    }
    return telegramPlugin!.getWorker();
}

/**
 * Check if Telegram is available
 */
export function isTelegramAvailable(): boolean {
    return !!process.env.TELEGRAM_BOT_TOKEN;
}

/**
 * Send a trading signal to Telegram
 * This is a custom function that wraps the plugin for easy use
 */
export const sendTradingSignalFunction = new GameFunction({
    name: "send_telegram_signal",
    description: `Send a trading signal or alert to the Telegram channel. Use this to notify the community about important trading opportunities or market events.`,
    args: [
        {
            name: "signal_type",
            description: "Type of signal: 'entry', 'exit', 'alert', 'update'"
        },
        {
            name: "asset",
            description: "The asset/token the signal is about (e.g., 'BTC', 'ETH', 'BACK')"
        },
        {
            name: "message",
            description: "The signal message with details"
        },
        {
            name: "confidence",
            description: "Confidence level: 'high', 'medium', 'low' (optional)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Telegram not configured (missing BOT_TOKEN or CHAT_ID)"
            );
        }

        try {
            const signalEmoji: Record<string, string> = {
                entry: "🟢",
                exit: "🔴",
                alert: "⚠️",
                update: "📊"
            };

            const confidenceEmoji: Record<string, string> = {
                high: "🔥",
                medium: "👀",
                low: "🤔"
            };

            const emoji = signalEmoji[args.signal_type || 'update'] || "📊";
            const confEmoji = args.confidence ? ` ${confidenceEmoji[args.confidence] || ''}` : '';

            const formattedMessage = `
${emoji} **Silverback Signal**${confEmoji}

**Type:** ${args.signal_type?.toUpperCase() || 'UPDATE'}
**Asset:** ${args.asset || 'Market'}

${args.message}

---
🦍 _Silverback DeFi Agent_
            `.trim();

            // Use Telegram Bot API directly
            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: formattedMessage,
                        parse_mode: 'Markdown'
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status}`);
            }

            logger(`Sent ${args.signal_type} signal for ${args.asset} to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Signal sent successfully to Telegram`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send Telegram signal: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Send performance update to Telegram
 */
export const sendPerformanceUpdateFunction = new GameFunction({
    name: "send_telegram_performance",
    description: `Send a performance update to Telegram showing trading results. Use after completing trades or at regular intervals.`,
    args: [
        {
            name: "period",
            description: "Period: 'daily', 'weekly', 'monthly', 'trade'"
        },
        {
            name: "trades_count",
            description: "Number of trades in the period"
        },
        {
            name: "win_rate",
            description: "Win rate percentage"
        },
        {
            name: "pnl",
            description: "Profit/Loss amount"
        },
        {
            name: "notes",
            description: "Additional notes or observations (optional)"
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
            const pnlNum = parseFloat(args.pnl || '0');
            const pnlEmoji = pnlNum >= 0 ? "📈" : "📉";
            const winRateNum = parseFloat(args.win_rate || '0');
            const performanceEmoji = winRateNum >= 70 ? "🏆" : winRateNum >= 50 ? "✅" : "⚡";

            const formattedMessage = `
${performanceEmoji} **Silverback ${args.period?.toUpperCase() || 'PERIOD'} Performance**

📊 **Trades:** ${args.trades_count || 0}
🎯 **Win Rate:** ${args.win_rate || 0}%
${pnlEmoji} **P&L:** ${pnlNum >= 0 ? '+' : ''}${args.pnl || '0'}

${args.notes ? `📝 _${args.notes}_` : ''}

---
🦍 _Silverback DeFi Agent_
            `.trim();

            const response = await fetch(
                `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: process.env.TELEGRAM_CHAT_ID,
                        text: formattedMessage,
                        parse_mode: 'Markdown'
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`Telegram API error: ${response.status}`);
            }

            logger(`Sent ${args.period} performance update to Telegram`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                `Performance update sent to Telegram`
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to send performance update: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Message templates for consistent Telegram formatting
 */
export const telegramTemplates = {
    tradeEntry: (asset: string, direction: 'long' | 'short', entry: number, target: number, stop: number) => `
🟢 **TRADE ENTRY**

**Asset:** ${asset}
**Direction:** ${direction.toUpperCase()}
**Entry:** $${entry}
**Target:** $${target} (${((target - entry) / entry * 100).toFixed(1)}%)
**Stop:** $${stop} (${((stop - entry) / entry * 100).toFixed(1)}%)

_Risk management is key. Size positions accordingly._
    `.trim(),

    tradeExit: (asset: string, result: 'win' | 'loss', pnl: number, reason: string) => `
${result === 'win' ? '🟢' : '🔴'} **TRADE EXIT**

**Asset:** ${asset}
**Result:** ${result.toUpperCase()}
**P&L:** ${pnl >= 0 ? '+' : ''}${pnl}%
**Reason:** ${reason}
    `.trim(),

    marketAlert: (alert: string, urgency: 'low' | 'medium' | 'high') => `
${urgency === 'high' ? '🚨' : urgency === 'medium' ? '⚠️' : 'ℹ️'} **MARKET ALERT**

${alert}

_Stay informed. Trade responsibly._
    `.trim()
};
