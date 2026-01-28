const axios = require('axios');

async function fetchData(symbol, interval, limit = 100) {
    try {
        let url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;

        // PIPPIM/USDT is Futures Only
        if (symbol === 'PIPPINUSDT') {
            url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
        }

        const response = await axios.get(url);
        const closes = response.data.map(k => parseFloat(k[4]));
        const highs = response.data.map(k => parseFloat(k[2]));
        const lows = response.data.map(k => parseFloat(k[3]));
        const closeTimes = response.data.map(k => k[6]);
        return { closes, highs, lows, closeTimes };
    } catch (error) {
        // Fallback to Futures if spot fails (for other potential mysteries)
        if (!symbol.includes('PIPPIN')) {
            try {
                const fUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
                const fResp = await axios.get(fUrl);
                const closes = fResp.data.map(k => parseFloat(k[4]));
                const highs = fResp.data.map(k => parseFloat(k[2]));
                const lows = fResp.data.map(k => parseFloat(k[3]));
                const closeTimes = fResp.data.map(k => k[6]);
                return { closes, highs, lows, closeTimes };
            } catch (fError) {
                console.error(`Error fetching data for ${symbol} ${interval} (Spot & Futures):`, error.message);
                return null;
            }
        }
        console.error(`Error fetching data for ${symbol} ${interval}:`, error.message);
        return null;
    }
}

module.exports = {
    fetchData
};
