const axios = require('axios');
const crypto = require('crypto');
const { BitacoraTrade } = require('../db/mongo');
require('dotenv').config();

const MEXC_API_KEY = process.env.MEXC_API_KEY;
const MEXC_API_SECRET = process.env.MEXC_API_SECRET;

function generateSignature(timestamp) {
    if (!MEXC_API_SECRET) return '';
    const rawData = MEXC_API_KEY + timestamp;
    return crypto.createHmac('sha256', MEXC_API_SECRET).update(rawData).digest('hex');
}

async function syncMexcTrades() {
    try {
        let tradesData = [];

        // Check if API keys are set, if not, generate dummy data for testing the module
        if (!MEXC_API_KEY || !MEXC_API_SECRET) {
            console.log("⚠️ No MEXC API Keys found, generating dummy trades for testing Bitácora.");
            tradesData = [
                {
                    id: 'dummy_' + Date.now(),
                    symbol: 'BTC_USDT',
                    createTime: Date.now(),
                    side: 1, // 1 for long, 2 for short, etc. based on MEXC docs
                    vol: 0.5,
                    leverage: 10
                }
            ];
        } else {
            const timestamp = Date.now().toString();
            const signature = generateSignature(timestamp);
            
            const response = await axios.get(`https://contract.mexc.com/api/v1/private/position/open_positions`, {
                headers: {
                    'ApiKey': MEXC_API_KEY,
                    'Request-Time': timestamp,
                    'Signature': signature,
                    'Content-Type': 'application/json'
                }
            });
            if (response.data && response.data.data) {
                tradesData = response.data.data;
            }
        }

        const addedTrades = [];
        for (const t of tradesData) {
            // Check if exists
            const exists = await BitacoraTrade.findOne({ mexcId: String(t.positionId || t.id) });
            if (!exists) {
                const newTrade = new BitacoraTrade({
                    mexcId: String(t.positionId || t.id),
                    symbol: t.symbol.replace('_', ''),
                    time: new Date(t.createTime || t.updateTime || Date.now()),
                    direction: (t.positionType === 1 || t.side === 1) ? 'LONG' : 'SHORT',
                    size: t.holdVol || t.vol || 0,
                    entryPrice: t.openAvgPrice || 0,
                    leverage: t.leverage || 1
                });
                await newTrade.save();
                addedTrades.push(newTrade);
            }
        }
        return addedTrades;
    } catch (e) {
        console.error("❌ Error syncing MEXC trades:", e.message);
        throw e;
    }
}

module.exports = {
    syncMexcTrades
};
