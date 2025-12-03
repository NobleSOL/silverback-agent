/**
 * Silverback Agent State Types
 * Defines all state interfaces for persistent memory and learning
 */

export interface TradingMetrics {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnL: number;
    maxDrawdown: number;
    sharpeRatio: number;
    lastUpdated: string;
}

export interface StrategyPerformance {
    strategyName: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number;
    avgWin: number;
    avgLoss: number;
    totalPnL: number;
    status: 'active' | 'paused' | 'testing';
}

export interface MarketConditions {
    volatility: 'high' | 'medium' | 'low';
    liquidityRating: string;
    trend: 'up' | 'down' | 'sideways';
}

export interface Trade {
    id: string;
    timestamp: string;
    strategy: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: number;
    amountOut: number;
    expectedOut: number;
    slippage: number;
    priceImpact: number;
    outcome: 'win' | 'loss' | 'pending';
    pnl: number;
    marketConditions: MarketConditions;
    lessons: string[]; // What we learned from this trade
}

export interface Insights {
    bestPerformingStrategy: string;
    worstPerformingStrategy: string;
    optimalMarketConditions: string;
    commonMistakes: string[];
    successPatterns: string[];
}

export interface SilverbackState {
    // Performance tracking
    metrics: TradingMetrics;

    // Strategy tracking
    strategies: StrategyPerformance[];
    activeStrategy: string;

    // Trade history (last 100 trades in memory)
    recentTrades: Trade[];

    // Learning insights
    insights: Insights;

    // Current portfolio
    portfolio: {
        [token: string]: number;
    };

    // Phase tracking
    phase: 'community_building' | 'paper_trading' | 'live_trading';
    tradingEnabled: boolean;
}
