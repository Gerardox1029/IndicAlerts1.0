require('dotenv').config();
const path = require('path');

const SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', // Large Caps
    'DOGEUSDT', 'AVAXUSDT', 'ADAUSDT', // Mid Caps
    'RENDERUSDT', 'NEARUSDT', 'WLDUSDT', 'SUIUSDT' // Small Caps
];

const CATEGORIES = {
    'Large Caps': ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'],
    'Mid Caps': ['DOGEUSDT', 'AVAXUSDT', 'ADAUSDT'],
    'Small Caps': ['RENDERUSDT', 'NEARUSDT', 'WLDUSDT', 'SUIUSDT']
};

const INTERVALS = ['2h'];
const CHECK_INTERVAL_MS = 180000; // 1 minuto
const REQUEST_DELAY_MS = 250;

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TARGET_GROUP_ID = process.env.TELEGRAM_REPORT_GROUP_ID || '-1003055730763';
const THREAD_ID = process.env.TELEGRAM_THREAD_ID || '15766';

// Paths
// Paths
const STICKERS_FILE = path.join(__dirname, '../stickers.json');
const AUDIOS_FILE = path.join(__dirname, '../audios.json');
const PUBLIC_DIR = path.join(__dirname, '../');

module.exports = {
    SYMBOLS,
    CATEGORIES,
    INTERVALS,
    CHECK_INTERVAL_MS,
    REQUEST_DELAY_MS,
    PORT,
    MONGODB_URI,
    TELEGRAM_TOKEN,
    TARGET_GROUP_ID,
    THREAD_ID,
    STICKERS_FILE,
    AUDIOS_FILE,
    PUBLIC_DIR
};
