/**
 * Silverback State Manager
 * Manages persistent state using PostgreSQL for cloud persistence on Render
 */

import { Pool } from 'pg';
import { SilverbackState, Trade, TradingMetrics, StrategyPerformance } from '../types/agent-state';
import dotenv from 'dotenv';

// Load environment variables BEFORE creating the pool
dotenv.config();

// Debug: Log whether DATABASE_URL is set
console.log(`📊 DATABASE_URL configured: ${process.env.DATABASE_URL ? 'Yes' : 'No (will use in-memory state)'}`);

// Use DATABASE_URL from environment (Render PostgreSQL)
const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
}) : null;

export class StateManager {
    private state: SilverbackState;
    private initialized: boolean = false;

    constructor() {
        this.state = this.getDefaultState();
        // Initialize async - will complete before first use
        this.initialize().catch(e => {
            console.error('Failed to initialize state manager:', e);
        });
    }

    private async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await this.initializeDatabase();
            await this.loadState();
            this.initialized = true;
        } catch (e) {
            console.error('Database initialization error:', e);
            // Continue with default state if DB unavailable
            this.initialized = true;
        }
    }

    private async initializeDatabase(): Promise<void> {
        if (!pool) {
            console.log('📊 No database configured, using in-memory state');
            return;
        }
        const client = await pool.connect();
        try {
            // Create tables if they don't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS trades (
                    id TEXT PRIMARY KEY,
                    timestamp TIMESTAMPTZ NOT NULL,
                    strategy TEXT NOT NULL,
                    token_in TEXT NOT NULL,
                    token_out TEXT NOT NULL,
                    amount_in REAL NOT NULL,
                    amount_out REAL NOT NULL,
                    expected_out REAL NOT NULL,
                    slippage REAL NOT NULL,
                    price_impact REAL NOT NULL,
                    outcome TEXT NOT NULL,
                    pnl REAL NOT NULL,
                    volatility TEXT,
                    liquidity_rating TEXT,
                    trend TEXT,
                    lessons JSONB
                );

                CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
                CREATE INDEX IF NOT EXISTS idx_trades_outcome ON trades(outcome);
                CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);

                CREATE TABLE IF NOT EXISTS agent_state (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE TABLE IF NOT EXISTS market_data (
                    timestamp TIMESTAMPTZ NOT NULL,
                    token_pair TEXT NOT NULL,
                    price REAL NOT NULL,
                    volume REAL NOT NULL,
                    liquidity REAL NOT NULL,
                    ema9 REAL,
                    ema21 REAL,
                    rsi REAL,
                    bb_upper REAL,
                    bb_lower REAL,
                    bb_middle REAL,
                    PRIMARY KEY (timestamp, token_pair)
                );

                CREATE INDEX IF NOT EXISTS idx_market_data_pair ON market_data(token_pair);

                CREATE TABLE IF NOT EXISTS replied_tweets (
                    tweet_id TEXT PRIMARY KEY,
                    replied_at TIMESTAMPTZ NOT NULL
                );

                CREATE TABLE IF NOT EXISTS recent_tweets (
                    id SERIAL PRIMARY KEY,
                    content TEXT NOT NULL,
                    topic TEXT NOT NULL,
                    posted_at TIMESTAMPTZ NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_recent_tweets_posted ON recent_tweets(posted_at);

                CREATE TABLE IF NOT EXISTS acp_job_queue (
                    id SERIAL PRIMARY KEY,
                    job_id TEXT UNIQUE NOT NULL,
                    job_name TEXT NOT NULL,
                    requirement JSONB NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    priority INTEGER DEFAULT 0,
                    created_at TIMESTAMPTZ DEFAULT NOW(),
                    started_at TIMESTAMPTZ,
                    completed_at TIMESTAMPTZ,
                    result JSONB,
                    error TEXT,
                    retries INTEGER DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_job_queue_status ON acp_job_queue(status);
                CREATE INDEX IF NOT EXISTS idx_job_queue_created ON acp_job_queue(created_at);
            `);
            console.log('📊 PostgreSQL tables initialized');
        } finally {
            client.release();
        }
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

    private async loadState(): Promise<void> {
        if (!pool) {
            console.log('📊 No database - using in-memory state');
            return;
        }
        try {
            const result = await pool.query(
                'SELECT value FROM agent_state WHERE key = $1',
                ['current_state']
            );

            if (result.rows.length > 0) {
                const loaded = result.rows[0].value;
                this.state = { ...this.getDefaultState(), ...loaded };
                console.log(`📊 Loaded learning state: ${this.state.metrics.totalTrades} trades, ${(this.state.metrics.winRate * 100).toFixed(1)}% win rate`);
            } else {
                console.log(`📊 Starting fresh - no previous learning state found`);
                await this.save();
            }
        } catch (e) {
            console.log('📊 Starting fresh state (database not available or error)');
        }
    }

    async load(): Promise<void> {
        await this.loadState();
    }

    async save(): Promise<void> {
        if (!pool) return; // Skip if no database
        try {
            await pool.query(
                `INSERT INTO agent_state (key, value, updated_at)
                 VALUES ($1, $2, NOW())
                 ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                ['current_state', JSON.stringify(this.state)]
            );
        } catch (e) {
            console.error('Failed to save state:', e);
        }
    }

    getState(): SilverbackState {
        return this.state;
    }

    async recordTrade(trade: Trade): Promise<void> {
        // Ensure initialized
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            // Insert into database (permanent record) if available
            if (pool) {
                await pool.query(`
                    INSERT INTO trades (
                        id, timestamp, strategy, token_in, token_out, amount_in, amount_out,
                        expected_out, slippage, price_impact, outcome, pnl,
                        volatility, liquidity_rating, trend, lessons
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    ON CONFLICT (id) DO NOTHING
                `, [
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
                ]);

                // Update recent trades in state (last 100)
                this.state.recentTrades = await this.getRecentTrades(100);
            } else {
                // In-memory only: add trade to recent trades
                this.state.recentTrades.unshift(trade);
                if (this.state.recentTrades.length > 100) {
                    this.state.recentTrades = this.state.recentTrades.slice(0, 100);
                }
            }

            // Update metrics
            this.updateMetrics(trade);

            // Update strategy performance
            this.updateStrategyPerformance(trade);

            // Extract insights
            await this.extractInsights();

            // Save state
            await this.save();
        } catch (e) {
            console.error('Failed to record trade:', e);
            // Still update in-memory state even if DB fails
            this.state.recentTrades.unshift(trade);
            this.updateMetrics(trade);
            this.updateStrategyPerformance(trade);
        }
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

    async getRecentTrades(limit: number = 100): Promise<Trade[]> {
        if (!pool) {
            return this.state.recentTrades.slice(0, limit);
        }
        try {
            const result = await pool.query(`
                SELECT * FROM trades
                ORDER BY timestamp DESC
                LIMIT $1
            `, [limit]);

            return this.mapRowsToTrades(result.rows);
        } catch (e) {
            return this.state.recentTrades || [];
        }
    }

    // Query trades by strategy
    async getTradesByStrategy(strategy: string): Promise<Trade[]> {
        if (!pool) {
            return this.state.recentTrades.filter(t => t.strategy === strategy);
        }
        try {
            const result = await pool.query(
                'SELECT * FROM trades WHERE strategy = $1 ORDER BY timestamp DESC',
                [strategy]
            );
            return this.mapRowsToTrades(result.rows);
        } catch (e) {
            return [];
        }
    }

    // Query winning trades in specific market conditions
    async getWinningTradesInConditions(volatility: string, trend: string): Promise<Trade[]> {
        if (!pool) {
            return this.state.recentTrades.filter(t =>
                t.outcome === 'win' &&
                t.marketConditions.volatility === volatility &&
                t.marketConditions.trend === trend
            );
        }
        try {
            const result = await pool.query(`
                SELECT * FROM trades
                WHERE outcome = 'win' AND volatility = $1 AND trend = $2
                ORDER BY timestamp DESC
            `, [volatility, trend]);
            return this.mapRowsToTrades(result.rows);
        } catch (e) {
            return [];
        }
    }

    private mapRowsToTrades(rows: any[]): Trade[] {
        return rows.map(row => ({
            id: row.id,
            timestamp: row.timestamp,
            strategy: row.strategy,
            tokenIn: row.token_in,
            tokenOut: row.token_out,
            amountIn: row.amount_in,
            amountOut: row.amount_out,
            expectedOut: row.expected_out,
            slippage: row.slippage,
            priceImpact: row.price_impact,
            outcome: row.outcome,
            pnl: row.pnl,
            marketConditions: {
                volatility: row.volatility,
                liquidityRating: row.liquidity_rating,
                trend: row.trend
            },
            lessons: typeof row.lessons === 'string' ? JSON.parse(row.lessons) : row.lessons
        }));
    }

    // === TWITTER TRACKING METHODS ===

    // In-memory caches for when DB is not available
    private repliedTweetsCache: Set<string> = new Set();
    private recentTweetsCache: { content: string; topic: string; posted_at: string }[] = [];

    /**
     * Check if we've already replied to a tweet
     */
    async hasRepliedToTweet(tweetId: string): Promise<boolean> {
        if (!pool) {
            return this.repliedTweetsCache.has(tweetId);
        }
        try {
            const result = await pool.query(
                'SELECT tweet_id FROM replied_tweets WHERE tweet_id = $1',
                [tweetId]
            );
            return result.rows.length > 0;
        } catch (e) {
            return this.repliedTweetsCache.has(tweetId);
        }
    }

    /**
     * Mark a tweet as replied to
     */
    async markTweetReplied(tweetId: string): Promise<void> {
        this.repliedTweetsCache.add(tweetId);
        if (!pool) return;
        try {
            await pool.query(
                'INSERT INTO replied_tweets (tweet_id, replied_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING',
                [tweetId]
            );
        } catch (e) {
            console.error('Failed to mark tweet replied:', e);
        }
    }

    /**
     * Get all replied tweet IDs (for loading into memory on startup)
     */
    async getRepliedTweetIds(): Promise<Set<string>> {
        if (!pool) {
            return this.repliedTweetsCache;
        }
        try {
            const result = await pool.query('SELECT tweet_id FROM replied_tweets');
            return new Set(result.rows.map(r => r.tweet_id));
        } catch (e) {
            return this.repliedTweetsCache;
        }
    }

    /**
     * Clean old replied tweets (keep last 7 days)
     */
    async cleanOldRepliedTweets(): Promise<void> {
        if (!pool) return;
        try {
            await pool.query(
                "DELETE FROM replied_tweets WHERE replied_at < NOW() - INTERVAL '7 days'"
            );
        } catch (e) {
            console.error('Failed to clean old replied tweets:', e);
        }
    }

    /**
     * Record a posted tweet for duplicate prevention
     */
    async recordPostedTweet(content: string, topic: string): Promise<void> {
        // Always update in-memory cache
        this.recentTweetsCache.unshift({ content, topic, posted_at: new Date().toISOString() });
        if (this.recentTweetsCache.length > 50) {
            this.recentTweetsCache = this.recentTweetsCache.slice(0, 50);
        }

        if (!pool) return;
        try {
            await pool.query(
                'INSERT INTO recent_tweets (content, topic, posted_at) VALUES ($1, $2, NOW())',
                [content, topic]
            );

            // Keep only last 50 tweets
            await pool.query(`
                DELETE FROM recent_tweets
                WHERE id NOT IN (SELECT id FROM recent_tweets ORDER BY posted_at DESC LIMIT 50)
            `);
        } catch (e) {
            console.error('Failed to record posted tweet:', e);
        }
    }

    /**
     * Get recent tweets for duplicate checking
     */
    async getRecentPostedTweets(hoursAgo: number = 4): Promise<{ content: string; topic: string; posted_at: string }[]> {
        if (!pool) {
            const cutoff = Date.now() - (hoursAgo * 60 * 60 * 1000);
            return this.recentTweetsCache.filter(t => new Date(t.posted_at).getTime() > cutoff);
        }
        try {
            const result = await pool.query(`
                SELECT content, topic, posted_at FROM recent_tweets
                WHERE posted_at > NOW() - INTERVAL '${hoursAgo} hours'
                ORDER BY posted_at DESC
            `);
            return result.rows;
        } catch (e) {
            return this.recentTweetsCache;
        }
    }

    /**
     * Get recent topics to prevent repetition
     */
    async getRecentTopics(limit: number = 5): Promise<string[]> {
        if (!pool) {
            const topics = [...new Set(this.recentTweetsCache.map(t => t.topic))];
            return topics.slice(0, limit);
        }
        try {
            const result = await pool.query(`
                SELECT DISTINCT topic FROM recent_tweets
                ORDER BY MAX(posted_at) DESC
                LIMIT $1
            `, [limit]);
            return result.rows.map(r => r.topic);
        } catch (e) {
            return [];
        }
    }

    // Close database connection (call on shutdown)
    async close(): Promise<void> {
        if (pool) {
            await pool.end();
        }
    }
}

// Singleton instance
export const stateManager = new StateManager();
