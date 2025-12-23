#!/bin/bash
# Silverback DEX Intelligence API - cURL Examples
# https://x402.silverbackdefi.app

BASE_URL="https://x402.silverbackdefi.app"

echo "=== FREE ENDPOINTS ==="
echo ""

# Health Check
echo "1. Health Check"
curl -s "$BASE_URL/health" | jq .
echo ""

# Pricing Info
echo "2. API Pricing"
curl -s "$BASE_URL/api/v1/pricing" | jq .
echo ""

# Token Price (FREE)
echo "3. Token Price (Bitcoin)"
curl -s "$BASE_URL/api/v1/price/bitcoin" | jq .
echo ""

echo "=== PAID ENDPOINTS (Require x402 Payment) ==="
echo ""

# Swap Quote ($0.02)
echo "4. Swap Quote - WETH to USDC"
curl -s -X POST "$BASE_URL/api/v1/swap-quote" \
  -H "Content-Type: application/json" \
  -d '{
    "tokenIn": "0x4200000000000000000000000000000000000006",
    "tokenOut": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    "amountIn": "1.0"
  }' | jq .
echo ""

# Technical Analysis ($0.25)
echo "5. Technical Analysis - Bitcoin 7-day"
curl -s -X POST "$BASE_URL/api/v1/technical-analysis" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "bitcoin",
    "timeframe": "7"
  }' | jq .
echo ""

# DeFi Yield ($0.05)
echo "6. DeFi Yield Opportunities - USDC"
curl -s -X POST "$BASE_URL/api/v1/defi-yield" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "USDC",
    "riskTolerance": "medium"
  }' | jq .
echo ""

# Top Pools ($0.03)
echo "7. Top Pools"
curl -s "$BASE_URL/api/v1/top-pools?limit=5&minTvl=100000" | jq .
echo ""

# Top Protocols ($0.03)
echo "8. Top Protocols on Base"
curl -s "$BASE_URL/api/v1/top-protocols?limit=5&chain=base" | jq .
echo ""

# Top Coins ($0.03)
echo "9. Top Coins"
curl -s "$BASE_URL/api/v1/top-coins?limit=5" | jq .
echo ""

# DEX Metrics ($0.05)
echo "10. DEX Metrics"
curl -s "$BASE_URL/api/v1/dex-metrics" | jq .
echo ""

# Backtest ($1.00)
echo "11. Strategy Backtest - Bitcoin Momentum"
curl -s -X POST "$BASE_URL/api/v1/backtest" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "bitcoin",
    "strategy": "momentum",
    "period": "30",
    "signalThreshold": 70
  }' | jq .
echo ""

echo "=== NOTE ==="
echo "Paid endpoints will return 402 Payment Required with x402 payment details."
echo "Use an x402-compatible client to automatically handle payments."
echo "See: https://x402.silverbackdefi.app/api-docs"
