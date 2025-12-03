/**
 * Market Data Fetcher
 * Fetches real historical price data from CoinGecko API
 */

import { OHLCV } from './types';

/**
 * Fetch historical OHLCV data from CoinGecko
 * @param coinId CoinGecko coin ID (e.g., 'ethereum', 'bitcoin')
 * @param days Number of days of history
 * @returns Array of OHLCV candles
 */
export async function fetchHistoricalData(coinId: string, days: number = 30): Promise<OHLCV[]> {
    try {
        // CoinGecko API endpoint for OHLC data
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${days}`;

        console.log(`📡 Fetching ${days} days of data for ${coinId}...`);

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // CoinGecko returns: [timestamp, open, high, low, close]
        const candles: OHLCV[] = data.map((item: number[]) => ({
            timestamp: new Date(item[0]).toISOString(),
            open: item[1],
            high: item[2],
            low: item[3],
            close: item[4],
            volume: 0 // CoinGecko OHLC endpoint doesn't include volume
        }));

        console.log(`✅ Fetched ${candles.length} candles`);
        console.log(`   Period: ${candles[0].timestamp} to ${candles[candles.length - 1].timestamp}`);
        console.log(`   Price range: $${Math.min(...candles.map(c => c.low)).toFixed(2)} - $${Math.max(...candles.map(c => c.high)).toFixed(2)}`);

        return candles;

    } catch (error) {
        console.error('Failed to fetch market data:', error);
        throw error;
    }
}

/**
 * Fetch volume data separately
 * @param coinId CoinGecko coin ID
 * @param days Number of days
 * @returns Array of volumes corresponding to price data
 */
export async function fetchVolumeData(coinId: string, days: number = 30): Promise<number[]> {
    try {
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`;

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`CoinGecko API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();

        // Extract volumes from market chart data
        const volumes: number[] = data.total_volumes.map((item: number[]) => item[1]);

        return volumes;

    } catch (error) {
        console.error('Failed to fetch volume data:', error);
        // Return dummy volumes if fetch fails
        return new Array(days * 24).fill(1000000);
    }
}

/**
 * Fetch complete market data with volume
 * @param coinId CoinGecko coin ID
 * @param days Number of days
 * @returns Array of complete OHLCV candles
 */
export async function fetchCompleteMarketData(coinId: string, days: number = 30): Promise<OHLCV[]> {
    const candles = await fetchHistoricalData(coinId, days);
    const volumes = await fetchVolumeData(coinId, days);

    // Match volumes to candles (may be different lengths, so we'll approximate)
    const volumePerCandle = volumes.length / candles.length;

    return candles.map((candle, i) => ({
        ...candle,
        volume: volumes[Math.floor(i * volumePerCandle)] || volumes[volumes.length - 1] || 1000000
    }));
}

/**
 * Popular coin IDs for testing
 */
export const POPULAR_COINS = {
    ETHEREUM: 'ethereum',
    BITCOIN: 'bitcoin',
    SOLANA: 'solana',
    BNB: 'binancecoin',
    CARDANO: 'cardano',
    AVALANCHE: 'avalanche-2',
    POLYGON: 'matic-network',
    CHAINLINK: 'chainlink'
};
