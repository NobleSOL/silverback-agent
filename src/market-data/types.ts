/**
 * Market Data Types
 * Defines interfaces for technical analysis and market data
 */

export interface OHLCV {
    timestamp: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export interface TechnicalIndicators {
    ema9: number;
    ema21: number;
    rsi: number;
    bollingerBands: {
        upper: number;
        middle: number;
        lower: number;
    };
}

export interface MarketConditions {
    trend: 'up' | 'down' | 'sideways';
    volatility: 'high' | 'medium' | 'low';
    volume: 'increasing' | 'decreasing' | 'stable';
    momentum: 'bullish' | 'bearish' | 'neutral';
}

export interface TradingSignal {
    strategy: 'momentum' | 'mean_reversion';
    action: 'buy' | 'sell' | 'hold';
    confidence: number; // 0-100
    reasoning: string[];
    indicators: TechnicalIndicators;
    conditions: MarketConditions;
}

export interface VolumeMetrics {
    current: number;
    average: number;
    ratio: number;
    trend: 'increasing' | 'decreasing' | 'stable';
}
