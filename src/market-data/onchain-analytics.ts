/**
 * On-Chain Analytics Module
 *
 * Tracks whale movements, exchange flows, and on-chain metrics
 * to inform trading decisions.
 *
 * Key Concepts:
 * - Exchange Inflows: Tokens moving TO exchanges = potential sell pressure
 * - Exchange Outflows: Tokens moving FROM exchanges = accumulation (bullish)
 * - Whale Accumulation: Large holders buying = bullish
 * - Whale Distribution: Large holders selling = bearish
 */

import {
    GameFunction,
    ExecutableGameFunctionResponse,
    ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";

// ============ TYPES ============

export interface WhaleActivity {
    type: 'accumulation' | 'distribution' | 'transfer';
    amount: number;
    amountUSD: number;
    from: string;
    to: string;
    isExchangeInflow: boolean;
    isExchangeOutflow: boolean;
    timestamp: string;
    significance: 'low' | 'medium' | 'high' | 'extreme';
}

export interface ExchangeFlow {
    exchange: string;
    netFlow24h: number;  // Positive = inflow (bearish), Negative = outflow (bullish)
    inflow24h: number;
    outflow24h: number;
    interpretation: string;
}

export interface OnChainMetrics {
    activeAddresses24h: number;
    transactionCount24h: number;
    avgTransactionValue: number;
    largeTransactions: number;  // >$100k
    exchangeReserves: number;
    exchangeReserveChange24h: number;  // % change
    whaleActivityScore: number;  // -100 to 100 (negative = distribution, positive = accumulation)
}

export interface OnChainSignal {
    signal: 'bullish' | 'bearish' | 'neutral';
    confidence: number;  // 0-100
    reasons: string[];
    keyMetrics: {
        exchangeFlow: 'inflow' | 'outflow' | 'balanced';
        whaleActivity: 'accumulating' | 'distributing' | 'neutral';
        networkActivity: 'high' | 'normal' | 'low';
    };
}

// ============ KNOWN EXCHANGE ADDRESSES ============

const KNOWN_EXCHANGES: Record<string, string[]> = {
    'Binance': [
        '0x28c6c06298d514db089934071355e5743bf21d60',
        '0x21a31ee1afc51d94c2efccaa2092ad1028285549',
        '0xdfd5293d8e347dfe59e90efd55b2956a1343963d'
    ],
    'Coinbase': [
        '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
        '0xa9d1e08c7793af67e9d92fe308d5697fb81d3e43',
        '0x503828976d22510aad0201ac7ec88293211d23da'
    ],
    'Kraken': [
        '0x2910543af39aba0cd09dbb2d50200b3e800a63d2',
        '0x0a869d79a7052c7f1b55a8ebabbea3420f0d1e13'
    ],
    'OKX': [
        '0x6cc5f688a315f3dc28a7781717a9a798a59fda7b'
    ],
    'Bybit': [
        '0xf89d7b9c864f589bbf53a82105107622b35eaa40'
    ]
};

// Flatten for quick lookup
const ALL_EXCHANGE_ADDRESSES = new Set(
    Object.values(KNOWN_EXCHANGES).flat().map(a => a.toLowerCase())
);

// ============ HELPER FUNCTIONS ============

/**
 * Check if an address is a known exchange
 */
export function isExchangeAddress(address: string): { isExchange: boolean; exchangeName?: string } {
    const lowerAddress = address.toLowerCase();

    for (const [exchange, addresses] of Object.entries(KNOWN_EXCHANGES)) {
        if (addresses.some(a => a.toLowerCase() === lowerAddress)) {
            return { isExchange: true, exchangeName: exchange };
        }
    }

    return { isExchange: false };
}

/**
 * Classify transaction significance based on USD value
 */
export function classifyTransactionSize(amountUSD: number): WhaleActivity['significance'] {
    if (amountUSD >= 10_000_000) return 'extreme';  // $10M+
    if (amountUSD >= 1_000_000) return 'high';      // $1M+
    if (amountUSD >= 100_000) return 'medium';      // $100k+
    return 'low';
}

/**
 * Interpret exchange flow for trading
 */
export function interpretExchangeFlow(netFlow: number, tokenSymbol: string): string {
    if (netFlow > 1_000_000) {
        return `BEARISH: Large ${tokenSymbol} inflow to exchanges ($${(netFlow/1e6).toFixed(1)}M). Potential sell pressure.`;
    } else if (netFlow > 100_000) {
        return `CAUTIOUS: Moderate ${tokenSymbol} inflow ($${(netFlow/1e3).toFixed(0)}K). Watch for selling.`;
    } else if (netFlow < -1_000_000) {
        return `BULLISH: Large ${tokenSymbol} outflow from exchanges ($${(Math.abs(netFlow)/1e6).toFixed(1)}M). Accumulation signal.`;
    } else if (netFlow < -100_000) {
        return `POSITIVE: Moderate ${tokenSymbol} outflow ($${(Math.abs(netFlow)/1e3).toFixed(0)}K). Some accumulation.`;
    }
    return `NEUTRAL: Balanced ${tokenSymbol} exchange flows. No strong signal.`;
}

/**
 * Calculate whale activity score from transactions
 */
export function calculateWhaleScore(activities: WhaleActivity[]): number {
    let score = 0;

    for (const activity of activities) {
        const weight = activity.significance === 'extreme' ? 4 :
                      activity.significance === 'high' ? 2 :
                      activity.significance === 'medium' ? 1 : 0.5;

        if (activity.isExchangeOutflow) {
            score += weight * 10;  // Bullish
        } else if (activity.isExchangeInflow) {
            score -= weight * 10;  // Bearish
        } else if (activity.type === 'accumulation') {
            score += weight * 5;
        } else if (activity.type === 'distribution') {
            score -= weight * 5;
        }
    }

    // Clamp to -100 to 100
    return Math.max(-100, Math.min(100, score));
}

/**
 * Generate on-chain trading signal
 */
export function generateOnChainSignal(
    exchangeNetFlow: number,
    whaleScore: number,
    activeAddressChange: number  // % change in active addresses
): OnChainSignal {
    const reasons: string[] = [];
    let bullishPoints = 0;
    let bearishPoints = 0;

    // Exchange flow analysis
    if (exchangeNetFlow < -500_000) {
        bullishPoints += 30;
        reasons.push('Significant exchange outflows (accumulation)');
    } else if (exchangeNetFlow < -100_000) {
        bullishPoints += 15;
        reasons.push('Moderate exchange outflows');
    } else if (exchangeNetFlow > 500_000) {
        bearishPoints += 30;
        reasons.push('Significant exchange inflows (distribution)');
    } else if (exchangeNetFlow > 100_000) {
        bearishPoints += 15;
        reasons.push('Moderate exchange inflows');
    }

    // Whale activity
    if (whaleScore > 50) {
        bullishPoints += 25;
        reasons.push('Strong whale accumulation');
    } else if (whaleScore > 20) {
        bullishPoints += 10;
        reasons.push('Moderate whale buying');
    } else if (whaleScore < -50) {
        bearishPoints += 25;
        reasons.push('Strong whale distribution');
    } else if (whaleScore < -20) {
        bearishPoints += 10;
        reasons.push('Moderate whale selling');
    }

    // Network activity
    if (activeAddressChange > 20) {
        bullishPoints += 15;
        reasons.push('Surge in network activity');
    } else if (activeAddressChange < -20) {
        bearishPoints += 10;
        reasons.push('Declining network activity');
    }

    // Determine signal
    const netScore = bullishPoints - bearishPoints;
    let signal: OnChainSignal['signal'];
    let confidence: number;

    if (netScore >= 30) {
        signal = 'bullish';
        confidence = Math.min(90, 50 + netScore);
    } else if (netScore <= -30) {
        signal = 'bearish';
        confidence = Math.min(90, 50 + Math.abs(netScore));
    } else {
        signal = 'neutral';
        confidence = 40 + Math.abs(netScore);
    }

    return {
        signal,
        confidence,
        reasons: reasons.length > 0 ? reasons : ['No significant on-chain signals'],
        keyMetrics: {
            exchangeFlow: exchangeNetFlow > 100_000 ? 'inflow' :
                         exchangeNetFlow < -100_000 ? 'outflow' : 'balanced',
            whaleActivity: whaleScore > 20 ? 'accumulating' :
                          whaleScore < -20 ? 'distributing' : 'neutral',
            networkActivity: activeAddressChange > 10 ? 'high' :
                            activeAddressChange < -10 ? 'low' : 'normal'
        }
    };
}

// ============ GAME FUNCTIONS ============

/**
 * Get simulated on-chain analysis (for learning purposes)
 * In production, connect to Arkham, Nansen, or Glassnode APIs
 */
export const getOnChainAnalysisFunction = new GameFunction({
    name: "get_onchain_analysis",
    description: `Get on-chain analysis for a token to understand whale behavior and exchange flows.

    Key Concepts:
    - Exchange Inflows: Tokens TO exchanges = SELL PRESSURE (bearish)
    - Exchange Outflows: Tokens FROM exchanges = ACCUMULATION (bullish)
    - Whale Accumulation: Large holders buying = bullish
    - Whale Distribution: Large holders selling = bearish

    Use this BEFORE trading to understand:
    1. Are whales buying or selling?
    2. Is there exchange inflow (selling) or outflow (accumulation)?
    3. Is network activity growing or declining?

    Note: Currently uses simulated data for learning. Configure API keys for live data.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        try {
            logger(`Analyzing on-chain data for ${args.symbol}...`);

            // Simulate realistic on-chain data for learning
            // In production, replace with actual API calls
            const symbol = args.symbol.toUpperCase();

            // Generate semi-random but realistic data
            const seed = symbol.charCodeAt(0) + new Date().getHours();
            const randomFactor = Math.sin(seed) * 0.5 + 0.5;  // 0-1 based on symbol + time

            // Exchange flow simulation (positive = inflow/bearish, negative = outflow/bullish)
            const exchangeNetFlow = (randomFactor - 0.5) * 2_000_000;  // -$1M to +$1M

            // Whale score simulation (-100 to 100)
            const whaleScore = Math.round((randomFactor - 0.5) * 150);

            // Active address change simulation
            const activeAddressChange = (randomFactor - 0.5) * 40;  // -20% to +20%

            // Generate signal
            const signal = generateOnChainSignal(exchangeNetFlow, whaleScore, activeAddressChange);

            // Simulate key metrics
            const metrics: OnChainMetrics = {
                activeAddresses24h: Math.round(50000 + randomFactor * 100000),
                transactionCount24h: Math.round(100000 + randomFactor * 200000),
                avgTransactionValue: Math.round(1000 + randomFactor * 9000),
                largeTransactions: Math.round(50 + randomFactor * 150),
                exchangeReserves: Math.round(1000000 + randomFactor * 5000000),
                exchangeReserveChange24h: (randomFactor - 0.5) * 10,
                whaleActivityScore: whaleScore
            };

            // Exchange-specific flows
            const exchangeFlows: ExchangeFlow[] = [
                {
                    exchange: 'Binance',
                    netFlow24h: exchangeNetFlow * 0.4,
                    inflow24h: Math.abs(exchangeNetFlow * 0.4) + 100000,
                    outflow24h: Math.abs(exchangeNetFlow * 0.4) * (exchangeNetFlow > 0 ? 0.5 : 1.5),
                    interpretation: interpretExchangeFlow(exchangeNetFlow * 0.4, symbol)
                },
                {
                    exchange: 'Coinbase',
                    netFlow24h: exchangeNetFlow * 0.3,
                    inflow24h: Math.abs(exchangeNetFlow * 0.3) + 50000,
                    outflow24h: Math.abs(exchangeNetFlow * 0.3) * (exchangeNetFlow > 0 ? 0.6 : 1.4),
                    interpretation: interpretExchangeFlow(exchangeNetFlow * 0.3, symbol)
                },
                {
                    exchange: 'Kraken',
                    netFlow24h: exchangeNetFlow * 0.15,
                    inflow24h: Math.abs(exchangeNetFlow * 0.15) + 20000,
                    outflow24h: Math.abs(exchangeNetFlow * 0.15) * (exchangeNetFlow > 0 ? 0.7 : 1.3),
                    interpretation: interpretExchangeFlow(exchangeNetFlow * 0.15, symbol)
                }
            ];

            const result = {
                symbol,
                signal: signal,
                metrics: metrics,
                exchangeFlows: exchangeFlows,
                summary: {
                    overallFlow: exchangeNetFlow > 0 ? 'NET_INFLOW' : 'NET_OUTFLOW',
                    flowAmount: `$${Math.abs(exchangeNetFlow / 1e6).toFixed(2)}M`,
                    whaleActivity: whaleScore > 20 ? 'ACCUMULATING' : whaleScore < -20 ? 'DISTRIBUTING' : 'NEUTRAL',
                    networkTrend: activeAddressChange > 5 ? 'GROWING' : activeAddressChange < -5 ? 'DECLINING' : 'STABLE'
                },
                tradingImplications: {
                    forLongs: signal.signal === 'bullish'
                        ? '✅ On-chain supports long positions'
                        : signal.signal === 'bearish'
                        ? '⚠️ On-chain suggests caution for longs'
                        : '➖ On-chain neutral - use other signals',
                    forShorts: signal.signal === 'bearish'
                        ? '✅ On-chain supports short positions'
                        : signal.signal === 'bullish'
                        ? '⚠️ On-chain suggests caution for shorts'
                        : '➖ On-chain neutral - use other signals',
                    keyInsight: signal.reasons[0] || 'No strong on-chain signal'
                },
                dataSource: 'SIMULATED - Configure API keys for live data',
                timestamp: new Date().toISOString()
            };

            logger(`${symbol} On-Chain: ${signal.signal.toUpperCase()} (${signal.confidence}% confidence)`);
            logger(`  Whale Score: ${whaleScore}, Exchange Flow: $${(exchangeNetFlow/1e6).toFixed(2)}M`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to analyze on-chain data: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get whale alert summary
 */
export const getWhaleAlertsFunction = new GameFunction({
    name: "get_whale_alerts",
    description: `Get recent large transactions (whale movements) for a token.

    Whale alerts help you understand:
    - Where large holders are moving funds
    - Exchange inflows/outflows from major wallets
    - Potential market-moving transactions

    Transaction significance:
    - EXTREME: $10M+ (major market mover)
    - HIGH: $1M-$10M (significant)
    - MEDIUM: $100K-$1M (notable)
    - LOW: <$100K (normal activity)

    Note: Currently uses simulated data for learning.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        },
        {
            name: "min_usd",
            description: "Minimum USD value to show (default: 100000)"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        try {
            const minUsd = parseInt(args.min_usd || '100000');
            logger(`Fetching whale alerts for ${args.symbol} (min $${minUsd.toLocaleString()})...`);

            const symbol = args.symbol.toUpperCase();

            // Simulate whale transactions for learning
            const now = Date.now();
            const activities: WhaleActivity[] = [];

            // Generate 5-10 simulated whale transactions
            const numTx = 5 + Math.floor(Math.random() * 6);
            const exchanges = Object.keys(KNOWN_EXCHANGES);

            for (let i = 0; i < numTx; i++) {
                const amountUSD = minUsd + Math.random() * 5_000_000;
                const isToExchange = Math.random() > 0.5;
                const exchangeName = exchanges[Math.floor(Math.random() * exchanges.length)];

                let type: WhaleActivity['type'];
                if (isToExchange) {
                    type = 'distribution';
                } else if (Math.random() > 0.3) {
                    type = 'accumulation';
                } else {
                    type = 'transfer';
                }

                activities.push({
                    type,
                    amount: amountUSD / (symbol === 'BTC' ? 95000 : symbol === 'ETH' ? 3500 : 100),
                    amountUSD,
                    from: isToExchange ? '0x' + 'a'.repeat(40) : KNOWN_EXCHANGES[exchangeName][0],
                    to: isToExchange ? KNOWN_EXCHANGES[exchangeName][0] : '0x' + 'b'.repeat(40),
                    isExchangeInflow: isToExchange,
                    isExchangeOutflow: !isToExchange && type !== 'transfer',
                    timestamp: new Date(now - i * 3600000).toISOString(),
                    significance: classifyTransactionSize(amountUSD)
                });
            }

            // Sort by amount (largest first)
            activities.sort((a, b) => b.amountUSD - a.amountUSD);

            // Calculate summary
            const totalInflow = activities.filter(a => a.isExchangeInflow)
                .reduce((sum, a) => sum + a.amountUSD, 0);
            const totalOutflow = activities.filter(a => a.isExchangeOutflow)
                .reduce((sum, a) => sum + a.amountUSD, 0);
            const whaleScore = calculateWhaleScore(activities);

            const result = {
                symbol,
                alerts: activities.map(a => ({
                    type: a.type,
                    amount: `${a.amount.toFixed(4)} ${symbol}`,
                    amountUSD: `$${(a.amountUSD/1e6).toFixed(2)}M`,
                    direction: a.isExchangeInflow ? 'TO_EXCHANGE' : a.isExchangeOutflow ? 'FROM_EXCHANGE' : 'WALLET_TO_WALLET',
                    significance: a.significance,
                    time: a.timestamp,
                    interpretation: a.isExchangeInflow
                        ? '🔴 Potential sell pressure'
                        : a.isExchangeOutflow
                        ? '🟢 Accumulation'
                        : '➖ Internal transfer'
                })),
                summary: {
                    totalAlerts: activities.length,
                    exchangeInflows: `$${(totalInflow/1e6).toFixed(2)}M`,
                    exchangeOutflows: `$${(totalOutflow/1e6).toFixed(2)}M`,
                    netFlow: `$${((totalInflow - totalOutflow)/1e6).toFixed(2)}M`,
                    whaleScore: whaleScore,
                    overallSentiment: whaleScore > 20 ? 'BULLISH (accumulation)' :
                                     whaleScore < -20 ? 'BEARISH (distribution)' : 'NEUTRAL'
                },
                learningNotes: [
                    'Exchange inflows often precede selling - bearish signal',
                    'Exchange outflows indicate accumulation - bullish signal',
                    'Watch for extreme-significance transactions around key price levels',
                    'Whale activity often front-runs major moves by 12-48 hours'
                ],
                dataSource: 'SIMULATED - Configure API keys for live data',
                timestamp: new Date().toISOString()
            };

            logger(`${symbol}: ${activities.length} whale alerts, Score: ${whaleScore}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch whale alerts: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get funding rates (futures market sentiment)
 */
export const getFundingRatesFunction = new GameFunction({
    name: "get_funding_rates",
    description: `Get perpetual futures funding rates to understand market positioning.

    Funding Rate Concepts:
    - Positive funding: Longs pay shorts = Market is overleveraged long (potential short squeeze if too extreme)
    - Negative funding: Shorts pay longs = Market is overleveraged short (potential long squeeze)
    - Extreme positive (>0.1%): Consider shorting - market too bullish
    - Extreme negative (<-0.1%): Consider longing - market too bearish

    Funding resets every 8 hours on most exchanges.
    High funding = crowded trade = potential reversal.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        try {
            logger(`Fetching funding rates for ${args.symbol}...`);

            const symbol = args.symbol.toUpperCase();

            // Try to fetch real funding data from Binance
            let fundingData: any = null;
            try {
                const response = await fetch(
                    `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}USDT&limit=8`
                );
                if (response.ok) {
                    fundingData = await response.json();
                }
            } catch (e) {
                logger('Could not fetch live funding data, using simulation');
            }

            let currentRate: number;
            let avgRate8h: number;
            let rates: Array<{ time: string; rate: number }>;

            if (fundingData && fundingData.length > 0) {
                // Use real data
                rates = fundingData.map((d: any) => ({
                    time: new Date(d.fundingTime).toISOString(),
                    rate: parseFloat(d.fundingRate) * 100  // Convert to percentage
                }));
                currentRate = rates[rates.length - 1].rate;
                avgRate8h = rates.slice(-3).reduce((sum, r) => sum + r.rate, 0) / Math.min(3, rates.length);
            } else {
                // Simulate funding data
                const seed = symbol.charCodeAt(0) + new Date().getHours();
                currentRate = (Math.sin(seed) * 0.15);  // -0.15% to +0.15%
                avgRate8h = currentRate * 0.8;
                rates = [];
                for (let i = 7; i >= 0; i--) {
                    rates.push({
                        time: new Date(Date.now() - i * 8 * 3600000).toISOString(),
                        rate: currentRate + (Math.random() - 0.5) * 0.05
                    });
                }
            }

            // Interpret funding rate
            let interpretation: string;
            let tradingBias: string;

            if (currentRate > 0.1) {
                interpretation = 'EXTREMELY_BULLISH_CROWD - Overleveraged longs, potential squeeze DOWN';
                tradingBias = 'CONTRARIAN_SHORT';
            } else if (currentRate > 0.05) {
                interpretation = 'BULLISH_CROWD - Many longs, watch for correction';
                tradingBias = 'CAUTIOUS_LONG';
            } else if (currentRate > 0.01) {
                interpretation = 'SLIGHTLY_BULLISH - Normal bullish sentiment';
                tradingBias = 'NEUTRAL';
            } else if (currentRate > -0.01) {
                interpretation = 'NEUTRAL - Balanced positioning';
                tradingBias = 'NEUTRAL';
            } else if (currentRate > -0.05) {
                interpretation = 'SLIGHTLY_BEARISH - Normal bearish sentiment';
                tradingBias = 'NEUTRAL';
            } else if (currentRate > -0.1) {
                interpretation = 'BEARISH_CROWD - Many shorts, watch for bounce';
                tradingBias = 'CAUTIOUS_SHORT';
            } else {
                interpretation = 'EXTREMELY_BEARISH_CROWD - Overleveraged shorts, potential squeeze UP';
                tradingBias = 'CONTRARIAN_LONG';
            }

            // Calculate annualized rate
            const annualizedRate = currentRate * 3 * 365;  // 3 funding periods per day

            const result = {
                symbol,
                currentFunding: {
                    rate: `${currentRate.toFixed(4)}%`,
                    annualized: `${annualizedRate.toFixed(1)}%`,
                    interpretation: interpretation
                },
                average24h: `${avgRate8h.toFixed(4)}%`,
                recentRates: rates.slice(-4),
                marketPositioning: {
                    crowd: currentRate > 0.01 ? 'LONG' : currentRate < -0.01 ? 'SHORT' : 'BALANCED',
                    extremity: Math.abs(currentRate) > 0.1 ? 'EXTREME' : Math.abs(currentRate) > 0.05 ? 'HIGH' : 'NORMAL',
                    contrarian: tradingBias.includes('CONTRARIAN')
                },
                tradingGuidance: {
                    bias: tradingBias,
                    reasoning: interpretation,
                    action: tradingBias === 'CONTRARIAN_LONG'
                        ? 'Look for long entries - crowd is wrong'
                        : tradingBias === 'CONTRARIAN_SHORT'
                        ? 'Look for short entries - crowd is wrong'
                        : 'Follow primary signals, funding is neutral'
                },
                learningNotes: [
                    'Extreme funding often precedes reversals',
                    'Funding >0.1% = expensive to hold longs, potential short setup',
                    'Funding <-0.1% = expensive to hold shorts, potential long setup',
                    'Best trades often go against extreme funding'
                ],
                dataSource: fundingData ? 'Binance Futures' : 'SIMULATED',
                timestamp: new Date().toISOString()
            };

            logger(`${symbol}: Funding ${currentRate.toFixed(4)}% - ${interpretation}`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch funding rates: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});

/**
 * Get open interest data
 */
export const getOpenInterestFunction = new GameFunction({
    name: "get_open_interest",
    description: `Get open interest data to understand futures market leverage.

    Open Interest Concepts:
    - OI = Total open futures contracts (both longs and shorts)
    - Rising OI + Rising Price = New longs entering (trend strength)
    - Rising OI + Falling Price = New shorts entering (trend strength)
    - Falling OI + Rising Price = Short covering (potential exhaustion)
    - Falling OI + Falling Price = Long liquidation (potential exhaustion)

    High OI = Lots of leverage = Potential for liquidation cascades.`,
    args: [
        {
            name: "symbol",
            description: "Token symbol (e.g., 'BTC', 'ETH')"
        }
    ] as const,
    executable: async (args, logger) => {
        if (!args.symbol) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                "Token symbol is required"
            );
        }

        try {
            logger(`Fetching open interest for ${args.symbol}...`);

            const symbol = args.symbol.toUpperCase();

            // Try to fetch real OI data from Binance
            let oiData: any = null;
            try {
                const response = await fetch(
                    `https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}USDT`
                );
                if (response.ok) {
                    oiData = await response.json();
                }
            } catch (e) {
                logger('Could not fetch live OI data, using simulation');
            }

            let openInterest: number;
            let openInterestUSD: number;

            if (oiData && oiData.openInterest) {
                openInterest = parseFloat(oiData.openInterest);
                // Estimate USD value (would need price API for exact)
                const priceEstimate = symbol === 'BTC' ? 95000 : symbol === 'ETH' ? 3500 : 100;
                openInterestUSD = openInterest * priceEstimate;
            } else {
                // Simulate OI data
                const baseOI = symbol === 'BTC' ? 50000 : symbol === 'ETH' ? 500000 : 1000000;
                openInterest = baseOI * (0.8 + Math.random() * 0.4);
                const priceEstimate = symbol === 'BTC' ? 95000 : symbol === 'ETH' ? 3500 : 100;
                openInterestUSD = openInterest * priceEstimate;
            }

            // Simulate 24h change
            const oiChange24h = (Math.random() - 0.5) * 20;  // -10% to +10%
            const priceChange24h = (Math.random() - 0.5) * 10;  // -5% to +5%

            // Interpret OI + Price relationship
            let interpretation: string;
            let marketPhase: string;

            if (oiChange24h > 5 && priceChange24h > 2) {
                interpretation = 'New longs entering - bullish trend strengthening';
                marketPhase = 'ACCUMULATION';
            } else if (oiChange24h > 5 && priceChange24h < -2) {
                interpretation = 'New shorts entering - bearish trend strengthening';
                marketPhase = 'DISTRIBUTION';
            } else if (oiChange24h < -5 && priceChange24h > 2) {
                interpretation = 'Short covering rally - potential exhaustion';
                marketPhase = 'SHORT_SQUEEZE';
            } else if (oiChange24h < -5 && priceChange24h < -2) {
                interpretation = 'Long liquidation cascade - potential exhaustion';
                marketPhase = 'LONG_SQUEEZE';
            } else {
                interpretation = 'Consolidation - no clear direction';
                marketPhase = 'CONSOLIDATION';
            }

            // Risk assessment based on OI levels
            const oiRisk = openInterestUSD > 5e9 ? 'EXTREME' :
                          openInterestUSD > 2e9 ? 'HIGH' :
                          openInterestUSD > 500e6 ? 'MEDIUM' : 'LOW';

            const result = {
                symbol,
                openInterest: {
                    contracts: openInterest.toFixed(2),
                    usdValue: `$${(openInterestUSD/1e9).toFixed(2)}B`,
                    change24h: `${oiChange24h > 0 ? '+' : ''}${oiChange24h.toFixed(1)}%`
                },
                priceContext: {
                    change24h: `${priceChange24h > 0 ? '+' : ''}${priceChange24h.toFixed(1)}%`,
                    oiPriceRelation: interpretation
                },
                marketPhase: marketPhase,
                riskAssessment: {
                    leverageLevel: oiRisk,
                    liquidationRisk: oiRisk === 'EXTREME' || oiRisk === 'HIGH'
                        ? 'Elevated - expect volatility on sudden moves'
                        : 'Normal - standard risk management applies',
                    recommendation: oiRisk === 'EXTREME'
                        ? 'Reduce position size - high liquidation cascade risk'
                        : oiRisk === 'HIGH'
                        ? 'Use tighter stops - elevated leverage in market'
                        : 'Normal position sizing appropriate'
                },
                tradingImplications: {
                    forLongs: marketPhase === 'ACCUMULATION'
                        ? '✅ New longs entering - trend support'
                        : marketPhase === 'LONG_SQUEEZE'
                        ? '⚠️ Longs liquidating - wait for stabilization'
                        : '➖ No clear edge from OI',
                    forShorts: marketPhase === 'DISTRIBUTION'
                        ? '✅ New shorts entering - trend support'
                        : marketPhase === 'SHORT_SQUEEZE'
                        ? '⚠️ Shorts covering - wait for stabilization'
                        : '➖ No clear edge from OI'
                },
                learningNotes: [
                    'High OI + sudden price move = liquidation cascade risk',
                    'Falling OI during trend = exhaustion signal',
                    'Rising OI confirms trend conviction',
                    'Monitor OI changes around key support/resistance'
                ],
                dataSource: oiData ? 'Binance Futures' : 'SIMULATED',
                timestamp: new Date().toISOString()
            };

            logger(`${symbol}: OI $${(openInterestUSD/1e9).toFixed(2)}B, Change: ${oiChange24h.toFixed(1)}%`);

            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Done,
                JSON.stringify(result)
            );
        } catch (e) {
            return new ExecutableGameFunctionResponse(
                ExecutableGameFunctionStatus.Failed,
                `Failed to fetch open interest: ${e instanceof Error ? e.message : 'Unknown error'}`
            );
        }
    }
});
