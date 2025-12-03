# Silverback Workers Architecture

This document outlines the specialized worker structure for Silverback agent.

## Architecture Principle

**Key Insight:** The Task Generator (HLP) sees worker **descriptions** but NOT their **functions**. Therefore, worker descriptions must clearly communicate ALL capabilities to enable proper task delegation.

## Worker Definitions

### 1. Twitter Worker

**ID:** `twitter_worker`
**Purpose:** Handle all Twitter/X interactions

**Capabilities:**
1. **Content Creation:** Publishing tweets about trading insights, market observations, DEX updates, and performance reports
2. **Engagement:** Replying to mentions, quote tweeting relevant content, liking posts from the community
3. **Education:** Creating educational threads about DeFi concepts, risk management, and trading fundamentals
4. **Community Protection:** Warning about scams, identifying red flags, protecting the pack
5. **Performance Updates:** Sharing trading results, wins and losses, lessons learned

**Functions:**
- `post_tweet` - Publish tweets (max 280 chars)
- `post_daily_stats` - Automated daily DEX statistics
- `reply_to_tweet` - Engage with community questions
- `search_mentions` - Find and monitor discussions
- `explain_impermanent_loss` - Educational content with real pool data
- `explain_amm` - AMM mechanics explanation
- `identify_scam_signals` - Analyze projects for scam patterns

**Location:** `src/workers/twitter-worker.ts`

---

### 2. Trading Worker

**ID:** `trading_worker`
**Purpose:** Handle all trading and swap operations on Base chain

**Phase 1 (Current - Read-Only):**
1. **Swap Quotes:** Get real-time pricing for token swaps through Silverback DEX
2. **Liquidity Analysis:** Check if pairs exist and analyze reserve depth
3. **Price Discovery:** Get USD prices for tokens via WETH pairs
4. **Risk Assessment:** Calculate price impact and slippage estimates

**Phase 2 (Coming Soon - Requires Wallet):**
5. **Trade Execution:** Execute swaps through Silverback unified router

**Functions:**
- `get_swap_quote` ✅ - Get quotes from Silverback DEX on Base (uses UniV2 router)
- `check_liquidity` ✅ - Verify pair exists and get reserves
- `get_token_price` ✅ - USD price via WETH pair calculation
- `token_swap` ⏳ - Phase 2 - Execute swaps (disabled until wallet ready)

**Technical Details:**
- Chain: Base Mainnet
- Router: `0x565cBf0F3eAdD873212Db91896e9a548f6D64894` (Silverback Unified Router)
- Factory: `0x9cd714C51586B52DD56EbD19E3676de65eBf44Ae` (Silverback V2 Factory)
- RPC: Uses ethers.js JsonRpcProvider
- ABIs: Standard Uniswap V2 compatible

**Location:** `src/workers/trading-worker.ts`
**Functions:** `src/trading-functions.ts`

---

### 3. Analytics Worker

**ID:** `analytics_worker`
**Purpose:** Handle data analysis and reporting

**Capabilities:**
1. **Performance Tracking:** Monitoring treasury performance, win rates, and returns
2. **Market Intelligence:** Analyzing on-chain data, liquidity flows, and trends
3. **Report Generation:** Creating daily, weekly, and monthly performance summaries
4. **Metrics Collection:** Gathering DEX stats, trading volume, and ecosystem health data
5. **Transparency Reports:** Documenting all trading activity for community visibility

**Functions:**
- *To be defined based on requirements*
- Performance tracking functions
- Report generation functions
- Metrics collection functions

**Location:** `src/workers/analytics-worker.ts`

---

## File Structure

```
src/
├── agent.ts                          # Main agent configuration
├── workers/
│   ├── twitter-worker.ts            # Twitter/X interaction worker
│   ├── trading-worker.ts            # Trading execution worker
│   └── analytics-worker.ts          # Data analysis worker
├── functions.ts                     # Trading functions (DEX operations)
├── twitter-functions.ts             # Social media functions
├── education-functions.ts           # Educational content functions
└── twitter.ts                       # Twitter client setup
```

## Design Principles

### 1. Clear Descriptions

Worker descriptions must be comprehensive because Task Generator can't see functions. Include:
- All 5 capabilities numbered clearly
- "Use this worker when..." section
- Specific use cases

### 2. Separation of Concerns

Each worker handles a distinct domain:
- **Twitter:** All social media
- **Trading:** All DEX operations
- **Analytics:** All data analysis

### 3. Function Organization

Functions are organized by domain, then imported into appropriate workers:
- Trading functions → Trading Worker
- Twitter functions → Twitter Worker
- Education functions → Twitter Worker (educational content via social)
- Analytics functions → Analytics Worker

### 4. Scalability

New capabilities can be added by:
1. Creating new functions in appropriate function file
2. Adding function to relevant worker
3. Updating worker description to reflect new capability

## Worker Selection Logic

When Silverback needs to:

**Post on social media** → Twitter Worker
**Execute a swap** → Trading Worker
**Analyze performance** → Analytics Worker
**Educate community** → Twitter Worker
**Get market data** → Trading Worker
**Generate reports** → Analytics Worker
**Warn about scams** → Twitter Worker
**Track treasury** → Analytics Worker

## Integration with Agent

Workers are registered in `src/agent.ts`:

```typescript
import { twitterWorker } from "./workers/twitter-worker";
import { tradingWorker } from "./workers/trading-worker";
import { analyticsWorker } from "./workers/analytics-worker";

export const silverback_agent = new GameAgent(process.env.API_KEY, {
    // ... agent config
    workers: [twitterWorker, tradingWorker, analyticsWorker],
    // ...
});
```

## Token Symbol

**Official Token:** $BACK (not $SBCK)
All references updated across codebase to use correct $BACK symbol.

## Next Steps

1. **Define Analytics Functions** - Implement performance tracking, report generation
2. **Test Worker Delegation** - Verify Task Generator properly selects workers
3. **Monitor Function Usage** - Track which functions are called most often
4. **Optimize Descriptions** - Refine based on Task Generator behavior
5. **Add More Functions** - Expand capabilities as needed

---

**Last Updated:** Based on GAME architecture best practices
**Status:** Production Ready (pending analytics function implementation)
