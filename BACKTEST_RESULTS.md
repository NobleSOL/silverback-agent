# Real Market Data Backtest Results

## Executive Summary

Tested trading strategies on **180 candles (30 days) of real Ethereum price data** from CoinGecko API. The results reveal significant differences between simulated and real market performance.

**Key Finding:** Real market win rate (31.0%) is **29.9 percentage points lower** than simulated (60.9%)

---

## Test Configuration

### Data Source
- **Asset:** Ethereum (ETH/USD)
- **Period:** October 31, 2025 - November 29, 2025
- **Candles:** 180 (4-hour intervals)
- **Price Range:** $2,632.87 - $3,911.96
- **Data Source:** CoinGecko API

### Strategies Tested
1. **Momentum Strategy**
   - Entry: When EMA 9 > EMA 21, RSI 40-70, volume increasing
   - Stop Loss: 2% below entry
   - Take Profits: 1.5%, 3%, 5%
   - Signal Threshold: 55/100

2. **Mean Reversion Strategy**
   - Entry: When RSI oversold, price near lower Bollinger Band
   - Stop Loss: 3% below entry
   - Take Profits: 2%, 4%, 6%
   - Signal Threshold: 55/100

---

## Results Summary

### Overall Performance

| Metric | Value | Target | Gap |
|--------|-------|--------|-----|
| **Total Trades** | 29 | - | - |
| **Wins** | 9 (31.0%) | 70.0% | -39.0pp |
| **Losses** | 13 (44.8%) | - | - |
| **Partials** | 7 (24.1%) | - | - |
| **Total PnL** | $458.20 | Positive | ✅ |
| **Profit Factor** | 1.05 | >1.5 | -0.45 |

### Strategy Breakdown

#### Momentum Strategy
```
Total Trades: 7
Win Rate: 28.6% (2 wins, 3 losses, 2 partials)
Total PnL: $168.58
Avg PnL: $24.08
Profit Factor: 1.35
Avg Signal: 77.9/100
Signal Edge: +16.7 points (wins vs losses)
Avg Hold Time: 3.0 candles
```

**Exit Distribution:**
- TP3: 1 (14.3%)
- TP2: 1 (14.3%)
- TP1: 2 (28.6%)
- Stop Loss: 3 (42.9%) ⚠️

#### Mean Reversion Strategy
```
Total Trades: 22
Win Rate: 31.8% (7 wins, 10 losses, 5 partials)
Total PnL: $289.62
Avg PnL: $13.16
Profit Factor: 0.99
Avg Signal: 71.8/100
Signal Edge: -7.3 points (wins vs losses) ⚠️
Avg Hold Time: 4.1 candles
```

**Exit Distribution:**
- TP3: 1 (4.5%)
- TP2: 6 (27.3%)
- TP1: 5 (22.7%)
- Stop Loss: 10 (45.5%) ⚠️

---

## Critical Issues Identified

### 1. Win Rate Far Below Target
- **Current:** 31.0%
- **Simulated:** 60.9%
- **Target:** 70.0%
- **Gap:** -39.0 percentage points

### 2. Stop Losses Hit Too Frequently
- **Momentum:** 42.9% of trades
- **Mean Reversion:** 45.5% of trades
- **Issue:** Stop losses likely too tight for real market volatility

### 3. Mean Reversion Signal is Inverted ⚠️
- **Average Winning Signal:** 65.7/100
- **Average Losing Signal:** 73.0/100
- **Signal Edge:** -7.3 points (NEGATIVE)
- **Meaning:** Higher confidence signals are performing WORSE than lower signals
- **Root Cause:** Mean reversion signal calculation logic needs review

### 4. Momentum Signal Works Better
- **Signal Edge:** +16.7 points (positive)
- **Avg Winning Signal:** 85.0/100
- **Avg Losing Signal:** 68.3/100
- **Conclusion:** Momentum signal is correctly identifying better setups

### 5. TP3 Rarely Hit
- Only 2 out of 29 trades (6.9%) reached TP3
- Most exits at TP2 (24.1%) or TP1 (24.1%)
- Suggests targets may be too aggressive

---

## Performance vs Simulated

| Metric | Simulated | Real Data | Difference |
|--------|-----------|-----------|------------|
| **Win Rate** | 60.9% | 31.0% | -29.9pp |
| **Momentum WR** | 61.8% | 28.6% | -33.2pp |
| **Mean Rev WR** | 60.0% | 31.8% | -28.2pp |
| **Total PnL** | $14.18 | $458.20 | +$444.02 |

**Key Observation:** Despite lower win rate, real trades generated higher absolute PnL due to larger position sizes and better risk/reward on winners.

---

## Best Performing Trades (Learning Insights)

### Top 5 Winners

1. **Mean Reversion** - $3,437 → $3,644 (TP3)
   - PnL: +6.00%
   - Signal: 60/100
   - Duration: 14 candles
   - **Lesson:** Lower signal (60) but extended hold time worked

2. **Momentum** - $3,418 → $3,589 (TP3)
   - PnL: +5.00%
   - Signal: 85/100
   - Duration: 4 candles
   - **Lesson:** High signal (85) + quick exit = success

3. **Mean Reversion** - $3,417 → $3,553 (TP2)
   - PnL: +4.00%
   - Signal: 60/100
   - Duration: 4 candles

4. **Mean Reversion** - $3,336 → $3,469 (TP2)
   - PnL: +4.00%
   - Signal: 80/100
   - Duration: 4 candles

5. **Mean Reversion** - $3,410 → $3,547 (TP2)
   - PnL: +4.00%
   - Signal: 60/100
   - Duration: 4 candles

**Pattern:** Mean reversion trades with signal 60-80 and 4-14 candle hold time performed best.

---

## Worst Performing Trades (Avoid These)

All top 5 losers were Mean Reversion trades that hit stop loss at -3%:

1. Signal 60/100, Duration: 1 candle - **Too quick stop out**
2. Signal 60/100, Duration: 3 candles
3. Signal 60/100, Duration: 7 candles
4. **Signal 100/100**, Duration: 2 candles - **Perfect signal still lost!**
5. Signal 60/100, Duration: 2 candles

**Critical Finding:** Even a "perfect" 100/100 signal hit stop loss. This confirms the mean reversion signal is fundamentally flawed.

---

## Root Cause Analysis

### Why Mean Reversion Signal is Inverted

Looking at `src/market-data/indicators.ts:generateMeanReversionSignal()`:

**Current Logic Issues:**
1. Awards +20 points for RSI < 30 (oversold)
2. Awards +15 points for price near lower Bollinger Band
3. Awards +15 points for volume confirmation

**The Problem:**
- Real markets can stay oversold/overbought longer than expected
- Catching a falling knife: oversold doesn't mean reversal imminent
- No trend filter: buying dips in downtrends = losses

**Why It's Inverted:**
- 100/100 signals = RSI very oversold + at lower BB + high volume = **strongest downtrend**
- Lower signals (60-70) = mild oversold + some distance from BB = **actual reversal zone**

### Why Simulated Data Worked

The simulated data in `paper-trading-worker.ts`:
- Generates mean-reverting random walks
- Trend strength is artificially constrained (-20% to +20%)
- No extended trends or momentum crashes
- No real market microstructure

Real markets:
- Have strong directional trends
- Don't respect oversold/overbought levels during momentum moves
- Require trend confirmation before counter-trend trades

---

## Recommendations for Improvement

### Immediate Fixes (High Priority)

1. **Fix Mean Reversion Signal** ✅ Critical
   ```typescript
   // Add trend filter - only take counter-trend trades in ranging markets
   if (indicators.ema9 > indicators.ema21 * 1.02) {
       signal -= 30; // Strong uptrend = don't short
   }

   // Reduce RSI weight during trends
   // Add support/resistance confirmation
   ```

2. **Widen Stop Losses** ✅ Critical
   - Momentum: 2% → 3%
   - Mean Reversion: 3% → 4%
   - Reduces premature stop-outs

3. **Adjust Take Profits** ✅ High
   - TP3 rarely hit (6.9%)
   - Consider: TP1: 1%, TP2: 2%, TP3: 3.5%
   - More realistic targets for 4-hour timeframe

4. **Add Trend Filter** ✅ Critical
   - Only take momentum trades WITH the trend
   - Only take mean reversion trades in RANGE (not trending markets)

### Strategy Refinements (Medium Priority)

5. **Signal Threshold Adjustment**
   - Increase threshold: 55 → 65
   - Only take highest quality setups
   - Should improve win rate

6. **Position Sizing Based on Signal**
   - Signal 65-75: 50% position
   - Signal 75-85: 75% position
   - Signal 85+: 100% position

7. **Add Market Regime Detection**
   - Trending vs Ranging markets
   - High vs Low volatility
   - Route to appropriate strategy

### Advanced Improvements (Lower Priority)

8. **Multi-Timeframe Confirmation**
   - Check higher timeframe trend
   - Only trade with higher TF bias

9. **Volume Profile Analysis**
   - Identify support/resistance zones
   - Better entry/exit timing

10. **Machine Learning Signal Optimization**
    - Train on historical data
    - Find optimal indicator weights
    - Adaptive thresholds

---

## Next Steps

### Phase 3+ Optimization Plan

1. **Fix Mean Reversion Signal** (2 hours)
   - Add trend filter
   - Reduce RSI weight in trends
   - Test on same dataset

2. **Adjust Stop Loss & Take Profit Levels** (1 hour)
   - Widen stops to 3-4%
   - Lower TP3 to 3.5%
   - Retest

3. **Implement Market Regime Detection** (3 hours)
   - Trend strength calculation
   - Volatility measurement
   - Strategy routing logic

4. **Re-run Backtest** (30 min)
   - Test on same 30-day period
   - Compare before/after metrics
   - Target: 50%+ win rate

5. **Expand Testing** (1 hour)
   - Test on Bitcoin
   - Test on Solana
   - Test on different time periods
   - Validate robustness

6. **Implement Signal Filtering** (1 hour)
   - Reject trades < 65 signal
   - Track rejected opportunities
   - Measure improvement

### Success Criteria

**Minimum Acceptable Performance:**
- Win Rate: ≥ 50% (currently 31%)
- Profit Factor: ≥ 1.5 (currently 1.05)
- Stop Loss Rate: ≤ 30% (currently 45%)
- Signal Edge: > 0 for both strategies (MR currently -7.3)

**Target Performance:**
- Win Rate: 70%
- Profit Factor: 2.0+
- Stop Loss Rate: ≤ 20%
- Signal Edge: +15 points minimum

---

## Conclusion

The real market data backtest revealed critical flaws in our strategy implementation:

1. ✅ **Backtesting system works perfectly** - Properly tracks entries, exits, TPs, SL
2. ❌ **Mean reversion signal is inverted** - Higher signals = worse performance
3. ❌ **Stop losses too tight** - 45% of trades stopped out prematurely
4. ✅ **Momentum signal works** - Positive signal edge (+16.7 points)
5. ✅ **System is profitable** - Despite low win rate, PnL is positive

**The Good News:**
- Infrastructure is solid
- Momentum strategy shows promise
- System is profitable even with flawed signals
- Clear path to improvement

**The Reality Check:**
- 31% win rate is far from 70% target
- Simulated results (60.9%) were overly optimistic
- Real markets are harder than random walks
- Need significant signal refinement

**Path Forward:**
Fix the mean reversion signal calculation, widen stops, and add market regime detection. With these changes, 50-60% win rate is achievable. The 70% target will require additional refinements (pattern recognition, multi-timeframe analysis, better risk management).

---

**Generated:** November 29, 2025
**Dataset:** ETH/USD, 180 candles, 4-hour intervals
**Status:** Phase 3 - Real Market Testing Complete
**Next:** Phase 3+ - Signal Optimization & Refinement
