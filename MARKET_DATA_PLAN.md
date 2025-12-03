# Market Data & Technical Analysis Implementation

## Overview

Real-time market data feeds and technical analysis are CRITICAL for achieving 70% win rate. This document outlines the infrastructure needed.

---

## Phase 1: Market Data Collection

### Data Sources

#### 1. On-Chain Price Data (Primary)
**Source:** The Graph / Uniswap V2 Subgraph for Base
**Endpoint:** `https://api.thegraph.com/subgraphs/name/[base-uniswap-v2]`

**What we query:**
```graphql
{
  pair(id: "0x...") {
    token0Price
    token1Price
    reserve0
    reserve1
    volumeUSD
    txCount
    createdAtTimestamp
  }

  swaps(
    where: { pair: "0x..." }
    orderBy: timestamp
    orderDirection: desc
    first: 100
  ) {
    timestamp
    amount0In
    amount0Out
    amount1In
    amount1Out
    amountUSD
  }
}
```

**Frequency:** Every 12 seconds (Base block time)

---

#### 2. CoinGecko API (Backup/Validation)
**Endpoint:** `https://api.coingecko.com/api/v3/`

**What we fetch:**
- Current price
- 24h volume
- Market cap
- Price history (OHLCV data)

**Rate limit:** 10-50 calls/minute (free tier)

---

### Data Storage Schema

**Table:** `market_data` (Already defined in state-manager.ts)

```sql
CREATE TABLE market_data (
    timestamp TEXT NOT NULL,
    tokenPair TEXT NOT NULL,        -- e.g., "WETH-USDC"
    price REAL NOT NULL,
    volume REAL NOT NULL,
    liquidity REAL NOT NULL,

    -- Technical indicators (calculated)
    ema9 REAL,
    ema21 REAL,
    rsi REAL,
    bbUpper REAL,                    -- Bollinger Band upper
    bbLower REAL,                    -- Bollinger Band lower
    bbMiddle REAL,                   -- Bollinger Band middle (SMA)

    PRIMARY KEY (timestamp, tokenPair)
);
```

---

## Phase 2: Technical Indicators

### 1. EMA (Exponential Moving Average)

**Purpose:** Identify trend direction

**Formula:**
```
EMA_today = (Price_today × K) + (EMA_yesterday × (1 - K))
where K = 2 / (Period + 1)

For 9 EMA: K = 2 / 10 = 0.2
For 21 EMA: K = 2 / 22 = 0.0909
```

**Implementation:**
```typescript
function calculateEMA(prices: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = prices[0]; // Start with first price

    for (let i = 1; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
    }

    return ema;
}
```

**Signals:**
- **Bullish:** 9 EMA > 21 EMA (short-term trend stronger than long-term)
- **Bearish:** 9 EMA < 21 EMA
- **Crossover:** Change in relative position = signal

---

### 2. RSI (Relative Strength Index)

**Purpose:** Identify overbought/oversold conditions

**Formula:**
```
RSI = 100 - (100 / (1 + RS))
where RS = Average Gain / Average Loss over period (typically 14)

Average Gain = Sum of gains over period / period
Average Loss = Sum of losses over period / period
```

**Implementation:**
```typescript
function calculateRSI(prices: number[], period: number = 14): number {
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? -c : 0);

    const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
}
```

**Signals:**
- **Oversold:** RSI < 30 (potential buy)
- **Overbought:** RSI > 70 (potential sell)
- **Neutral:** RSI 40-60 (good for momentum entries)

---

### 3. Bollinger Bands

**Purpose:** Identify volatility and mean reversion opportunities

**Formula:**
```
Middle Band = SMA(20)
Upper Band = Middle Band + (2 × Standard Deviation)
Lower Band = Middle Band - (2 × Standard Deviation)
```

**Implementation:**
```typescript
function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2) {
    const sma = prices.slice(-period).reduce((a, b) => a + b, 0) / period;

    const squaredDiffs = prices.slice(-period).map(p => Math.pow(p - sma, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
    const sd = Math.sqrt(variance);

    return {
        upper: sma + (stdDev * sd),
        middle: sma,
        lower: sma - (stdDev * sd)
    };
}
```

**Signals:**
- **Price at lower band:** Oversold, potential buy (mean reversion)
- **Price at upper band:** Overbought, potential sell
- **Bands narrowing:** Low volatility, breakout coming
- **Bands widening:** High volatility, trend in progress

---

### 4. Volume Analysis

**Purpose:** Confirm price movements are backed by conviction

**Metrics:**
```typescript
interface VolumeMetrics {
    current: number;        // Current bar volume
    average: number;        // 20-period average
    ratio: number;          // current / average
    trend: 'increasing' | 'decreasing' | 'stable';
}

function analyzeVolume(volumes: number[]): VolumeMetrics {
    const current = volumes[volumes.length - 1];
    const average = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
    const ratio = current / average;

    const recent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const older = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;

    let trend: 'increasing' | 'decreasing' | 'stable';
    if (recent > older * 1.2) trend = 'increasing';
    else if (recent < older * 0.8) trend = 'decreasing';
    else trend = 'stable';

    return { current, average, ratio, trend };
}
```

**Signals:**
- **High volume + price up:** Strong bullish conviction
- **High volume + price down:** Strong bearish conviction
- **Low volume + price movement:** Weak move, likely to reverse
- **Volume increasing:** Trend strengthening

---

## Phase 3: Liquidity Sweep Detection

### What is a Liquidity Sweep?

Market makers push price below support (or above resistance) to trigger stop losses, then reverse direction and profit.

**Characteristics:**
1. Sharp price move breaking key level
2. High volume spike on the break
3. Long wick/tail (rapid reversal)
4. Price recovers above/below original level
5. Often at round numbers or obvious support/resistance

### Detection Algorithm

```typescript
interface LiquiditySweep {
    detected: boolean;
    level: number;              // Price level that was swept
    direction: 'bullish' | 'bearish';
    confidence: number;         // 0-100
    timestamp: string;
}

function detectLiquiditySweep(
    candles: OHLCV[],
    supportLevel: number,
    resistanceLevel: number
): LiquiditySweep {
    const latest = candles[candles.length - 1];
    const prevAvgVolume = candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19;

    // Bullish sweep (price briefly breaks support then recovers)
    const bullishSweep = {
        wickBreak: latest.low < supportLevel && latest.close > supportLevel,
        volumeSpike: latest.volume > prevAvgVolume * 1.5,
        quickRecovery: latest.close > (supportLevel + (latest.high - latest.low) * 0.3),
        longLowerWick: (latest.close - latest.low) > (latest.high - latest.close) * 1.5
    };

    if (bullishSweep.wickBreak && bullishSweep.volumeSpike &&
        bullishSweep.quickRecovery && bullishSweep.longLowerWick) {
        return {
            detected: true,
            level: supportLevel,
            direction: 'bullish',
            confidence: 85,
            timestamp: latest.timestamp
        };
    }

    // Bearish sweep (price briefly breaks resistance then reverses)
    const bearishSweep = {
        wickBreak: latest.high > resistanceLevel && latest.close < resistanceLevel,
        volumeSpike: latest.volume > prevAvgVolume * 1.5,
        quickReversal: latest.close < (resistanceLevel - (latest.high - latest.low) * 0.3),
        longUpperWick: (latest.high - latest.close) > (latest.close - latest.low) * 1.5
    };

    if (bearishSweep.wickBreak && bearishSweep.volumeSpike &&
        bearishSweep.quickReversal && bearishSweep.longUpperWick) {
        return {
            detected: true,
            level: resistanceLevel,
            direction: 'bearish',
            confidence: 85,
            timestamp: latest.timestamp
        };
    }

    return { detected: false, level: 0, direction: 'bullish', confidence: 0, timestamp: '' };
}
```

### How to Trade Liquidity Sweeps

**Bullish Sweep (Buy Signal):**
1. Wait for sweep to complete (candle closes above support)
2. Confirm with volume (high on sweep, decreasing after)
3. Enter long AFTER recovery confirmation
4. Stop loss below sweep low
5. Target: Previous resistance or +2% TP

**Bearish Sweep (Avoid/Short Signal):**
1. Recognize failed breakout above resistance
2. Avoid going long after sweep
3. If shorting enabled: enter after candle closes below
4. Stop loss above sweep high

---

## Phase 4: Chart Pattern Recognition

### Implementation Strategy

**Approach:** Rule-based pattern detection (not ML initially)

### 1. Bull Flag Pattern

**Visual:**
```
        |
        |  <-- Pole (strong uptrend)
        |
       /|
      / |  <-- Flag (consolidation/pullback)
     /  |
    /   |
   ↗    ↗  <-- Breakout
```

**Detection Logic:**
```typescript
function detectBullFlag(candles: OHLCV[]): PatternResult {
    // 1. Find the pole (strong uptrend)
    const poleStart = candles.length - 20;
    const poleEnd = candles.length - 10;
    const poleGain = (candles[poleEnd].close - candles[poleStart].close) / candles[poleStart].close;

    if (poleGain < 0.05) return { detected: false }; // Need 5%+ gain for pole

    // 2. Find the flag (consolidation with slight downtrend)
    const flagStart = poleEnd;
    const flagEnd = candles.length - 1;
    const flagPullback = (candles[flagEnd].close - candles[flagStart].close) / candles[flagStart].close;

    if (flagPullback > 0 || flagPullback < -0.03) return { detected: false }; // Flag should be 0-3% pullback

    // 3. Check volume (decreasing in flag)
    const poleVolume = candles.slice(poleStart, poleEnd).reduce((a, b) => a + b.volume, 0) / 10;
    const flagVolume = candles.slice(flagStart, flagEnd).reduce((a, b) => a + b.volume, 0) / 10;

    if (flagVolume > poleVolume * 0.8) return { detected: false }; // Volume should decrease

    // 4. Check for breakout
    const latest = candles[candles.length - 1];
    const flagHigh = Math.max(...candles.slice(flagStart, flagEnd).map(c => c.high));

    const breakout = latest.close > flagHigh && latest.volume > flagVolume * 1.5;

    return {
        detected: true,
        pattern: 'bull_flag',
        confidence: breakout ? 90 : 70,
        entry: breakout ? latest.close : flagHigh,
        target: latest.close + (candles[poleEnd].close - candles[poleStart].close), // Pole length projected
        stopLoss: flagEnd < flagStart ? candles[flagEnd].low : latest.close * 0.97
    };
}
```

### 2. Double Bottom Pattern

**Visual:**
```
        |
        |\   /|
        | \_/ |  <-- Two bottoms at same level
        |     ↗  <-- Breakout above resistance
```

**Detection Logic:**
```typescript
function detectDoubleBottom(candles: OHLCV[], threshold: number = 0.02): PatternResult {
    if (candles.length < 30) return { detected: false };

    // Find local minima
    const lows = [];
    for (let i = 2; i < candles.length - 2; i++) {
        if (candles[i].low < candles[i-1].low &&
            candles[i].low < candles[i-2].low &&
            candles[i].low < candles[i+1].low &&
            candles[i].low < candles[i+2].low) {
            lows.push({ index: i, price: candles[i].low });
        }
    }

    if (lows.length < 2) return { detected: false };

    // Check if last two lows are at similar level (within threshold)
    const bottom1 = lows[lows.length - 2];
    const bottom2 = lows[lows.length - 1];
    const priceDiff = Math.abs(bottom1.price - bottom2.price) / bottom1.price;

    if (priceDiff > threshold) return { detected: false };

    // Find resistance (peak between the two bottoms)
    const peakBetween = candles.slice(bottom1.index, bottom2.index)
        .reduce((max, c) => c.high > max ? c.high : max, 0);

    // Check for breakout
    const latest = candles[candles.length - 1];
    const breakout = latest.close > peakBetween;

    return {
        detected: true,
        pattern: 'double_bottom',
        confidence: breakout ? 95 : 75,
        entry: breakout ? latest.close : peakBetween,
        target: peakBetween + (peakBetween - bottom1.price), // Pattern height projected
        stopLoss: Math.min(bottom1.price, bottom2.price) * 0.98
    };
}
```

---

## Implementation Files

### 1. Market Data Fetcher
**File:** `src/market-data/fetcher.ts`
- Connect to The Graph
- Fetch price, volume, liquidity data
- Store in database every 12 seconds

### 2. Technical Indicators
**File:** `src/market-data/indicators.ts`
- Calculate EMA, RSI, Bollinger Bands
- Update database with calculated values

### 3. Pattern Detector
**File:** `src/market-data/patterns.ts`
- Detect liquidity sweeps
- Detect chart patterns (bull flag, double bottom, etc.)
- Return confidence scores

### 4. Market Analysis Worker
**File:** `src/workers/market-analysis-worker.ts`
- Function: `analyze_market_conditions`
- Function: `detect_entry_opportunity`
- Function: `check_exit_signals`

---

## Data Update Cycle

```
Every 12 seconds (Base block time):
1. Fetch latest price/volume from The Graph
2. Store raw data in market_data table
3. Calculate technical indicators (EMA, RSI, BB)
4. Update indicators in database
5. Run pattern detection
6. If pattern detected → trigger strategy evaluation
```

---

## Dependencies Needed

```bash
npm install @apollo/client graphql       # The Graph queries
npm install technicalindicators          # Pre-built TA library (optional, for validation)
npm install better-sqlite3               # Database
```

---

## Next Steps

1. **Week 1:** Implement market data fetcher + storage
2. **Week 1:** Implement technical indicators (EMA, RSI, BB)
3. **Week 2:** Implement liquidity sweep detection
4. **Week 2:** Implement 2-3 basic chart patterns
5. **Week 3:** Integrate with trading strategies
6. **Week 3-4:** Test pattern accuracy on historical data
7. **Week 5:** Deploy with real-time analysis

**Target:** 70% win rate through accurate pattern recognition and technical analysis.
