process.env.NTBA_FIX_350 = 1;
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
const {
    TELEGRAM_TOKEN,
    TARGET_GROUP_ID,
    THREAD_ID,
    STICKERS_FILE,
    AUDIOS_FILE,
    SYMBOLS,
    CATEGORIES
} = require('./config');
const state = require('./services/state');
const { saveUser, Sticker, Audio } = require('./db/mongo');
const { fetchData } = require('./api/binance');
const { calcularIndicadores } = require('./engine/indicators');
const { getPeruTime, formatPrice } = require('./utils/helpers');
// dateStr removed - now using getPeruTime()

// Helper state local pointers
const {
    userDatabase,
    estadoAlertas,
    history,
    terrainAlertsTracker,
    waitingForNickname,
    marketSummary
} = state;

// Bot instance
let bot = null;
let procesarMercadoFn = null; // Dependency injection

function setProcesarMercado(fn) {
    procesarMercadoFn = fn;
}

// Helper: Determine Chat Name (User vs Group)
function resolveChatName(msg) {
    if (msg.chat.type === 'private') {
        const fromName = msg.from ? (msg.from.username || msg.from.first_name) : null;
        return fromName || 'Usuario';
    }
    return msg.chat.title || 'Grupo/Canal';
}

// Sticker & Audio Logic
async function loadStickers() {
    // Priority: MongoDB -> File (Backup)
    try {
        const stickers = await Sticker.find({});
        if (stickers.length > 0) {
            state.stickyDatabase.splice(0, state.stickyDatabase.length, ...stickers.map(s => s.fileId));
            console.log(`🎨 Stickers cargados de MongoDB: ${state.stickyDatabase.length}`);
        } else if (fs.existsSync(STICKERS_FILE)) {
            // Fallback to JSON
            const data = JSON.parse(fs.readFileSync(STICKERS_FILE, 'utf8'));
            state.stickyDatabase.splice(0, state.stickyDatabase.length, ...data);
        }
    } catch (e) {
        console.error('Error cargando stickers:', e);
    }
}

async function loadAudios() {
    try {
        const audios = await Audio.find({});
        if (audios.length > 0) {
            state.audioDatabase.splice(0, state.audioDatabase.length, ...audios.map(a => a.fileId));
            console.log(`🎵 Audios cargados de MongoDB: ${state.audioDatabase.length}`);
        } else if (fs.existsSync(AUDIOS_FILE)) {
            const data = JSON.parse(fs.readFileSync(AUDIOS_FILE, 'utf8'));
            state.audioDatabase.splice(0, state.audioDatabase.length, ...data);
        }
    } catch (e) {
        console.error('Error cargando audios:', e);
    }
}

async function saveSticker(fileId) {
    if (!state.stickyDatabase.includes(fileId)) {
        state.stickyDatabase.push(fileId);
        // Save to Mongo
        try {
            await Sticker.create({ fileId });
            console.log(`🎨 Nuevo sticker guardado en DB: ${fileId}`);
        } catch (e) { console.error("Error guardando sticker en DB", e); }

        // Backup to File
        fs.writeFileSync(STICKERS_FILE, JSON.stringify(state.stickyDatabase, null, 2));
        return true;
    }
    return false;
}

async function saveAudio(fileId) {
    if (!state.audioDatabase.includes(fileId)) {
        state.audioDatabase.push(fileId);
        // Save to Mongo
        try {
            await Audio.create({ fileId });
            console.log(`🎵 Nuevo audio guardado en DB: ${fileId}`);
        } catch (e) { console.error("Error guardando audio en DB", e); }

        fs.writeFileSync(AUDIOS_FILE, JSON.stringify(state.audioDatabase, null, 2));
        return true;
    }
    return false;
}

// Initial Load
loadStickers();
loadAudios();

// Send Telegram Message (Broadcast)
async function enviarTelegram(messageText, symbol = null, options = {}) {
    if (!bot) return;

    const timeStr = `🕒 ${getPeruTime()} (PE)`;
    const fullMessage = `${messageText}\n\n${timeStr}`;

    const rawChatIds = process.env.TELEGRAM_CHAT_ID || '';
    const envIds = rawChatIds.split(',').map(id => id.trim()).filter(id => id);

    let finalRecipients = new Set();

    // 2a. Users in DB
    for (const chatId in userDatabase) {
        const user = userDatabase[chatId];
        if (!symbol || (user.preferences && user.preferences.includes(symbol))) {
            finalRecipients.add(chatId);
        }
    }

    // 2b. ENV Users (Fallback)
    envIds.forEach(id => {
        if (!userDatabase[id]) {
            finalRecipients.add(id);
        }
    });

    console.log(`📢 Enviando difusión a ${finalRecipients.size} destinatarios (Símbolo: ${symbol || 'GENERAL'})`);

    const sentMessages = [];

    // Choose specific sticker logic handled by caller? Or random here?
    // Index.js logic: "Elegir sticker al azar"
    let randomSticker = null;
    if (state.stickyDatabase.length > 0 && !options.skipSticker) {
        randomSticker = state.stickyDatabase[Math.floor(Math.random() * state.stickyDatabase.length)];
    }

    for (const chatId of finalRecipients) {
        try {
            const sendOptions = { parse_mode: 'HTML' };
            // Thread ID Logic
            if (String(chatId).trim() === String(TARGET_GROUP_ID).trim() && THREAD_ID) {
                sendOptions.message_thread_id = parseInt(THREAD_ID);
            }

            const sentMsg = await bot.sendMessage(chatId, fullMessage, sendOptions);
            sentMessages.push({
                chatId: chatId,
                messageId: sentMsg.message_id
            });

            if (randomSticker) {
                await bot.sendSticker(chatId, randomSticker, sendOptions).catch(e => console.error(`Error enviando sticker a ${chatId}:`, e.message));
            }

        } catch (error) {
            console.error(`❌ ERROR enviando a ${chatId}:`, error.message);
        }
    }
    return sentMessages;
}

// Helper: Track Terrain
function trackTerrain(type, symbol) {
    const now = Date.now();
    const list = terrainAlertsTracker[type];
    const existing = list.find(item => item.symbol === symbol);
    if (existing) {
        existing.timestamp = now;
    } else {
        list.push({ symbol, timestamp: now });
    }
}

// Simulate Signal (Used by Bot & Server)
async function simulateSignalEffect(symbol, type, options = {}) {
    const sUpper = symbol.toUpperCase();
    const tUpper = type.toUpperCase();
    const interval = '2h';
    let text = "Desconocido", emoji = "❓", tangente = 0, curveTrend = 'NEUTRAL';

    const lastPrice = estadoAlertas[`${sUpper}_2h`]?.currentPrice || 100;

    if (tUpper.includes('LONG')) {
        tangente = tUpper.includes('EUPHORIA') ? 1.5 : 0.05;
        curveTrend = 'DOWN';
        text = tUpper.includes('EUPHORIA') ? "LONG en euforia, no buscar SHORT" : "En terreno de LONG";
        emoji = tUpper.includes('EUPHORIA') ? "🚀" : "🍏";
    } else if (tUpper.includes('SHORT')) {
        tangente = tUpper.includes('EUPHORIA') ? -1.5 : -0.05;
        curveTrend = 'UP';
        text = tUpper.includes('EUPHORIA') ? "SHORT en euforia, no buscar LONG" : "En terreno de SHORT";
        emoji = tUpper.includes('EUPHORIA') ? "🩸" : "🔴";
    }

    if (options.trackTerrain) trackTerrain(tUpper.includes('LONG') ? 'LONG' : 'SHORT', sUpper);

    if (options.updatePanel) {
        marketSummary.rocketAngle = tUpper.includes('LONG') ? (tUpper.includes('EUPHORIA') ? -90 : -45) : (tUpper.includes('EUPHORIA') ? 90 : 45);
        marketSummary.dominantState = text;
        marketSummary.rocketColor = tUpper.includes('LONG') ? "rgb(74, 222, 128)" : "rgb(248, 113, 113)";
        marketSummary.fireIntensity = tUpper.includes('LONG') ? (tUpper.includes('EUPHORIA') ? 1 : 0.8) : 0;
        marketSummary.opacity = tUpper.includes('LONG') ? 1 : 0.6;
        marketSummary.saturation = tUpper.includes('LONG') ? 1 : 0.4;

        console.log(`⏱ Simulacro activo. Se revertirá a estado real en 1 minuto...`);
        setTimeout(() => {
            console.log(`🔄 Revertiendo simulacro, escaneando mercado real...`);
            if (procesarMercadoFn) procesarMercadoFn();
        }, 60000);
    }

    let message = `🚀 ALERTA DITOX (SIMULACRO)\n\n💎 ${sUpper}\n\n⏱ <b>Temporalidad:</b> ${interval}\n�<b>Estado:</b> ${text} ${emoji}`;

    const sentMessages = await enviarTelegram(message, sUpper);

    history.unshift({
        time: new Date().toISOString(),
        symbol: sUpper, interval, signal: tUpper.includes('LONG') ? 'LONG' : 'SHORT',
        estadoText: text,
        estadoEmoji: emoji,
        tangente,
        sentMessages: sentMessages || [],
        observation: null,
        macroText: "(Simulado)", // Placeholder for simulation
        id: Date.now(),
        lastEntryType: tUpper.includes('LONG') ? 'LONG' : 'SHORT'
    });
    if (history.length > 20) history.pop();

    const key = `${sUpper}_2h`;
    if (!estadoAlertas[key]) estadoAlertas[key] = {};
    estadoAlertas[key].lastEntryType = tUpper.includes('LONG') ? 'LONG' : 'SHORT';

    return message;
}

// Bot Initialization
function initBot() {
    if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here') {
        bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
        console.log('Telegram Bot iniciado con polling.');
        setupListeners();
    } else {
        console.warn('TELEGRAM_TOKEN no configurado. El bot no funcionará.');
    }
}

function getBot() {
    return bot;
}

// Helper for Report Logic (needs internal access)
function setupListeners() {
    // /start
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        const name = resolveChatName(msg);
        saveUser(chatId, name);
        bot.sendMessage(chatId, `👋 ¡Bienvenido a IndicAlerts Ditox! ${name ? `Hola ${name}.` : ''}\n\nEstás suscrito a las alertas automáticas. Para mejorar tu experiencia, <b>por favor responde a este mensaje con un apodo o nombre</b> que prefieras que usemos en el panel.`, { parse_mode: 'HTML' });
        waitingForNickname.add(chatId);
    });

    // /panel
    bot.onText(/\/panel/i, async (msg) => {
        const chatId = msg.chat.id;
        const sendOptions = msg.message_thread_id ? { message_thread_id: msg.message_thread_id, parse_mode: 'HTML' } : { parse_mode: 'HTML' };

        const name = resolveChatName(msg);
        saveUser(chatId, name);

        const message = `Explora el PANEL de IndicAlerts Ditox aquí: https://indicdtx--indicalerts-ditox-v1--tcggpbtpgkpk.code.run/ 🚀`;

        await bot.sendMessage(chatId, message, sendOptions);
    });

    // /alsison (Hidden Command updated for Local File Persistence)
    bot.onText(/\/alsison/i, (msg) => {
        const chatId = msg.chat.id;
        const sendOptions = msg.message_thread_id ? { message_thread_id: msg.message_thread_id } : {};
        const secretAudioId = "AwACAgEAAxkBAAFBSp5peCypjmsmXDqkI3sjW65fvHvttQACnAUAAoRokEaewOSmAjO51DgE";

        console.log(`🎤 Comando /alsison recibido de ${msg.from.username}`);

        // 1. Try Local File (Permanent Solution)
        const assetPath = path.join(__dirname, 'assets'); // src/assets
        const localOgg = path.join(assetPath, 'alsison.ogg');
        const localMp3 = path.join(assetPath, 'alsison.mp3');

        if (fs.existsSync(localOgg)) {
            bot.sendVoice(chatId, fs.createReadStream(localOgg), sendOptions).catch(e => console.error("Error enviando alsison local (ogg):", e.message));
            return;
        }
        if (fs.existsSync(localMp3)) {
            bot.sendAudio(chatId, fs.createReadStream(localMp3), sendOptions).catch(e => console.error("Error enviando alsison local (mp3):", e.message));
            return;
        }

        // 2. Fallback to File ID
        bot.sendVoice(chatId, secretAudioId, sendOptions).catch((e) => {
            console.error("⚠️ Error enviando alsison (Voice ID):", e.message);
            // Fallback: Try as Audio
            bot.sendAudio(chatId, secretAudioId, sendOptions).catch((e2) => {
                console.error("❌ Error enviando alsison (Audio ID):", e2.message);
                bot.sendMessage(chatId, "❌ No se encontró el audio local ni funcionó el ID de Telegram. Por favor coloca 'alsison.ogg' o 'alsison.mp3' en la carpeta 'src/assets' para solucionarlo permanentemente.", sendOptions);
            });
        });
    });

    // /reportAlfaroMuerdeAlmohadas
    bot.onText(/\/reportAlfaroMuerdeAlmohadas/i, async (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;
        const sendOptions = threadId ? { message_thread_id: threadId } : {};

        if (state.audioDatabase.length === 0) {
            bot.sendMessage(chatId, "⚠️ No hay audios almacenados aún.", sendOptions);
            return;
        }

        const randomAudio = state.audioDatabase[Math.floor(Math.random() * state.audioDatabase.length)];
        try {
            await bot.sendAudio(chatId, randomAudio, sendOptions);
        } catch (e) {
            await bot.sendVoice(chatId, randomAudio, sendOptions).catch(err => console.error("Error enviando audio/voz:", err.message));
        }
    });

    // /reportALL
    bot.onText(/\/reportALL/i, async (msg) => {
        const chatId = msg.chat.id;
        const username = resolveChatName(msg);
        saveUser(chatId, username);
        const threadId = msg.message_thread_id;


        // Cálcular Fuerza Macro del Mercado (Moda de Large Caps)
        let macroVotes = { 'ALCISTA': 0, 'BAJISTA': 0, 'NEUTRAL': 0 };
        const largeCaps = CATEGORIES['Large Caps'] || ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

        // Fetch paralelo para velocidad
        const promises = largeCaps.map(async (s) => {
            const d = await fetchData(s, '4h');
            if (!d) return 'NEUTRAL';
            const ind = calcularIndicadores(d.closes, d.highs, d.lows);
            if (ind && ind.tangentsHistory && ind.tangentsHistory.length >= 3) {
                const [t0, t1, t2] = ind.tangentsHistory;
                if (t0 > 0 && t1 > 0 && t2 > 0) return 'ALCISTA';
                if (t0 < 0 && t1 < 0 && t2 < 0) return 'BAJISTA';
            }
            return 'NEUTRAL';
        });

        const results = await Promise.all(promises);
        results.forEach(r => macroVotes[r]++);

        let marketMacro = 'NEUTRAL';
        if (macroVotes['ALCISTA'] > macroVotes['BAJISTA'] && macroVotes['ALCISTA'] > macroVotes['NEUTRAL']) marketMacro = 'ALCISTA';
        else if (macroVotes['BAJISTA'] > macroVotes['ALCISTA'] && macroVotes['BAJISTA'] > macroVotes['NEUTRAL']) marketMacro = 'BAJISTA';

        const macroText = marketMacro === 'ALCISTA' ? "<b>Fuerza macro (4h):</b> Alcista 🚀" :
            marketMacro === 'BAJISTA' ? "<b>Fuerza macro (4h):</b> Bajista 🔻" :
                "<b>Fuerza macro (4h):</b> Neutral ⚖️";

        const reportMsg = `📊 REPORTE GENERAL\n\n📸 <b>Estado Dominante:</b> ${marketSummary.dominantState}\n${marketSummary.terrainNote !== "Indecisión (No operar) ⚖️" ? `` : ''}\n🪐 ${macroText}\n\nBy Ditox🔮\n\n🕒 ${getPeruTime()} (PE)`;

        await bot.sendMessage(chatId, reportMsg, { message_thread_id: threadId, parse_mode: 'HTML' });

        if (state.stickyDatabase.length > 0) {
            const randomSticker = state.stickyDatabase[Math.floor(Math.random() * state.stickyDatabase.length)];
            bot.sendSticker(chatId, randomSticker, { message_thread_id: threadId }).catch(console.error);
        }
    });

    // /report [symbol]
    bot.onText(/\/report(?!\s*ALL\b|\s*AlfaroMuerdeAlmohadas\b)(.+)/i, async (msg, match) => {
        const chatId = msg.chat.id;
        const username = resolveChatName(msg);
        saveUser(chatId, username);
        const threadId = msg.message_thread_id;
        const rawSymbol = match[1].trim().toUpperCase();
        if (rawSymbol === 'ALL') return;

        let symbol = rawSymbol;
        if (!symbol.includes('USDT')) {
            if (symbol === 'RNDR') symbol = 'RENDERUSDT';
            else symbol += 'USDT';
        }

        if (!SYMBOLS.includes(symbol)) {
            bot.sendMessage(chatId, `⚠️ Símbolo no monitoreado: ${symbol}`, { message_thread_id: threadId });
            return;
        }

        bot.sendMessage(chatId, `🔍 Analizando ${symbol}...`, { message_thread_id: threadId });

        const interval = '2h';
        const marketData = await fetchData(symbol, interval, 100);

        if (marketData) {
            const indicadores = calcularIndicadores(marketData.closes, marketData.highs, marketData.lows);
            if (indicadores) {
                const { obtenerEstado } = require('./engine/loop');

                const { tangente, curveTrend } = indicadores;
                const estadoInfo = obtenerEstado(tangente, curveTrend, symbol);

                let signalForCalc = null;
                if (estadoInfo.terrain) signalForCalc = estadoInfo.terrain;
                else if (tangente > 0) signalForCalc = 'LONG';
                else if (tangente < 0) signalForCalc = 'SHORT';

                // Calcular Fuerza Macro Individual (4h)
                let macroTrend = 'NEUTRAL';
                const data4h = await fetchData(symbol, '4h');
                if (data4h) {
                    const ind4h = calcularIndicadores(data4h.closes, data4h.highs, data4h.lows);
                    if (ind4h && ind4h.tangentsHistory && ind4h.tangentsHistory.length >= 3) {
                        const [t0, t1, t2] = ind4h.tangentsHistory;
                        if (t0 > 0 && t1 > 0 && t2 > 0) macroTrend = 'ALCISTA';
                        else if (t0 < 0 && t1 < 0 && t2 < 0) macroTrend = 'BAJISTA';
                    }
                }
                const macroText = macroTrend === 'ALCISTA' ? "<b>Fuerza macro (4h):</b> Alcista 🚀" :
                    macroTrend === 'BAJISTA' ? "<b>Fuerza macro (4h):</b> Bajista 🔻" :
                        "<b>Fuerza macro (4h):</b> Neutral ⚖️";

                let reportMsg = `✍️ REPORTE MANUAL
                
💎 <b>${symbol} (${interval})</b>

💰 <b>Precio:</b> $${indicadores.currentPrice}
📸 <b>Estado:</b> ${estadoInfo.text} ${estadoInfo.emoji}
🪐 ${macroText}

By Ditox🔮
`;

                reportMsg += `\n🕒 ${getPeruTime()} (PE)`;

                await bot.sendMessage(chatId, reportMsg, { message_thread_id: threadId, parse_mode: 'HTML' });
                if (state.stickyDatabase.length > 0) {
                    const randomSticker = state.stickyDatabase[Math.floor(Math.random() * state.stickyDatabase.length)];
                    bot.sendSticker(chatId, randomSticker, { message_thread_id: threadId }).catch(console.error);
                }
            } else {
                bot.sendMessage(chatId, `❌ Error calculando indicadores para ${symbol}`, { message_thread_id: threadId });
            }
        } else {
            bot.sendMessage(chatId, `❌ Error obteniendo datos de ${symbol}`, { message_thread_id: threadId });
        }
    });

    // /simulate_triple
    bot.onText(/\/simulate_triple_(long|short)/i, async (msg, match) => {
        const type = match[1].toUpperCase();
        bot.sendMessage(msg.chat.id, `🧪 Iniciando simulación de 3 terrenos de ${type}...`);

        const simSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
        for (const s of simSymbols) {
            await simulateSignalEffect(s, type, { trackTerrain: true });
        }

        // Need checkConsolidatedAlerts from loop
        const { checkConsolidatedAlerts } = require('./engine/loop');
        await checkConsolidatedAlerts();

        bot.sendMessage(msg.chat.id, `✅ Simulación de ${type} ejecutada.`);
    });

    // /simulate_long_terrain
    bot.onText(/\/simulate_(long|short)_(terrain|euphoria)/i, async (msg, match) => {
        const type = `${match[2].toUpperCase()}_${match[1].toUpperCase()}`;
        await simulateSignalEffect('BTCUSDT', type, { updatePanel: true });
        bot.sendMessage(msg.chat.id, `✅ Panel simulado como ${type}.`);
    });

    // Capture everything
    bot.on('message', (msg) => {
        if (!msg.chat || !msg.chat.id) return;
        const chatId = msg.chat.id;

        // Sticker capture
        if (msg.sticker && String(chatId) === '1985505500') {
            const fileId = msg.sticker.file_id;
            if (saveSticker(fileId)) {
                bot.sendMessage(chatId, `✅ Sticker guardado en la base de datos.`);
            }
            return;
        }

        // Audio capture
        if ((msg.audio || msg.voice) && String(chatId) === '1985505500') {
            const fileId = msg.audio ? msg.audio.file_id : msg.voice.file_id;
            if (saveAudio(fileId)) {
                bot.sendMessage(chatId, `✅ Audio guardado en la base de datos.`);
            }
            return;
        }

        if (msg.text && msg.text.startsWith('/')) return;

        if (waitingForNickname.has(chatId)) {
            const nickname = msg.text.trim().substring(0, 20);
            saveUser(chatId, nickname);
            bot.sendMessage(chatId, `✅ ¡Perfecto! Te hemos guardado como <b>${nickname}</b>. Ya puedes recibir alertas y usar comandos como /reportALL o /reportBTC para monitorear el estado crypto. \nExplora el PANEL de IndicAlerts aquí: https://indicdtx--indicalerts-ditox-v1--tcggpbtpgkpk.code.run/`, { parse_mode: 'HTML' });
            waitingForNickname.delete(chatId);
            return;
        }

        const username = resolveChatName(msg);
        saveUser(chatId, username);
    });

    console.log('Bot escuchando comandos y capturando usuarios...');
}

module.exports = {
    initBot,
    getBot,
    enviarTelegram,
    simulateSignalEffect,
    setProcesarMercado
};
