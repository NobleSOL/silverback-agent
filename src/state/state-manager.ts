/**
 * Silverback State Manager
 * Manages persistent state using SQLite for scalability and querying
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { SilverbackState, Trade, TradingMetrics, StrategyPerformance } from '../types/agent-state';

// Database file path (relative to project root)
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'silverback.db');

export class StateManager {
    private state: SilverbackState;
    private db: Database.Database;

    constructor() {
        // Ensure data directory exists
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            console.log(`📁 Created data directory: ${DATA_DIR}`);
        }
        this.db = new Database(DB_FILE);
        this.initializeDatabase();
        this.state = this.getDefaultState();
    }

    private initializeDatabase(): void {
        // Create tables if they don't exist
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS trades (
                id TEXT PRIMARY KEY,
                timestamp TEXT NOT NULL,
                strategy TEXT NOT NULL,
                tokenIn TEXT NOT NULL,
                tokenOut TEXT NOT NULL,
                amountIn REAL NOT NULL,
                amountOut REAL NOT NULL,
                expectedOut REAL NOT NULL,
                slippage REAL NOT NULL,
                priceImpact REAL NOT NULL,
                outcome TEXT NOT NULL,
                pnl REAL NOT NULL,
                volatility TEXT,
                liquidityRating TEXT,
                trend TEXT,
                lessons TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
            CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome);
            CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);

            CREATE TABLE IF NOT EXISTS state (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS market_data (
                timestamp TEXT NOT NULL,
                tokenPair TEXT NOT NULL,
                price REAL NOT NULL,
                volume REAL NOT NULL,
                liquidity REAL NOT NULL,
                ema9 REAL,
                ema21 REAL,
                rsi REAL,
                bbUpper REAL,
                bbLower REAL,
                bbMiddle REAL,
                PRIMARY KEY (timestamp, tokenPair)
            );

            CREATE INDEX IF NOT EXISTS idx_market_data_pair ON market_data(tokenPair);
        `);
    }

    private getDefaultState(): SilverbackState {
        return {
            metrics: {
                totalTrades: 0,
                winningTrades: 0,
                losingTrades: 0,
                winRate: 0,
                totalPnL: 0,
                maxDrawdown: 0,
                sharpeRatio: 0,
                lastUpdated: new Date().toISOString()
            },
            strategies: [
                {
                    strategyName: 'momentum',
                    trades: 0,
                    wins: 0,
                    losses: 0,
                    winRate: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    totalPnL: 0,
                    status: 'testing'
                },
                {
                    strategyName: 'mean_reversion',
                    trades: 0,
                    wins: 0,
                    losses: 0,
                    winRate: 0,
                    avgWin: 0,
                    avgLoss: 0,
                    totalPnL: 0,
                    status: 'testing'
                }
            ],
            activeStrategy: 'momentum',
            recentTrades: [],
            insights: {
                bestPerformingStrategy: 'none_yet',
                worstPerformingStrategy: 'none_yet',
                optimalMarketConditions: 'unknown',
                commonMistakes: [],
                successPatterns: []
            },
            portfolio: {
                'WETH': 0,
                'USDC': 0
            },
            phase: 'community_building',
            tradingEnabled: false
        };
    }

    async load(): Promise<void> {
        try {
            const stateRow = this.db.prepare('SELECT value FROM state WHERE key = ?').get('current_state');
            if (stateRow) {
                this.state = JSON.parse((stateRow as any).value);
            } else {
                await this.save();
            }
        } catch (e) {
            console.log('Initializing fresh state...');
            await this.save();
        }
    }

    async save(): Promise<void> {
        this.db.prepare('INSERT OR REPLACE INTO state (key, value) VALUES (?, ?)')
            .run('current_state', JSON.stringify(this.state));
    }

    getState(): SilverbackState {
        return this.state;
    }

    async recordTrade(trade: Trade): Promise<void> {
        // Insert into database (permanent record)
        this.db.prepare(`
            INSERT INTO trades (
                id, timestamp, strategy, tokenIn, tokenOut, amountIn, amountOut,
                expectedOut, slippage, priceImpact, outcome, pnl,
                volatility, liquidityRating, trend, lessons
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            trade.id,
            trade.timestamp,
            trade.strategy,
            trade.tokenIn,
            trade.tokenOut,
            trade.amountIn,
            trade.amountOut,
            trade.expectedOut,
            trade.slippage,
            trade.priceImpact,
            trade.outcome,
            trade.pnl,
            trade.marketConditions.volatility,
            trade.marketConditions.liquidityRating,
            trade.marketConditions.trend,
            JSON.stringify(trade.lessons)
        );

        // Update recent trades in state (last 100)
        this.state.recentTrades = this.getRecentTrades(100);

        // Update metrics
        this.updateMetrics(trade);

        // Update strategy performance
        this.updateStrategyPerformance(trade);

        // Extract insights
        await this.extractInsights();

        // Save state
        await this.save();
    }

    private updateMetrics(trade: Trade): void {
        this.state.metrics.totalTrades++;

        if (trade.outcome === 'win') {
            this.state.metrics.winningTrades++;
        } else if (trade.outcome === 'loss') {
            this.state.metrics.losingTrades++;
        }

        this.state.metrics.winRate =
            this.state.metrics.totalTrades > 0
                ? this.state.metrics.winningTrades / this.state.metrics.totalTrades
                : 0;

        this.state.metrics.totalPnL += trade.pnl;
        this.state.metrics.lastUpdated = new Date().toISOString();

        // TODO: Calculate max drawdown and Sharpe ratio
    }

    private updateStrategyPerformance(trade: Trade): void {
        const strategy = this.state.strategies.find(s => s.strategyName === trade.strategy);
        if (!strategy) return;

        strategy.trades++;

        if (trade.outcome === 'win') {
            strategy.wins++;
            strategy.avgWin = ((strategy.avgWin * (strategy.wins - 1)) + trade.pnl) / strategy.wins;
        } else if (trade.outcome === 'loss') {
            strategy.losses++;
            strategy.avgLoss = ((strategy.avgLoss * (strategy.losses - 1)) + Math.abs(trade.pnl)) / strategy.losses;
        }

        strategy.winRate = strategy.trades > 0 ? strategy.wins / strategy.trades : 0;
        strategy.totalPnL += trade.pnl;
    }

    private async extractInsights(): Promise<void> {
        // Analyze recent trades to find patterns

        // Best performing strategy
        const sortedStrategies = [...this.state.strategies].sort((a, b) => b.winRate - a.winRate);
        this.state.insights.bestPerformingStrategy = sortedStrategies[0]?.strategyName || 'none';
        this.state.insights.worstPerformingStrategy = sortedStrategies[sortedStrategies.length - 1]?.strategyName || 'none';

        // Analyze market conditions for wins
        const winningTrades = this.state.recentTrades.filter(t => t.outcome === 'win');
        const volatilityMap = winningTrades.reduce((acc, t) => {
            acc[t.marketConditions.volatility] = (acc[t.marketConditions.volatility] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const optimalVolatility = Object.entries(volatilityMap).sort((a, b) => b[1] - a[1])[0]?.[0];
        this.state.insights.optimalMarketConditions = optimalVolatility || 'unknown';

        // Extract common mistakes (losing patterns)
        const losingTrades = this.state.recentTrades.filter(t => t.outcome === 'loss');
        this.state.insights.commonMistakes = losingTrades
            .slice(0, 5)
            .flatMap(t => t.lessons);

        // Extract success patterns
        this.state.insights.successPatterns = winningTrades
            .slice(0, 5)
            .flatMap(t => t.lessons);
    }

    async switchStrategy(newStrategy: string): Promise<void> {
        this.state.activeStrategy = newStrategy;
        await this.save();
    }

    async setPhase(phase: SilverbackState['phase']): Promise<void> {
        this.state.phase = phase;
        this.state.tradingEnabled = phase !== 'community_building';
        await this.save();
    }

    getRecentTrades(limit: number = 100): Trade[] {
        const rows = this.db.prepare(`
            SELECT * FROM trades
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(limit);

        return this.mapRowsToTrades(rows as any[]);
    }

    // Query trades by strategy
    getTradesByStrategy(strategy: string): Trade[] {
        const rows = this.db.prepare('SELECT * FROM trades WHERE strategy = ? ORDER BY timestamp DESC').all(strategy);
        return this.mapRowsToTrades(rows as any[]);
    }

    // Query winning trades in specific market conditions
    getWinningTradesInConditions(volatility: string, trend: string): Trade[] {
        const rows = this.db.prepare(`
            SELECT * FROM trades
            WHERE outcome = 'win' AND volatility = ? AND trend = ?
            ORDER BY timestamp DESC
        `).all(volatility, trend);
        return this.mapRowsToTrades(rows as any[]);
    }

    private mapRowsToTrades(rows: any[]): Trade[] {
        return rows.map(row => ({
            id: row.id,
            timestamp: row.timestamp,
            strategy: row.strategy,
            tokenIn: row.tokenIn,
            tokenOut: row.tokenOut,
            amountIn: row.amountIn,
            amountOut: row.amountOut,
            expectedOut: row.expectedOut,
            slippage: row.slippage,
            priceImpact: row.priceImpact,
            outcome: row.outcome,
            pnl: row.pnl,
            marketConditions: {
                volatility: row.volatility,
                liquidityRating: row.liquidityRating,
                trend: row.trend
            },
            lessons: JSON.parse(row.lessons)
        }));
    }

    // Close database connection (call on shutdown)
    close(): void {
        this.db.close();
    }
}

// Singleton instance
export const stateManager = new StateManager();
