/**
 * Trading Sessions & Killzones Module
 *
 * Tracks global market sessions and identifies high-probability trading windows.
 * Based on ICT (Inner Circle Trader) concepts and institutional trading patterns.
 *
 * Key Insight: Most significant moves happen during session opens when
 * institutional traders enter the market with large orders.
 */

export interface TradingSession {
    name: string;
    start: number;  // Hour in UTC
    end: number;    // Hour in UTC
    description: string;
    volatility: 'low' | 'medium' | 'high' | 'extreme';
    liquidityLevel: 'thin' | 'moderate' | 'deep';
}

export interface Killzone {
    name: string;
    start: number;  // Hour in UTC
    end: number;    // Hour in UTC
    description: string;
    tradeProbability: 'low' | 'medium' | 'high';
    expectedMove: string;
}

export interface SessionAnalysis {
    currentSession: string;
    activeKillzone: string | null;
    timeUntilNextKillzone: string;
    nextKillzone: string;
    recommendation: string;
    sessionDetails: {
        asian: SessionStatus;
        london: SessionStatus;
        newYork: SessionStatus;
    };
    marketOpenAlerts: string[];
    optimalTradeWindow: boolean;
}

export interface SessionStatus {
    active: boolean;
    phase: 'pre-open' | 'opening' | 'mid-session' | 'closing' | 'closed';
    hoursRemaining: number;
}

// Major Trading Sessions (UTC)
export const TRADING_SESSIONS: TradingSession[] = [
    {
        name: 'Sydney',
        start: 21,  // 9 PM UTC (previous day)
        end: 6,     // 6 AM UTC
        description: 'Australian session - often sets initial range',
        volatility: 'low',
        liquidityLevel: 'thin'
    },
    {
        name: 'Tokyo/Asian',
        start: 0,   // Midnight UTC
        end: 9,     // 9 AM UTC
        description: 'Asian session - establishes daily range, often swept later',
        volatility: 'medium',
        liquidityLevel: 'moderate'
    },
    {
        name: 'London',
        start: 7,   // 7 AM UTC
        end: 16,    // 4 PM UTC
        description: 'European session - highest volume, major moves',
        volatility: 'high',
        liquidityLevel: 'deep'
    },
    {
        name: 'New York',
        start: 12,  // 12 PM UTC (pre-market)
        end: 21,    // 9 PM UTC
        description: 'US session - second highest volume, trend continuation',
        volatility: 'high',
        liquidityLevel: 'deep'
    }
];

// ICT Killzones - High Probability Trading Windows
export const KILLZONES: Killzone[] = [
    {
        name: 'Asian Range Formation',
        start: 0,
        end: 4,
        description: 'Range forms here, often swept during London/NY opens',
        tradeProbability: 'low',
        expectedMove: 'Range-bound, avoid trading. Mark highs/lows for sweep targets.'
    },
    {
        name: 'London Open Killzone',
        start: 7,
        end: 10,
        description: 'Highest probability window - institutions enter, sweep Asian range',
        tradeProbability: 'high',
        expectedMove: 'Look for Asian high/low sweep, then reversal. Major trend starts here.'
    },
    {
        name: 'London Lunch',
        start: 11,
        end: 12,
        description: 'Low volume consolidation before NY',
        tradeProbability: 'low',
        expectedMove: 'Avoid - low liquidity, choppy price action'
    },
    {
        name: 'New York Open Killzone',
        start: 12,
        end: 15,
        description: 'Second major opportunity - US institutions enter',
        tradeProbability: 'high',
        expectedMove: 'Look for London high/low sweep. Continuation or reversal of London move.'
    },
    {
        name: 'London-NY Overlap',
        start: 12,
        end: 16,
        description: 'Maximum liquidity - both sessions active',
        tradeProbability: 'high',
        expectedMove: 'Highest volume period. Strong trends, good for momentum strategies.'
    },
    {
        name: 'NYSE Open',
        start: 13,  // 1:30 PM UTC = 9:30 AM EST
        end: 15,    // 3 PM UTC = 11 AM EST
        description: 'Stock market open affects crypto correlation',
        tradeProbability: 'medium',
        expectedMove: 'Watch for correlation with SPX/QQQ. Risk-on/risk-off flows.'
    },
    {
        name: 'Power Hour',
        start: 19,  // 7 PM UTC = 3 PM EST
        end: 21,    // 9 PM UTC = 5 PM EST
        description: 'End of US session - late day positioning',
        tradeProbability: 'medium',
        expectedMove: 'Trend continuation or reversal before close. Good for scalps.'
    },
    {
        name: 'Asian Sweep Setup',
        start: 23,
        end: 1,
        description: 'Late NY / Early Asian - potential sweep of NY range',
        tradeProbability: 'medium',
        expectedMove: 'Watch for NY high/low sweep. Lower liquidity = bigger wicks.'
    }
];

// Key market open times (UTC)
export const MARKET_OPENS = {
    TOKYO_STOCK_EXCHANGE: { hour: 0, minute: 0 },      // 9 AM JST
    HONG_KONG_STOCK_EXCHANGE: { hour: 1, minute: 30 }, // 9:30 AM HKT
    LONDON_STOCK_EXCHANGE: { hour: 8, minute: 0 },     // 8 AM GMT
    FRANKFURT_STOCK_EXCHANGE: { hour: 7, minute: 0 },  // 8 AM CET
    NYSE_PRE_MARKET: { hour: 9, minute: 0 },           // 4 AM EST
    NYSE_OPEN: { hour: 13, minute: 30 },               // 9:30 AM EST
    NYSE_CLOSE: { hour: 20, minute: 0 },               // 4 PM EST
    CME_FUTURES_OPEN: { hour: 23, minute: 0 },         // 6 PM EST Sunday
};

/**
 * Get current UTC hour and minute
 */
function getCurrentUTC(): { hour: number; minute: number } {
    const now = new Date();
    return {
        hour: now.getUTCHours(),
        minute: now.getUTCMinutes()
    };
}

/**
 * Check if current time is within a time range (handles overnight ranges)
 */
function isWithinRange(currentHour: number, start: number, end: number): boolean {
    if (start <= end) {
        return currentHour >= start && currentHour < end;
    } else {
        // Overnight range (e.g., 21:00 - 06:00)
        return currentHour >= start || currentHour < end;
    }
}

/**
 * Get hours until a specific hour (always positive, wraps at 24)
 */
function hoursUntil(targetHour: number): number {
    const currentHour = getCurrentUTC().hour;
    if (targetHour > currentHour) {
        return targetHour - currentHour;
    } else {
        return 24 - currentHour + targetHour;
    }
}

/**
 * Get current active session(s)
 */
export function getActiveSessions(): TradingSession[] {
    const { hour } = getCurrentUTC();
    return TRADING_SESSIONS.filter(session =>
        isWithinRange(hour, session.start, session.end)
    );
}

/**
 * Get current killzone if any
 */
export function getActiveKillzone(): Killzone | null {
    const { hour } = getCurrentUTC();
    for (const kz of KILLZONES) {
        if (isWithinRange(hour, kz.start, kz.end)) {
            return kz;
        }
    }
    return null;
}

/**
 * Get next upcoming killzone
 */
export function getNextKillzone(): { killzone: Killzone; hoursUntil: number } {
    const { hour } = getCurrentUTC();

    // Sort killzones by start time
    const sortedKillzones = [...KILLZONES].sort((a, b) => a.start - b.start);

    // Find next killzone
    for (const kz of sortedKillzones) {
        if (kz.start > hour) {
            return { killzone: kz, hoursUntil: kz.start - hour };
        }
    }

    // Wrap to first killzone tomorrow
    const firstKz = sortedKillzones[0];
    return { killzone: firstKz, hoursUntil: 24 - hour + firstKz.start };
}

/**
 * Get session status for a specific session
 */
function getSessionStatus(session: TradingSession): SessionStatus {
    const { hour } = getCurrentUTC();
    const active = isWithinRange(hour, session.start, session.end);

    if (!active) {
        return { active: false, phase: 'closed', hoursRemaining: hoursUntil(session.start) };
    }

    // Calculate session duration and position
    const duration = session.end > session.start
        ? session.end - session.start
        : 24 - session.start + session.end;

    const elapsed = hour >= session.start
        ? hour - session.start
        : 24 - session.start + hour;

    const remaining = duration - elapsed;
    const progress = elapsed / duration;

    let phase: SessionStatus['phase'];
    if (progress < 0.2) phase = 'opening';
    else if (progress < 0.7) phase = 'mid-session';
    else phase = 'closing';

    return { active, phase, hoursRemaining: remaining };
}

/**
 * Get upcoming market open alerts
 */
function getMarketOpenAlerts(): string[] {
    const { hour, minute } = getCurrentUTC();
    const alerts: string[] = [];
    const currentMinutes = hour * 60 + minute;

    const checkAlert = (name: string, openTime: { hour: number; minute: number }, alertWindowMinutes: number = 30) => {
        const openMinutes = openTime.hour * 60 + openTime.minute;
        let diff = openMinutes - currentMinutes;
        if (diff < 0) diff += 24 * 60;

        if (diff <= alertWindowMinutes && diff > 0) {
            alerts.push(`${name} opens in ${diff} minutes`);
        } else if (diff === 0 || (diff < 5 && diff > -5)) {
            alerts.push(`${name} is OPENING NOW`);
        }
    };

    checkAlert('NYSE', MARKET_OPENS.NYSE_OPEN);
    checkAlert('London Stock Exchange', MARKET_OPENS.LONDON_STOCK_EXCHANGE);
    checkAlert('Tokyo Stock Exchange', MARKET_OPENS.TOKYO_STOCK_EXCHANGE);
    checkAlert('Frankfurt Stock Exchange', MARKET_OPENS.FRANKFURT_STOCK_EXCHANGE);

    return alerts;
}

/**
 * Check if current time is optimal for trading
 */
export function isOptimalTradeWindow(): boolean {
    const activeKz = getActiveKillzone();
    if (!activeKz) return false;

    return activeKz.tradeProbability === 'high';
}

/**
 * Get comprehensive session analysis
 */
export function analyzeCurrentSession(): SessionAnalysis {
    const activeSessions = getActiveSessions();
    const activeKz = getActiveKillzone();
    const { killzone: nextKz, hoursUntil: hoursToNext } = getNextKillzone();
    const alerts = getMarketOpenAlerts();
    const optimal = isOptimalTradeWindow();

    // Get individual session statuses
    const asian = getSessionStatus(TRADING_SESSIONS.find(s => s.name === 'Tokyo/Asian')!);
    const london = getSessionStatus(TRADING_SESSIONS.find(s => s.name === 'London')!);
    const newYork = getSessionStatus(TRADING_SESSIONS.find(s => s.name === 'New York')!);

    // Generate recommendation
    let recommendation: string;
    if (activeKz?.tradeProbability === 'high') {
        recommendation = `🟢 HIGH PROBABILITY WINDOW: ${activeKz.name}. ${activeKz.expectedMove}`;
    } else if (activeKz?.tradeProbability === 'medium') {
        recommendation = `🟡 MODERATE OPPORTUNITY: ${activeKz.name}. ${activeKz.expectedMove}`;
    } else if (activeKz?.tradeProbability === 'low') {
        recommendation = `🔴 LOW PROBABILITY: ${activeKz?.name || 'No killzone'}. Consider waiting for ${nextKz.name} (${hoursToNext}h).`;
    } else {
        recommendation = `⏳ WAITING PERIOD: Next opportunity is ${nextKz.name} in ${hoursToNext} hours.`;
    }

    return {
        currentSession: activeSessions.map(s => s.name).join(' + ') || 'Between Sessions',
        activeKillzone: activeKz?.name || null,
        timeUntilNextKillzone: `${hoursToNext} hours`,
        nextKillzone: nextKz.name,
        recommendation,
        sessionDetails: { asian, london, newYork },
        marketOpenAlerts: alerts,
        optimalTradeWindow: optimal
    };
}

/**
 * Get session-based trade bias
 * Returns whether the session structure favors longs or shorts
 */
export function getSessionBias(asianHigh: number, asianLow: number, currentPrice: number): {
    bias: 'long' | 'short' | 'neutral';
    reason: string;
    targetLevels: { sweepTarget: number; reversalZone: number };
} {
    const { hour } = getCurrentUTC();
    const activeKz = getActiveKillzone();

    const asianMid = (asianHigh + asianLow) / 2;
    const rangeSize = asianHigh - asianLow;

    // London Open logic
    if (activeKz?.name === 'London Open Killzone') {
        if (currentPrice > asianHigh) {
            // Price swept Asian high - look for short
            return {
                bias: 'short',
                reason: 'Asian high swept during London open - look for reversal short',
                targetLevels: {
                    sweepTarget: asianHigh,
                    reversalZone: asianMid
                }
            };
        } else if (currentPrice < asianLow) {
            // Price swept Asian low - look for long
            return {
                bias: 'long',
                reason: 'Asian low swept during London open - look for reversal long',
                targetLevels: {
                    sweepTarget: asianLow,
                    reversalZone: asianMid
                }
            };
        } else {
            // Still within Asian range - wait for sweep
            const distanceToHigh = asianHigh - currentPrice;
            const distanceToLow = currentPrice - asianLow;

            return {
                bias: 'neutral',
                reason: `Waiting for Asian range sweep. Closer to ${distanceToHigh < distanceToLow ? 'high' : 'low'}.`,
                targetLevels: {
                    sweepTarget: distanceToHigh < distanceToLow ? asianHigh : asianLow,
                    reversalZone: asianMid
                }
            };
        }
    }

    // NY Open logic
    if (activeKz?.name === 'New York Open Killzone') {
        // Similar logic but looking at London range
        if (currentPrice > asianHigh * 1.01) {
            return {
                bias: 'long',
                reason: 'Price above Asian range during NY - potential continuation',
                targetLevels: {
                    sweepTarget: asianHigh,
                    reversalZone: asianHigh + rangeSize * 0.5
                }
            };
        } else if (currentPrice < asianLow * 0.99) {
            return {
                bias: 'short',
                reason: 'Price below Asian range during NY - potential continuation',
                targetLevels: {
                    sweepTarget: asianLow,
                    reversalZone: asianLow - rangeSize * 0.5
                }
            };
        }
    }

    return {
        bias: 'neutral',
        reason: 'No clear session-based bias at current time',
        targetLevels: {
            sweepTarget: currentPrice > asianMid ? asianHigh : asianLow,
            reversalZone: asianMid
        }
    };
}

/**
 * Day of week analysis
 * Some days historically have different characteristics
 */
export function getDayOfWeekBias(): {
    day: string;
    characteristics: string;
    tradingAdvice: string;
} {
    const now = new Date();
    const day = now.getUTCDay();
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const dayAnalysis: Record<number, { characteristics: string; advice: string }> = {
        0: { // Sunday
            characteristics: 'Low liquidity, CME futures gap possible',
            advice: 'Avoid trading. Wait for Monday Asian session to establish direction.'
        },
        1: { // Monday
            characteristics: 'Week direction often set. Watch for CME gap fill.',
            advice: 'Wait for Asian range, trade London open sweep. Momentum often carries through Tuesday.'
        },
        2: { // Tuesday
            characteristics: 'Often continuation of Monday move. Good trending day.',
            advice: 'Follow Monday trend. Good for momentum strategies.'
        },
        3: { // Wednesday
            characteristics: 'Mid-week reversal possible. FOMC often on Wednesday.',
            advice: 'Check for FOMC/major news. Potential reversal day - be cautious.'
        },
        4: { // Thursday
            characteristics: 'Often volatile. Jobless claims, continuation or reversal.',
            advice: 'Watch US data releases. Can be choppy - reduce position size.'
        },
        5: { // Friday
            characteristics: 'Position squaring before weekend. Lower volume after London close.',
            advice: 'Avoid holding positions into weekend. Trade early, close by NY lunch.'
        },
        6: { // Saturday
            characteristics: 'Weekend - thin liquidity, mostly retail.',
            advice: 'Avoid trading. Weekend moves often reversed Monday.'
        }
    };

    const analysis = dayAnalysis[day];

    return {
        day: dayNames[day],
        characteristics: analysis.characteristics,
        tradingAdvice: analysis.advice
    };
}

/**
 * Export session-aware trade scoring modifier
 * Adds/subtracts from base signal score based on session timing
 */
export function getSessionScoreModifier(): number {
    const activeKz = getActiveKillzone();
    const dayBias = getDayOfWeekBias();

    let modifier = 0;

    // Killzone modifiers
    if (activeKz?.tradeProbability === 'high') {
        modifier += 15; // Boost signal in high-probability windows
    } else if (activeKz?.tradeProbability === 'medium') {
        modifier += 5;
    } else if (activeKz?.tradeProbability === 'low') {
        modifier -= 10; // Penalize signals during low-probability windows
    } else {
        modifier -= 5; // Penalize signals between killzones
    }

    // Day of week modifiers
    const day = new Date().getUTCDay();
    if (day === 0 || day === 6) {
        modifier -= 20; // Strong penalty for weekend
    } else if (day === 5 && getCurrentUTC().hour > 16) {
        modifier -= 10; // Penalty for late Friday
    }

    return modifier;
}
