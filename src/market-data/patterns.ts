/**
 * Chart Pattern Recognition & Market Structure Analysis
 * Detects liquidity sweeps, chart patterns, and market structure
 */

import { OHLCV } from './types';

export interface LiquiditySweep {
    detected: boolean;
    type: 'bullish' | 'bearish' | 'none';
    confidence: number; // 0-100
    description: string;
}

export interface ChartPattern {
    detected: boolean;
    type: 'higher_low' | 'lower_high' | 'double_bottom' | 'double_top' | 'bull_flag' | 'bear_flag' | 'none';
    confidence: number; // 0-100
    description: string;
}

export interface MarketRegime {
    regime: 'strong_uptrend' | 'weak_uptrend' | 'ranging' | 'weak_downtrend' | 'strong_downtrend';
    volatility: 'low' | 'medium' | 'high';
    confidence: number; // 0-100
}

/**
 * Detect liquidity sweep patterns
 * A liquidity sweep occurs when price briefly breaks a support/resistance level
 * to trigger stop losses, then reverses strongly in the opposite direction
 */
export function detectLiquiditySweep(candles: OHLCV[], lookback: number = 10): LiquiditySweep {
    if (candles.length < lookback + 5) {
        return { detected: false, type: 'none', confidence: 0, description: 'Insufficient data' };
    }

    const recentCandles = candles.slice(-lookback);
    const currentCandle = recentCandles[recentCandles.length - 1];
    const prevCandle = recentCandles[recentCandles.length - 2];

    // Find recent low and high
    const recentLows = recentCandles.slice(0, -1).map(c => c.low);
    const recentHighs = recentCandles.slice(0, -1).map(c => c.high);
    const lowestLow = Math.min(...recentLows);
    const highestHigh = Math.max(...recentHighs);

    // Bullish liquidity sweep: Price breaks below recent low then closes above it
    if (currentCandle.low < lowestLow && currentCandle.close > lowestLow) {
        const wickSize = currentCandle.close - currentCandle.low;
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);

        // Strong bullish candle after sweep = high confidence
        if (currentCandle.close > currentCandle.open && wickSize > bodySize * 0.5) {
            const confidence = Math.min(100, 60 + (wickSize / bodySize) * 20);
            return {
                detected: true,
                type: 'bullish',
                confidence: Math.round(confidence),
                description: `Bullish sweep: Broke ${lowestLow.toFixed(2)}, closed ${currentCandle.close.toFixed(2)}`
            };
        }
    }

    // Bearish liquidity sweep: Price breaks above recent high then closes below it
    if (currentCandle.high > highestHigh && currentCandle.close < highestHigh) {
        const wickSize = currentCandle.high - currentCandle.close;
        const bodySize = Math.abs(currentCandle.close - currentCandle.open);

        // Strong bearish candle after sweep = high confidence
        if (currentCandle.close < currentCandle.open && wickSize > bodySize * 0.5) {
            const confidence = Math.min(100, 60 + (wickSize / bodySize) * 20);
            return {
                detected: true,
                type: 'bearish',
                confidence: Math.round(confidence),
                description: `Bearish sweep: Broke ${highestHigh.toFixed(2)}, closed ${currentCandle.close.toFixed(2)}`
            };
        }
    }

    return { detected: false, type: 'none', confidence: 0, description: 'No sweep detected' };
}

/**
 * Detect chart patterns
 */
export function detectChartPattern(candles: OHLCV[], lookback: number = 20): ChartPattern {
    if (candles.length < lookback) {
        return { detected: false, type: 'none', confidence: 0, description: 'Insufficient data' };
    }

    const recentCandles = candles.slice(-lookback);

    // Check for higher lows (bullish structure)
    const higherLows = checkHigherLows(recentCandles);
    if (higherLows.detected) return higherLows;

    // Check for lower highs (bearish structure)
    const lowerHighs = checkLowerHighs(recentCandles);
    if (lowerHighs.detected) return lowerHighs;

    // Check for double bottom
    const doubleBottom = checkDoubleBottom(recentCandles);
    if (doubleBottom.detected) return doubleBottom;

    // Check for bull flag
    const bullFlag = checkBullFlag(recentCandles);
    if (bullFlag.detected) return bullFlag;

    return { detected: false, type: 'none', confidence: 0, description: 'No pattern detected' };
}

/**
 * Check for higher lows pattern (bullish)
 */
function checkHigherLows(candles: OHLCV[]): ChartPattern {
    if (candles.length < 6) {
        return { detected: false, type: 'none', confidence: 0, description: '' };
    }

    // Get last 3 significant lows
    const lows: number[] = [];
    for (let i = 1; i < candles.length - 1; i++) {
        if (candles[i].low < candles[i - 1].low && candles[i].low < candles[i + 1].low) {
            lows.push(candles[i].low);
        }
    }

    if (lows.length >= 3) {
        const low1 = lows[lows.length - 3];
        const low2 = lows[lows.length - 2];
        const low3 = lows[lows.length - 1];

        if (low2 > low1 && low3 > low2) {
            const strength = ((low3 - low1) / low1) * 100;
            const confidence = Math.min(95, 70 + strength * 50);
            return {
                detected: true,
                type: 'higher_low',
                confidence: Math.round(confidence),
                description: `Higher lows: ${low1.toFixed(2)} → ${low2.toFixed(2)} → ${low3.toFixed(2)}`
            };
        }
    }

    return { detected: false, type: 'none', confidence: 0, description: '' };
}

/**
 * Check for lower highs pattern (bearish)
 */
function checkLowerHighs(candles: OHLCV[]): ChartPattern {
    if (candles.length < 6) {
        return { detected: false, type: 'none', confidence: 0, description: '' };
    }

    // Get last 3 significant highs
    const highs: number[] = [];
    for (let i = 1; i < candles.length - 1; i++) {
        if (candles[i].high > candles[i - 1].high && candles[i].high > candles[i + 1].high) {
            highs.push(candles[i].high);
        }
    }

    if (highs.length >= 3) {
        const high1 = highs[highs.length - 3];
        const high2 = highs[highs.length - 2];
        const high3 = highs[highs.length - 1];

        if (high2 < high1 && high3 < high2) {
            const strength = ((high1 - high3) / high1) * 100;
            const confidence = Math.min(95, 70 + strength * 50);
            return {
                detected: true,
                type: 'lower_high',
                confidence: Math.round(confidence),
                description: `Lower highs: ${high1.toFixed(2)} → ${high2.toFixed(2)} → ${high3.toFixed(2)}`
            };
        }
    }

    return { detected: false, type: 'none', confidence: 0, description: '' };
}

/**
 * Check for double bottom pattern (bullish reversal)
 */
function checkDoubleBottom(candles: OHLCV[]): ChartPattern {
    if (candles.length < 10) {
        return { detected: false, type: 'none', confidence: 0, description: '' };
    }

    // Find two recent lows
    const lows: { price: number, index: number }[] = [];
    for (let i = 2; i < candles.length - 2; i++) {
        if (candles[i].low < candles[i - 1].low &&
            candles[i].low < candles[i - 2].low &&
            candles[i].low < candles[i + 1].low &&
            candles[i].low < candles[i + 2].low) {
            lows.push({ price: candles[i].low, index: i });
        }
    }

    if (lows.length >= 2) {
        const bottom1 = lows[lows.length - 2];
        const bottom2 = lows[lows.length - 1];
        const priceDiff = Math.abs(bottom2.price - bottom1.price) / bottom1.price;

        // Bottoms should be similar price (within 2%)
        if (priceDiff < 0.02 && (bottom2.index - bottom1.index) >= 3) {
            const confidence = Math.min(95, 75 - (priceDiff * 1000));
            return {
                detected: true,
                type: 'double_bottom',
                confidence: Math.round(confidence),
                description: `Double bottom: ${bottom1.price.toFixed(2)} ≈ ${bottom2.price.toFixed(2)}`
            };
        }
    }

    return { detected: false, type: 'none', confidence: 0, description: '' };
}

/**
 * Check for bull flag pattern (continuation)
 */
function checkBullFlag(candles: OHLCV[]): ChartPattern {
    if (candles.length < 15) {
        return { detected: false, type: 'none', confidence: 0, description: '' };
    }

    // Bull flag: Strong move up (pole), then consolidation (flag)
    const poleStart = candles.length - 15;
    const poleEnd = candles.length - 7;
    const flagEnd = candles.length - 1;

    const poleGain = (candles[poleEnd].close - candles[poleStart].close) / candles[poleStart].close;

    // Need at least 5% gain for pole
    if (poleGain > 0.05) {
        // Check if recent candles are consolidating
        const flagCandles = candles.slice(poleEnd, flagEnd + 1);
        const flagHigh = Math.max(...flagCandles.map(c => c.high));
        const flagLow = Math.min(...flagCandles.map(c => c.low));
        const flagRange = (flagHigh - flagLow) / flagLow;

        // Flag should be tight consolidation (< 3% range)
        if (flagRange < 0.03) {
            const confidence = Math.min(90, 70 + (poleGain * 100));
            return {
                detected: true,
                type: 'bull_flag',
                confidence: Math.round(confidence),
                description: `Bull flag: ${(poleGain * 100).toFixed(1)}% pole, consolidating`
            };
        }
    }

    return { detected: false, type: 'none', confidence: 0, description: '' };
}

/**
 * Determine market regime (trending vs ranging)
 */
export function detectMarketRegime(candles: OHLCV[], ema9: number, ema21: number): MarketRegime {
    if (candles.length < 20) {
        return { regime: 'ranging', volatility: 'medium', confidence: 50 };
    }

    const recentCandles = candles.slice(-20);

    // Calculate trend strength
    const trendStrength = (ema9 - ema21) / ema21;

    // Calculate volatility (average true range)
    let atr = 0;
    for (let i = 1; i < recentCandles.length; i++) {
        const tr = Math.max(
            recentCandles[i].high - recentCandles[i].low,
            Math.abs(recentCandles[i].high - recentCandles[i - 1].close),
            Math.abs(recentCandles[i].low - recentCandles[i - 1].close)
        );
        atr += tr;
    }
    atr = atr / (recentCandles.length - 1);
    const avgPrice = recentCandles.reduce((sum, c) => sum + c.close, 0) / recentCandles.length;
    const volatilityPct = (atr / avgPrice) * 100;

    // Determine volatility level
    let volatility: 'low' | 'medium' | 'high';
    if (volatilityPct < 1) volatility = 'low';
    else if (volatilityPct < 2.5) volatility = 'medium';
    else volatility = 'high';

    // Determine regime
    let regime: MarketRegime['regime'];
    let confidence: number;

    if (trendStrength > 0.03) {
        regime = 'strong_uptrend';
        confidence = Math.min(95, 70 + (trendStrength * 1000));
    } else if (trendStrength > 0.01) {
        regime = 'weak_uptrend';
        confidence = 70;
    } else if (trendStrength < -0.03) {
        regime = 'strong_downtrend';
        confidence = Math.min(95, 70 + (Math.abs(trendStrength) * 1000));
    } else if (trendStrength < -0.01) {
        regime = 'weak_downtrend';
        confidence = 70;
    } else {
        regime = 'ranging';
        confidence = 80;
    }

    return { regime, volatility, confidence: Math.round(confidence) };
}
