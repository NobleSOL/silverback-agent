/**
 * Technical Indicators Module
 * Calculates EMA, RSI, Bollinger Bands, and volume metrics for trading signals
 */

import { OHLCV, TechnicalIndicators, VolumeMetrics, MarketConditions } from './types';
import { detectLiquiditySweep, detectChartPattern, detectMarketRegime } from './patterns';

/**
 * Calculate Exponential Moving Average (EMA)
 * @param prices Array of prices
 * @param period EMA period (typically 9 or 21)
 * @returns EMA value
 */
export function calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) {
        throw new Error(`Need at least ${period} prices to calculate ${period}-period EMA`);
    }

    const k = 2 / (period + 1);
    let ema = prices[0]; // Start with first price

    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }

    return ema;
}

/**
 * Calculate Relative Strength Index (RSI)
 * @param prices Array of prices
 * @param period RSI period (typically 14)
 * @returns RSI value (0-100)
 */
export function calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) {
        throw new Error(`Need at least ${period + 1} prices to calculate RSI`);
    }

    // Calculate price changes
    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }

    // Separate gains and losses
    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);

    // Calculate average gain and loss
    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    // Handle edge case
    if (avgLoss === 0) return 100;

    // Calculate RS and RSI
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));

    return rsi;
}

/**
 * Calculate Bollinger Bands
 * @param prices Array of prices
 * @param period Period for SMA (typically 20)
 * @param stdDevMultiplier Standard deviation multiplier (typically 2)
 * @returns Object with upper, middle, and lower bands
 */
export function calculateBollingerBands(
    prices: number[],
    period: number = 20,
    stdDevMultiplier: number = 2
): { upper: number; middle: number; lower: number } {
    if (prices.length < period) {
        throw new Error(`Need at least ${period} prices to calculate Bollinger Bands`);
    }

    // Calculate SMA (Simple Moving Average) - this is the middle band
    const recentPrices = prices.slice(-period);
    const sma = recentPrices.reduce((a, b) => a + b, 0) / period;

    // Calculate standard deviation
    const squaredDiffs = recentPrices.map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(variance);

    // Calculate bands
    return {
        upper: sma + (stdDevMultiplier * sd),
        middle: sma,
        lower: sma - (stdDevMultiplier * sd)
    };
}

/**
 * Analyze volume metrics
 * @param volumes Array of volume values
 * @returns Volume metrics including trend
 */
export function analyzeVolume(volumes: number[]): VolumeMetrics {
    if (volumes.length < 20) {
        throw new Error('Need at least 20 volume data points for analysis');
    }

    const current = volumes[volumes.length - 1];
    const average = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const ratio = current / average;

    // Compare recent vs older volume to determine trend
    const recent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const older = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (recent > older * 1.2) trend = 'increasing';
    else if (recent < older * 0.8) trend = 'decreasing';
    else trend = 'stable';

    return { current, average, ratio, trend };
}

/**
 * Calculate all technical indicators for a price series
 * @param prices Array of prices
 * @returns All indicators
 */
export function calculateAllIndicators(prices: number[]): TechnicalIndicators {
    if (prices.length < 21) {
        throw new Error('Need at least 21 price points for full analysis');
    }

    const ema9 = calculateEMA(prices, 9);
    const ema21 = calculateEMA(prices, 21);
    const rsi = calculateRSI(prices, 14);
    const bollingerBands = calculateBollingerBands(prices, 20, 2);

    return {
        ema9,
        ema21,
        rsi,
        bollingerBands
    };
}

/**
 * Analyze market conditions based on indicators
 * @param candles Array of OHLCV candles
 * @param indicators Technical indicators
 * @returns Market conditions assessment
 */
export function analyzeMarketConditions(
    candles: OHLCV[],
    indicators: TechnicalIndicators
): MarketConditions {
    const prices = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);

    // Determine trend
    let trend: 'up' | 'down' | 'sideways';
    if (indicators.ema9 > indicators.ema21 * 1.01) {
        trend = 'up'; // 9 EMA significantly above 21 EMA
    } else if (indicators.ema9 < indicators.ema21 * 0.99) {
        trend = 'down'; // 9 EMA significantly below 21 EMA
    } else {
        trend = 'sideways'; // EMAs close together
    }

    // Determine volatility from Bollinger Band width
    const bandWidth = (indicators.bollingerBands.upper - indicators.bollingerBands.lower) / indicators.bollingerBands.middle;
    let volatility: 'high' | 'medium' | 'low';
    if (bandWidth > 0.1) volatility = 'high';
    else if (bandWidth > 0.05) volatility = 'medium';
    else volatility = 'low';

    // Determine volume trend
    let volumeTrend: 'increasing' | 'decreasing' | 'stable';
    if (volumes.length >= 20) {
        const volumeMetrics = analyzeVolume(volumes);
        volumeTrend = volumeMetrics.trend;
    } else {
        volumeTrend = 'stable';
    }

    // Determine momentum
    let momentum: 'bullish' | 'bearish' | 'neutral';
    const currentPrice = prices[prices.length - 1];

    if (indicators.rsi > 60 && trend === 'up' && indicators.ema9 > indicators.ema21) {
        momentum = 'bullish';
    } else if (indicators.rsi < 40 && trend === 'down' && indicators.ema9 < indicators.ema21) {
        momentum = 'bearish';
    } else {
        momentum = 'neutral';
    }

    return {
        trend,
        volatility,
        volume: volumeTrend,
        momentum
    };
}

/**
 * Detect EMA crossover signals
 * @param currentEMA9 Current 9-period EMA
 * @param currentEMA21 Current 21-period EMA
 * @param previousEMA9 Previous 9-period EMA
 * @param previousEMA21 Previous 21-period EMA
 * @returns Crossover signal ('bullish', 'bearish', or 'none')
 */
export function detectEMACrossover(
    currentEMA9: number,
    currentEMA21: number,
    previousEMA9: number,
    previousEMA21: number
): 'bullish' | 'bearish' | 'none' {
    const currentAbove = currentEMA9 > currentEMA21;
    const previousAbove = previousEMA9 > previousEMA21;

    if (!previousAbove && currentAbove) {
        return 'bullish'; // Golden cross - 9 EMA crossed above 21 EMA
    } else if (previousAbove && !currentAbove) {
        return 'bearish'; // Death cross - 9 EMA crossed below 21 EMA
    }

    return 'none';
}

/**
 * Check if price is at Bollinger Band extreme
 * @param currentPrice Current price
 * @param bollingerBands Bollinger Bands values
 * @returns Position relative to bands
 */
export function checkBollingerPosition(
    currentPrice: number,
    bollingerBands: { upper: number; middle: number; lower: number }
): 'at_upper' | 'at_lower' | 'above_upper' | 'below_lower' | 'middle' {
    const tolerance = (bollingerBands.upper - bollingerBands.lower) * 0.05; // 5% tolerance

    if (currentPrice >= bollingerBands.upper - tolerance && currentPrice <= bollingerBands.upper + tolerance) {
        return 'at_upper';
    } else if (currentPrice >= bollingerBands.lower - tolerance && currentPrice <= bollingerBands.lower + tolerance) {
        return 'at_lower';
    } else if (currentPrice > bollingerBands.upper) {
        return 'above_upper';
    } else if (currentPrice < bollingerBands.lower) {
        return 'below_lower';
    }

    return 'middle';
}

/**
 * Generate momentum strategy signal
 * @param candles Price/volume data
 * @param indicators Technical indicators
 * @returns Signal strength (0-100)
 */
export function generateMomentumSignal(candles: OHLCV[], indicators: TechnicalIndicators): number {
    let signal = 50; // Start neutral

    const currentPrice = candles[candles.length - 1].close;
    const volumes = candles.map(c => c.volume);

    // ADVANCED PATTERN DETECTION
    const regime = detectMarketRegime(candles, indicators.ema9, indicators.ema21);
    const liquiditySweep = detectLiquiditySweep(candles, 10);
    const chartPattern = detectChartPattern(candles, 20);

    // Market regime bonus/penalty - momentum works best in uptrends
    if (regime.regime === 'strong_uptrend') {
        signal += 25; // Perfect for momentum strategy
    } else if (regime.regime === 'weak_uptrend') {
        signal += 15; // Good for momentum
    } else if (regime.regime === 'ranging') {
        signal -= 10; // Not ideal for momentum
    } else if (regime.regime === 'weak_downtrend' || regime.regime === 'strong_downtrend') {
        signal -= 30; // Avoid momentum longs in downtrend
    }

    // Liquidity sweep detection - bullish sweep = strong entry
    if (liquiditySweep.detected && liquiditySweep.type === 'bullish') {
        signal += liquiditySweep.confidence * 0.2; // Up to +20 for perfect sweep
    }

    // Chart pattern confirmation
    if (chartPattern.detected) {
        if (chartPattern.type === 'higher_low' || chartPattern.type === 'bull_flag') {
            signal += chartPattern.confidence * 0.15; // Up to +15 for strong pattern
        } else if (chartPattern.type === 'lower_high') {
            signal -= 15; // Bearish structure - avoid
        }
    }

    // EMA alignment (reduced weight, regime handles trend better)
    if (indicators.ema9 > indicators.ema21) {
        signal += 10;
    } else {
        signal -= 10;
    }

    // RSI confirmation
    if (indicators.rsi > 45 && indicators.rsi < 65) {
        signal += 10; // Good momentum zone
    } else if (indicators.rsi > 70) {
        signal -= 10; // Overbought
    } else if (indicators.rsi < 40) {
        signal -= 5; // Too weak
    }

    // Volume confirmation
    if (volumes.length >= 20) {
        const volumeMetrics = analyzeVolume(volumes);
        if (volumeMetrics.trend === 'increasing' && volumeMetrics.ratio > 1.2) {
            signal += 10;
        }
    }

    return Math.max(0, Math.min(100, signal)); // Clamp to 0-100
}

/**
 * Generate mean reversion strategy signal
 * @param candles Price/volume data
 * @param indicators Technical indicators
 * @returns Signal strength (0-100)
 */
export function generateMeanReversionSignal(candles: OHLCV[], indicators: TechnicalIndicators): number {
    let signal = 50; // Start neutral

    const currentPrice = candles[candles.length - 1].close;
    const bbPosition = checkBollingerPosition(currentPrice, indicators.bollingerBands);

    // ADVANCED PATTERN DETECTION
    const regime = detectMarketRegime(candles, indicators.ema9, indicators.ema21);
    const liquiditySweep = detectLiquiditySweep(candles, 10);
    const chartPattern = detectChartPattern(candles, 20);

    // CRITICAL: Mean reversion ONLY works in ranging/weak trending markets
    // Strong trends will continue - don't fight them!
    if (regime.regime === 'strong_uptrend' || regime.regime === 'strong_downtrend') {
        return 0; // BLOCK completely - mean reversion fails in strong trends
    }

    // Mean reversion works best in ranging markets
    if (regime.regime === 'ranging') {
        signal += 20; // Perfect for mean reversion
    } else if (regime.regime === 'weak_uptrend' || regime.regime === 'weak_downtrend') {
        signal += 5; // Can work in weak trends
    }

    // Bullish liquidity sweep after downmove = great mean reversion setup
    if (liquiditySweep.detected && liquiditySweep.type === 'bullish') {
        signal += liquiditySweep.confidence * 0.25; // Up to +25 for perfect sweep
    }

    // Chart patterns for mean reversion
    if (chartPattern.detected) {
        if (chartPattern.type === 'double_bottom') {
            signal += chartPattern.confidence * 0.2; // Up to +20 for double bottom
        } else if (chartPattern.type === 'higher_low') {
            signal += chartPattern.confidence * 0.1; // Bullish structure helps
        }
    }

    // CRITICAL FIX: Add trend filter - don't buy dips in strong downtrends
    const trendStrength = (indicators.ema9 - indicators.ema21) / indicators.ema21;

    // Strong downtrend detection (EMA9 significantly below EMA21)
    if (trendStrength < -0.02) {
        // In strong downtrend - heavily penalize counter-trend trades
        signal -= 30;
    } else if (trendStrength < -0.01) {
        // Moderate downtrend - penalize moderately
        signal -= 15;
    } else if (trendStrength > 0.02) {
        // Strong uptrend - also avoid (oversold in uptrend is healthy pullback)
        signal -= 10;
    }

    // Bollinger Band position (reduce weight, was too high)
    if (bbPosition === 'at_lower' || bbPosition === 'below_lower') {
        signal += 15; // Reduced from 25 - less weight on BB alone
    } else if (bbPosition === 'at_upper' || bbPosition === 'above_upper') {
        signal -= 15; // Avoid buying at top
    }

    // RSI oversold/overbought (reduce weight during trends)
    if (indicators.rsi < 30) {
        // Only add points if NOT in strong downtrend
        if (trendStrength > -0.02) {
            signal += 15; // Reduced from 20 - oversold can persist
        }
    } else if (indicators.rsi > 70) {
        signal -= 15; // Overbought - avoid
    } else if (indicators.rsi > 40 && indicators.rsi < 60) {
        // Neutral RSI in ranging market is actually good for mean reversion
        signal += 5;
    }

    // Distance from middle band (only if trending sideways)
    const percentFromMiddle = Math.abs(currentPrice - indicators.bollingerBands.middle) / indicators.bollingerBands.middle;
    if (percentFromMiddle > 0.02 && Math.abs(trendStrength) < 0.01) {
        signal += 10; // Price far from mean in range = good reversion
    }

    // Price action: Check if we're making higher lows (bullish structure for reversal)
    if (candles.length >= 3) {
        const prev2Low = candles[candles.length - 3].low;
        const prev1Low = candles[candles.length - 2].low;
        const currentLow = candles[candles.length - 1].low;

        if (prev1Low > prev2Low && currentLow > prev1Low) {
            signal += 10; // Higher lows = bullish structure forming
        }
    }

    return Math.max(0, Math.min(100, signal)); // Clamp to 0-100
}
