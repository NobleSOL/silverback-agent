# @silverback/defi-client

Official JavaScript/TypeScript SDK for the Silverback DEX Intelligence API with x402 micropayments.

## Installation

```bash
npm install @silverback/defi-client
# or
yarn add @silverback/defi-client
# or
pnpm add @silverback/defi-client
```

## Quick Start

```typescript
import { SilverbackClient, BASE_TOKENS } from '@silverback/defi-client';

// Initialize client
const client = new SilverbackClient();

// Get token price (FREE)
const price = await client.getTokenPrice('bitcoin');
console.log(`Bitcoin: $${price.data?.price.usd}`);

// Get swap quote ($0.02 USDC)
const quote = await client.getSwapQuote({
  tokenIn: BASE_TOKENS.WETH,
  tokenOut: BASE_TOKENS.USDC,
  amountIn: '1.0'
});
console.log(`1 WETH = ${quote.amountOut} USDC`);
```

## Features

- Full TypeScript support with complete type definitions
- Automatic x402 payment handling (coming soon)
- All 11 paid endpoints + 3 free endpoints
- Common Base token addresses included

## API Reference

### Free Endpoints (No Payment Required)

| Method | Price | Description |
|--------|-------|-------------|
| `getTokenPrice(token)` | Free | Real-time token price |
| `getPricing()` | Free | API pricing info |
| `healthCheck()` | Free | Health check |

### Paid Endpoints (USDC on Base)

| Method | Price | Description |
|--------|-------|-------------|
| `getSwapQuote(params)` | $0.02 | Optimal swap route |
| `executeSwap(params)` | $0.50 | Execute swap on DEX |
| `getTechnicalAnalysis(params)` | $0.25 | Full TA with indicators |
| `runBacktest(params)` | $1.00 | Strategy backtest |
| `getPoolAnalysis(params)` | $0.10 | Pool health scoring |
| `getYieldOpportunities(params)` | $0.05 | DeFi yield finder |
| `getLPAnalysis(params)` | $0.05 | LP position analysis |
| `getTopPools(params)` | $0.03 | Top yielding pools |
| `getDexMetrics()` | $0.05 | DEX statistics |
| `getTopProtocols(params)` | $0.03 | Top protocols by TVL |
| `getTopCoins(params)` | $0.03 | Top coins by market cap |

## Examples

### Technical Analysis

```typescript
const analysis = await client.getTechnicalAnalysis({
  token: 'bitcoin',
  timeframe: '7'
});

console.log(`RSI: ${analysis.rsi}`);
console.log(`Trend: ${analysis.trend}`);
console.log(`Recommendation: ${analysis.recommendation}`);
```

### Find Yield Opportunities

```typescript
const yields = await client.getYieldOpportunities({
  token: 'USDC',
  riskTolerance: 'medium'
});

console.log(`Found ${yields.totalOpportunities} opportunities`);
console.log(`Best APR: ${yields.bestApr}`);
```

### Strategy Backtest

```typescript
const backtest = await client.runBacktest({
  token: 'ethereum',
  strategy: 'momentum',
  period: '30',
  signalThreshold: 70
});

console.log(`Total Return: ${backtest.data?.stats.totalReturn}`);
console.log(`Win Rate: ${backtest.data?.stats.winRate}`);
```

### Execute Swap

```typescript
const swap = await client.executeSwap({
  tokenIn: 'USDC',
  tokenOut: 'WETH',
  amountIn: '100',
  slippage: '0.5',
  walletAddress: '0x...'
});

console.log(`TX Hash: ${swap.txHash}`);
```

## Base Token Addresses

The SDK exports common Base chain token addresses:

```typescript
import { BASE_TOKENS } from '@silverback/defi-client';

BASE_TOKENS.WETH   // 0x4200000000000000000000000000000000000006
BASE_TOKENS.USDC   // 0x833589fcd6edb6e08f4c7c32d4f71b54bda02913
BASE_TOKENS.USDbC  // 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA
BASE_TOKENS.DAI    // 0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb
BASE_TOKENS.BACK   // 0x558881c4959e9cf961a7E1815FCD6586906babd2
```

## Payment Protocol

This API uses the x402 protocol for micropayments:

1. Call any paid endpoint
2. If payment is required, you'll receive a 402 response
3. Pay the specified USDC amount on Base chain
4. Retry the request with the payment proof
5. Receive your data

> **Note:** Automatic payment handling is coming in a future release. For now, see the [x402 documentation](https://github.com/anthropics/x402) for client-side payment implementation.

## Links

- [API Documentation](https://x402.silverbackdefi.app/api-docs)
- [OpenAPI Spec](https://x402.silverbackdefi.app/api/v1/openapi.json)
- [Silverback DEX](https://silverbackdefi.app)

## License

MIT
