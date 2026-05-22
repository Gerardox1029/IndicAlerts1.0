const axios = require('axios');

const BINANCE_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function mapKlines(data) {
    return {
        closes: data.map(k => parseFloat(k[4])),
        highs: data.map(k => parseFloat(k[2])),
        lows: data.map(k => parseFloat(k[3])),
        closeTimes: data.map(k => k[6])
    };
}

async function fetchKlines(url) {
    const response = await axios.get(url, {
        headers: {
            'User-Agent': BINANCE_USER_AGENT
        }
    });
    return response.data;
}

async function fetchData(symbol, interval, limit = 100) {
    const spotUrl = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const futuresUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

    const shouldUseFuturesDirectly = symbol === 'HYPEUSDT';

    if (shouldUseFuturesDirectly) {
        try {
            const data = await fetchKlines(futuresUrl);
            return mapKlines(data);
        } catch (error) {
            console.error(`Error fetching futures data for ${symbol} ${interval}:`, error.response?.status || '', error.response?.data || error.message);
            return null;
        }
    }

    try {
        const data = await fetchKlines(spotUrl);
        return mapKlines(data);
    } catch (error) {
        const status = error.response?.status;
        const body = error.response?.data || error.message;
        console.warn(`Spot fetch failed for ${symbol} ${interval}:`, status, body);

        try {
            const data = await fetchKlines(futuresUrl);
            return mapKlines(data);
        } catch (fError) {
            console.error(`Error fetching data for ${symbol} ${interval} (Spot & Futures):`, fError.response?.status || '', fError.response?.data || fError.message);
            return null;
        }
    }
}

module.exports = {
    fetchData
};
