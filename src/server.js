const { exec } = require('child_process');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const {
    PORT,
    CATEGORIES,
    MONGODB_URI,
    ADMIN_PASSWORD
} = require('./config');
const state = require('./services/state');
const { saveUserToMongo, User, TargetGroup, YoutubeChannel, Trader, DitoxIdea } = require('./db/mongo');
const { getBot, enviarTelegram, simulateSignalEffect } = require('./bot');
const { checkConsolidatedAlerts } = require('./engine/loop');

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, '../'))); // Serve static from root

// Helper state local pointers
const {
    userDatabase,
    estadoAlertas,
    history,
    marketSummary
} = state;

// --- Routes ---

const DEFAULT_TARGET_GROUPS = [
    { groupId: '-1003055730763', name: 'Grupo 1 (-1003055730763)' },
    { groupId: '-1002236838794', name: 'Grupo 2 (-1002236838794)' },
    { groupId: '@MEXCSpanish', name: 'MEXC Spanish' },
    { groupId: '@BCDTrading', name: 'BCD Trading' },
    { groupId: '@AltCryptoGrupo', name: 'AltCrypto Grupo' },
    { groupId: '-1002875737156', name: 'Grupo 3 (-1002875737156)' },
    { groupId: '-1002614085310', name: 'Grupo 4 (-1002614085310)' },
    { groupId: '-1003128852916', name: 'Grupo 5 (-1003128852916)' },
    { groupId: '-1003752210566', name: 'Grupo Pruebas (Test -1003752210566)' }
];

async function loadInitialGroups() {
    try {
        const count = await TargetGroup.countDocuments();
        if (count === 0) {
            await TargetGroup.insertMany(DEFAULT_TARGET_GROUPS);
            console.log('✅ Grupos por defecto guardados en la BD');
        }
    } catch (e) {
        console.error('Error inicializando grupos:', e.message);
    }
}
setTimeout(loadInitialGroups, 5000);

app.get('/admin/groups', async (req, res) => {
    try {
        const groups = await TargetGroup.find();
        res.json(groups.map(g => ({ id: g._id, groupId: g.groupId, name: g.name })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/groups', async (req, res) => {
    const { password, groupId, name } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        const newGroup = await TargetGroup.create({ groupId, name });
        res.json({ success: true, group: { id: newGroup._id, groupId: newGroup.groupId, name: newGroup.name } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/admin/groups/:id', async (req, res) => {
    const { password, groupId, name } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        await TargetGroup.findByIdAndUpdate(req.params.id, { groupId, name });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/admin/groups/:id', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        await TargetGroup.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.get('/admin/youtube-channels', async (req, res) => {
    try {
        const channels = await YoutubeChannel.find();
        res.json(channels.map(c => ({ id: c._id, channelId: c.channelId, nombre: c.nombre, logoUrl: c.logoUrl })));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/youtube-channels', async (req, res) => {
    const { password, channelId, nombre } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        const axios = require('axios');
        let logoUrl = '';
        if (process.env.YT_API_V3) {
            const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${process.env.YT_API_V3}`;
            const { data } = await axios.get(url);
            if (data.items && data.items.length > 0) {
                logoUrl = data.items[0].snippet.thumbnails.default.url;
            }
        }
        const newChannel = await YoutubeChannel.create({ channelId, nombre, logoUrl });
        res.json({ success: true, channel: { id: newChannel._id, channelId: newChannel.channelId, nombre: newChannel.nombre, logoUrl: newChannel.logoUrl } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/admin/youtube-channels/:id', async (req, res) => {
    const { password, channelId, nombre } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        const axios = require('axios');
        let logoUrl = '';
        if (process.env.YT_API_V3) {
            const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${process.env.YT_API_V3}`;
            const { data } = await axios.get(url);
            if (data.items && data.items.length > 0) {
                logoUrl = data.items[0].snippet.thumbnails.default.url;
            }
        }
        await YoutubeChannel.findByIdAndUpdate(req.params.id, { channelId, nombre, logoUrl });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── Trader Routes ────────────────────────────────────────────────────────────

/** Helper: calcula win-rate y nivel de Aura */
function getAuraLevel(hits, misses) {
    const total = hits + misses;
    if (total === 0) return { winRate: 0, level: 'B' };
    const wr = (hits / total) * 100;
    let level;
    if (wr >= 80) level = 'AAA';
    else if (wr >= 75) level = 'AA';
    else if (wr >= 70) level = 'A';
    else level = 'B';
    return { winRate: parseFloat(wr.toFixed(1)), level };
}

app.get('/admin/traders', async (req, res) => {
    try {
        const traders = await Trader.find({}).sort({ createdAt: 1 });
        res.json(traders.map(t => {
            const { winRate, level } = getAuraLevel(t.hits, t.misses);
            return {
                id: t._id,
                name: t.name,
                isYoutuber: t.isYoutuber,
                state: t.state,
                hits: t.hits,
                misses: t.misses,
                recentHistory: t.recentHistory,
                mainIdea: t.mainIdea,
                winRate,
                auraLevel: level
            };
        }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/admin/traders', async (req, res) => {
    const { password, name } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'El nombre es requerido' });
    try {
        // hits:7, misses:3 por defecto → arranque con 70% de efectividad
        const trader = await Trader.create({ name: name.trim() });
        const { winRate, level } = getAuraLevel(trader.hits, trader.misses);
        res.json({ success: true, trader: { id: trader._id, name: trader.name, state: trader.state, hits: trader.hits, misses: trader.misses, recentHistory: trader.recentHistory, winRate, auraLevel: level } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.patch('/admin/traders/:id/state', async (req, res) => {
    const { password, state } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    const validStates = ['durmiendo', 'alcista', 'bajista'];
    if (!validStates.includes(state)) return res.status(400).json({ success: false, message: 'Estado inválido' });
    try {
        const trader = await Trader.findByIdAndUpdate(
            req.params.id,
            { state },
            { new: true }
        );
        if (!trader) return res.status(404).json({ success: false, message: 'Trader no encontrado' });
        res.json({ success: true, state: trader.state });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.patch('/admin/traders/:id/idea', async (req, res) => {
    const { password, mainIdea } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        const trader = await Trader.findByIdAndUpdate(
            req.params.id,
            { mainIdea },
            { new: true }
        );
        if (!trader) return res.status(404).json({ success: false, message: 'Trader no encontrado' });
        res.json({ success: true, mainIdea: trader.mainIdea });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.patch('/admin/traders/:id/resolve', async (req, res) => {
    const { password, result } = req.body; // result: 'hit' | 'miss'
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    if (result !== 'hit' && result !== 'miss') return res.status(400).json({ success: false, message: 'Resultado inválido' });
    try {
        const trader = await Trader.findById(req.params.id);
        if (!trader) return res.status(404).json({ success: false, message: 'Trader no encontrado' });

        const emoji = result === 'hit' ? '✅' : '❌';

        // Actualizar contadores y historial
        if (result === 'hit') trader.hits += 1;
        else trader.misses += 1;

        // Insertar al inicio y recortar a máx 5
        trader.recentHistory.unshift(emoji);
        if (trader.recentHistory.length > 5) trader.recentHistory = trader.recentHistory.slice(0, 5);

        // Volver a estado dormido
        trader.state = 'durmiendo';
        await trader.save();

        const { winRate, level } = getAuraLevel(trader.hits, trader.misses);
        res.json({
            success: true,
            hits: trader.hits,
            misses: trader.misses,
            recentHistory: trader.recentHistory,
            state: trader.state,
            winRate,
            auraLevel: level
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/admin/traders/:id', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        await Trader.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.delete('/admin/youtube-channels/:id', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    try {
        await YoutubeChannel.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/admin/broadcast-groups', async (req, res) => {
    const { password, message, imageBase64, selectedGroups } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    if (!selectedGroups || selectedGroups.length === 0) return res.status(400).json({ success: false, message: 'No hay grupos seleccionados' });

    const payload = JSON.stringify({
        message,
        image_base64: imageBase64,
        groups: selectedGroups
    });

    const tempPayloadPath = path.join(__dirname, `payload_${Date.now()}.json`);
    const scriptPath = path.join(__dirname, 'userbot_logic.py');

    try {
        fs.writeFileSync(tempPayloadPath, payload);

        exec(`python3 "${scriptPath}" "@${tempPayloadPath}"`, (error, stdout, stderr) => {
            if (fs.existsSync(tempPayloadPath)) fs.unlinkSync(tempPayloadPath);

            if (error) {
                console.error(`exec error: ${error}`);
                console.error(`stderr: ${stderr}`);
                return res.status(500).json({ success: false, message: 'Error ejecutando Userbot' });
            }

            try {
                const result = JSON.parse(stdout);
                res.json(result);
            } catch (e) {
                console.error("Parse error:", stdout, stderr);
                res.status(500).json({ success: true, message: 'Respuesta parcial del Userbot', raw: stdout });
            }
        });
    } catch (e) {
        console.error("Broadcast error:", e);
        if (fs.existsSync(tempPayloadPath)) fs.unlinkSync(tempPayloadPath);
        res.status(500).json({ success: false, message: e.message });
    }
});

// Endpoint de prueba simple
app.get('/test-alert', async (req, res) => {
    await enviarTelegram(`🧪 ALERTA DE PRUEBA\n\nSi ves esto, la conexión con Telegram es correcta.`);
    res.send('Prueba enviada.');
});

// Endpoint GENÉRICO para SIMULAR
app.get('/simulate/:symbol/:type', async (req, res) => {
    const { symbol, type } = req.params;
    // Call imported simulation function
    await simulateSignalEffect(symbol, type, { updatePanel: true });
    res.send(`Simulacro de ${type} para ${symbol} ejecutado.`);
});

app.get('/simulate-triple-terrain', async (req, res) => {
    const type = req.query.type?.toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
    const simSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
    for (const s of simSymbols) {
        await simulateSignalEffect(s, type, { trackTerrain: true });
    }
    await checkConsolidatedAlerts();
    res.send(`Simulación de triple terreno de ${type} enviada.`);
});


// Admin: Enviar mensaje personalizado
app.post('/admin/send-direct-message', async (req, res) => {
    const { password, userId, message } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    try {
        const bot = getBot();
        if (bot) await bot.sendMessage(userId, `📩 <b>MENSAJE DEL ADMINISTRADOR:</b>\n\n${message}`, { parse_mode: 'HTML' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Admin: Actualizar señal
app.post('/admin/update-signal', async (req, res) => {
    const { password, signalId, observationType } = req.body;

    if (password !== ADMIN_PASSWORD) {
        return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    }

    const signalIndex = history.findIndex(h => h.id == signalId);
    if (signalIndex === -1) {
        return res.status(404).json({ success: false, message: 'Señal no encontrada' });
    }

    const signalEntry = history[signalIndex];
    signalEntry.observation = observationType;

    const obsEmojis = { "Señal dudosa": "🤔", "Señal FALSA": "❌", "Liquidaciones a favor": "💰", "Liquidaciones en contra": "💀", "Señal aprobada por Ditox": "✅" };
    const obsEmoji = obsEmojis[observationType] || "";

    let baseMessage = "";

    if (signalEntry.isConsolidated) {
        const type = signalEntry.signal;
        baseMessage = `🚨 ALERTA DE MERCADO DITOX - ${signalEntry.consolidatedDateStr}\n\nEn terreno de ${type},\nPrepara tu orden LIMIT, A TRADEAR! 🚀🔥\n\nDominantes: ${signalEntry.consolidatedDominants}\n\nObservación (by Ditox): ${observationType} ${obsEmoji}`;
    } else {
        const { getPeruTime } = require('./utils/helpers');

        const macroText = signalEntry.macroText || "Fuerza macro (4h): No disponible ⚠️";
        const timeStr = getPeruTime(new Date(signalEntry.time));
        const price = signalEntry.price || signalEntry.currentPrice || "?";
        const priceLine = price !== "?" ? `\n💰<b>Precio:</b> $${price}` : "\n";

        baseMessage = `🚀 ALERTA DITOX

💎 <b>${signalEntry.symbol} (${signalEntry.interval})</b>
${priceLine}
📸 <b>Estado:</b> ${signalEntry.estadoText} ${signalEntry.estadoText.includes('LONG') && signalEntry.tangente > 1 ? '🚀' :
                signalEntry.estadoText.includes('LONG') ? '🟢' :
                    signalEntry.estadoText.includes('SHORT') && signalEntry.tangente < -1 ? '🩸' :
                        signalEntry.estadoText.includes('SHORT') ? '🔴' :
                            signalEntry.estadoText.includes('Terreno de LONG') ? '🍏' : '🍎'}
🪐 ${macroText}

🔎 <b>Observación Ditox:</b> ${observationType} ${obsEmoji}

🕒 ${timeStr} (PE)`;
    }

    console.log(`📝 Actualizando señal ${signalId} con observación: ${observationType}`);

    if (signalEntry.sentMessages && Array.isArray(signalEntry.sentMessages)) {
        const bot = getBot();
        for (const msgInfo of signalEntry.sentMessages) {
            try {
                if (bot) {
                    await bot.editMessageText(baseMessage, {
                        chat_id: msgInfo.chatId,
                        message_id: msgInfo.messageId,
                        parse_mode: 'HTML'
                    });
                    console.log(`Message updated for chat ${msgInfo.chatId}`);
                }
            } catch (error) {
                console.error(`Failed to edit message for ${msgInfo.chatId}:`, error.message);
            }
        }
    }

    res.json({ success: true, message: 'Observación actualizada y mensajes editados.' });
});

// Admin: Obtener lista de usuarios
app.get('/admin/users', (req, res) => {
    const userList = Object.values(userDatabase);
    res.json(userList);
});

// Admin: Actualizar preferencias de usuario
app.post('/admin/update-user-prefs', async (req, res) => {
    const { password, userId, preferences } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    if (userDatabase[userId]) {
        userDatabase[userId].preferences = preferences;
        if (mongoose.connection.readyState === 1 || MONGODB_URI) {
            saveUserToMongo(userDatabase[userId]);
        }
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// Admin: Eliminar usuario
app.post('/admin/delete-user', async (req, res) => {
    const { password, userId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    if (userDatabase[userId]) {
        const idToDelete = userDatabase[userId].id;
        delete userDatabase[userId];
        if (mongoose.connection.readyState === 1 || MONGODB_URI) {
            try {
                await User.deleteOne({ id: idToDelete });
                console.log(`🗑️ Usuario eliminado de DB: ${idToDelete}`);
            } catch (e) {
                console.error('Error eliminando de Mongo:', e.message);
            }
        }
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// Admin: Simular alerta general para un usuario específico
app.post('/admin/simulate-user-alert', async (req, res) => {
    const { password, userId } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    const user = userDatabase[userId];
    if (user) {
        const msg = `🧪 <b>SIMULACRO DE ALERTA GENERAL</b>\n\nHola ${user.username}, esto es una prueba del sistema de alertas generales.`;
        try {
            const bot = getBot();
            if (bot) await bot.sendMessage(userId, msg, { parse_mode: 'HTML' });
            return res.json({ success: true });
        } catch (e) {
            return res.status(500).json({ success: false, message: e.message });
        }
    }
    res.status(404).json({ success: false });
});

// Admin: System Switch (Active/Off)
app.post('/admin/system-switch', (req, res) => {
    const { password, active } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });

    state.isSystemActive = active;

    console.log(`🔌 Sistema ${active ? 'ACTIVADO' : 'DESACTIVADO'} por admin.`);
    res.json({ success: true, active: state.isSystemActive });
});

// Admin: Broadcast Message
app.post('/admin/broadcast-message', async (req, res) => {
    const { password, message } = req.body;
    if (password !== ADMIN_PASSWORD) return res.status(403).json({ success: false, message: 'Contraseña incorrecta' });
    if (!message) return res.status(400).json({ success: false, message: 'Empty message' });

    try {
        // Broadcast to all users via existing helper (it handles iteration internally)
        const fullMessage = `📢 MENSAJE GENERAL:\n\n${message}`;
        const sentMessages = await enviarTelegram(fullMessage, null); // null symbol = broadcast to all

        const sentCount = sentMessages ? sentMessages.length : 0;

        console.log(`📢 Mensaje general enviado a ${sentCount} usuarios.`);
        res.json({ success: true, count: sentCount });

    } catch (e) {
        console.error("Error broadcast:", e);
        res.status(500).json({ success: false, message: e.message });
    }
});

const { BitacoraTrade } = require('./db/mongo');
app.get('/api/bitacora', async (req, res) => {
    try {
        const trades = await BitacoraTrade.find().sort({ time: -1 }).limit(50);
        res.json(trades);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/bitacora/sync', async (req, res) => {
    try {
        const { syncMexcTrades } = require('./api/mexc');
        const newTrades = await syncMexcTrades();
        res.json({ success: true, count: newTrades.length });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/bitacora/update', async (req, res) => {
    try {
        const { tradeId, updates } = req.body;
        await BitacoraTrade.findByIdAndUpdate(tradeId, updates);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// --- Ditox Ideas API ---
app.get('/api/ideas/active', async (req, res) => {
    try {
        const idea = await DitoxIdea.findOne({ status: 'active' });
        res.json(idea || { empty: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ideas', async (req, res) => {
    try {
        await DitoxIdea.updateMany({ status: 'active' }, { status: 'archived', cycleName: 'Archivado Automático' });
        const newIdea = new DitoxIdea({
            phases: [
                { phaseNumber: 1, description: '', image: '', lastUpdated: new Date() },
                { phaseNumber: 2, description: '', image: '', lastUpdated: null },
                { phaseNumber: 3, description: '', image: '', lastUpdated: null },
                { phaseNumber: 4, description: '', image: '', lastUpdated: null }
            ]
        });
        await newIdea.save();
        res.json({ success: true, idea: newIdea });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/ideas/phase/:number', async (req, res) => {
    try {
        const num = parseInt(req.params.number);
        const { image, description, direction, timeframe } = req.body;
        const idea = await DitoxIdea.findOne({ status: 'active' });
        if (!idea) return res.status(404).json({ success: false });

        const phase = idea.phases.find(p => p.phaseNumber === num);
        if (phase) {
            if (image !== undefined) phase.image = image;
            if (description !== undefined) phase.description = description;
            phase.lastUpdated = new Date();
        }
        if (direction) idea.direction = direction;
        if (timeframe) idea.timeframe = timeframe;

        await idea.save();
        res.json({ success: true, idea });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ideas/archive', async (req, res) => {
    try {
        const { cycleName } = req.body;
        const idea = await DitoxIdea.findOne({ status: 'active' });
        if (idea) {
            idea.status = 'archived';
            idea.cycleName = cycleName || 'Ciclo ' + new Date().toLocaleDateString();
            idea.archivedAt = new Date();
            idea.phases.forEach(p => p.image = ''); // Strip images to save space
            await idea.save();
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ideas', async (req, res) => {
    try {
        await DitoxIdea.deleteMany({ status: 'active' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/ideas/history', async (req, res) => {
    try {
        const ideas = await DitoxIdea.find({ status: 'archived' }).sort({ archivedAt: -1 }).limit(20);
        res.json(ideas);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ideas/history/:id', async (req, res) => {
    try {
        await DitoxIdea.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/bitacora/:id', async (req, res) => {
    try {
        await BitacoraTrade.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Daily Sync Bitacora Trades (Constantly every day)
setInterval(async () => {
    try {
        const { syncMexcTrades } = require('./api/mexc');
        await syncMexcTrades();
        console.log("✅ Bitacora synced automatically (Daily).");
    } catch (e) {
        console.error("❌ Error running daily bitacora sync:", e.message);
    }
}, 24 * 60 * 60 * 1000);

// Endpoint API para actualizaciones dinámicas (AJAX)
// Endpoint API para actualizaciones dinámicas (AJAX)
app.get('/api/dashboard-data', (req, res) => {
    res.json({
        marketSummary,
        estadoAlertas,
        history: history.slice(0, 20),
        isSystemActive: state.isSystemActive
    });
});

// --- DASHBOARD FRONTEND ---
app.get('/', (req, res) => {
    const generateCards = (symbols) => symbols.map(s => {
        const i = '2h';
        const key = `${s}_${i}`;
        const estado = estadoAlertas[key] || {};
        const price = estado.currentPrice ? `$${estado.currentPrice}` : 'Cargando...';
        const statusText = estado.currentStateText || 'Esperando datos...';
        const statusEmoji = estado.currentStateEmoji || '⏳';

        // Add macroForce initialization
        const macroForce = estado.macroForce || 'NEUTRAL';
        let mfClass = 'macro-force text-sm font-bold mt-2 ';
        if (macroForce === 'ALCISTA') mfClass += 'text-green-400 animate-light-waves';
        else if (macroForce === 'BAJISTA') mfClass += 'text-red-400 animate-light-waves';
        else mfClass += 'text-gray-400';
        const mfText = macroForce.charAt(0).toUpperCase() + macroForce.slice(1).toLowerCase();

        // TICK UI LOGIC
        let lastEntryInfo = '';
        if (estado.tick) {
            lastEntryInfo = `<p class="mt-2 text-sm font-bold bg-yellow-900/30 text-yellow-400 p-2 rounded-lg border border-yellow-500/20 shadow-[0_0_15px_rgba(234,179,8,0.1)] animate-pulse-slow">🎯 Posible entrada AL TICK: <span class="font-mono text-white">$${estado.tick}</span></p>`;
        }

        return `
            <div data-symbol="${s}" class="crypto-card group relative bg-gray-900/50 backdrop-blur-xl rounded-3xl p-6 border border-gray-700/50 hover:border-blue-500/50 transition-all duration-300 hover:shadow-2xl hover:shadow-blue-500/10 overflow-hidden">
                <div class="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                
                <div class="relative z-10 flex justify-between items-start mb-4">
                    <div>
                        <h3 class="text-2xl font-bold text-white tracking-tight">${s} <span class="text-xs font-mono text-blue-400 bg-blue-900/30 px-2 py-1 rounded ml-2">2H</span></h3>
                        <p class="text-gray-400 text-sm font-light mt-1">${price}</p>
                    </div>
                    <div class="text-3xl filter drop-shadow-lg animate-pulse-slow">${statusEmoji}</div>
                </div>
                
                <div class="relative z-10 mb-6">
                    <p class="text-sm font-medium text-gray-300">Estado: ${statusText}</p>
                    <p class="${mfClass}">Macro: ${mfText}</p>
                    ${lastEntryInfo}
                </div>

                <button onclick="openReviewModal('${s}', '${price}', '${statusText}', '${statusEmoji}', '${estado.lastEntryType || ''}', '', '${mfText}')" 
                    class="relative z-10 w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold py-2 px-4 rounded-xl shadow-lg hover:shadow-blue-500/30 transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 text-sm">
                    Revisar
                </button>
            </div>
         `;
    }).join('');

    const largeCapsHtml = generateCards(CATEGORIES['Large Caps']);
    const midCapsHtml = generateCards(CATEGORIES['Mid Caps']);
    const smallCapsHtml = generateCards(CATEGORIES['Small Caps']);

    const historyRows = history.map(h => {
        const obs = h.observation ? `<span class="block text-xs text-yellow-400 mt-1">📝 ${h.observation}</span>` : '';
        const adminControls = `
            <div class="ditox-admin hidden mt-2">
                <select id="obs-select-${h.id}" class="bg-gray-700 text-xs text-white p-1 rounded mb-1 w-full">
                    <option value="">Seleccionar Observación...</option>
                    <option value="Señal dudosa">Señal dudosa</option>
                    <option value="Señal FALSA">Señal FALSA</option>
                    <option value="Liquidaciones a favor de la señal">Liquidaciones a favor</option>
                    <option value="Liquidaciones en contra de la señal">Liquidaciones en contra</option>
                    <option value="Señal aprobada por Ditox">Señal aprobada por Ditox</option>
                </select>
                <button onclick="updateSignal('${h.id}')" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded w-full">
                    Actualizar Reporte
                </button>
            </div>
        `;

        return `
        <tr class="border-b border-gray-700/50 hover:bg-white/5 transition-colors">
            <td class="py-4 px-6 text-gray-400 font-mono text-xs">${new Date(h.time).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</td>
            <td class="py-4 px-6 text-gray-400 font-mono text-xs">${new Date(h.time).toLocaleTimeString()}</td>
            <td class="py-4 px-6 text-blue-300 font-bold">${h.symbol}</td>
            <td class="py-4 px-6 text-gray-400 text-xs">${h.interval}</td>
            <td class="py-4 px-6">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${h.signal === 'LONG' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}">
                    ${h.estadoText}
                </span>
                ${obs}
            </td>
            <td class="py-4 px-6 text-gray-300 font-mono text-sm">
                ${h.tangente.toFixed(4)}
            </td>
            <td class="py-4 px-6 text-gray-400 text-xs ditox-column hidden">
                ${h.observation || 'Ninguna'}
                ${adminControls}
            </td>
        </tr>
    `}).join('');

    const html = `
<!DOCTYPE html>
<html lang="es" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IndicAlerts | Ditox OS</title>
    <link rel="icon" type="image/jpeg" href="/icono_ditox10.jpeg">
    <link rel="stylesheet" href="/ditox.css">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: { sans: ['Outfit', 'sans-serif'] },
                    animation: { 
                        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
                        'light-waves': 'lightWaves 2s ease-in-out infinite'
                    },
                    keyframes: {
                        lightWaves: {
                            '0%, 100%': { filter: 'drop-shadow(0 0 5px currentColor)', opacity: '0.8' },
                            '50%': { filter: 'drop-shadow(0 0 15px currentColor)', opacity: '1' }
                        }
                    }
                }
            }
        }
    </script>
    <style>
        /* Space Moving Background */
        body {
            background-color: #000;
            position: relative;
            overflow-x: hidden;
        }
        body::before, body::after, .stars-layer {
            content: '';
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: -1;
            pointer-events: none;
            background: transparent;
        }
        body::before {
            background-image: 
                radial-gradient(1.5px 1.5px at 20px 30px, #fff, rgba(0,0,0,0)),
                radial-gradient(1.5px 1.5px at 40px 70px, #fff, rgba(0,0,0,0)),
                radial-gradient(1.5px 1.5px at 50px 160px, #ddd, rgba(0,0,0,0)),
                radial-gradient(1.5px 1.5px at 90px 40px, #fff, rgba(0,0,0,0)),
                radial-gradient(1.5px 1.5px at 130px 80px, #fff, rgba(0,0,0,0)),
                radial-gradient(1.5px 1.5px at 160px 120px, #ddd, rgba(0,0,0,0));
            background-repeat: repeat;
            background-size: 200px 200px;
            animation: moveStars 50s linear infinite;
            opacity: 0.8;
        }
        body::after {
            background-image: 
                radial-gradient(2px 2px at 10px 10px, #fff, rgba(0,0,0,0)),
                radial-gradient(2px 2px at 150px 150px, #ddd, rgba(0,0,0,0)),
                radial-gradient(2px 2px at 60px 90px, #fff, rgba(0,0,0,0)),
                radial-gradient(2px 2px at 180px 40px, #eee, rgba(0,0,0,0));
            background-repeat: repeat;
            background-size: 300px 300px;
            animation: moveStars 100s linear infinite;
            opacity: 0.6;
        }
        .stars-layer {
            background-image: 
                radial-gradient(3px 3px at 50px 50px, #fff, rgba(0,0,0,0)),
                radial-gradient(3px 3px at 100px 150px, #fff, rgba(0,0,0,0)),
                radial-gradient(3px 3px at 200px 80px, #fff, rgba(0,0,0,0));
            background-repeat: repeat;
            background-size: 400px 400px;
            animation: moveStars 150s linear infinite;
            opacity: 0.4;
        }
        @keyframes moveStars {
            from { transform: translateY(0); }
            to { transform: translateY(-1000px); }
        }
        dialog::backdrop { background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); }
        dialog[open] { animation: zoomIn 0.2s ease-out; }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        /* Scrollbar custom */
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-track { background: #1f2937; }
        ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: #6b7280; }

        /* Rocket Gauge Styles */
        .gauge-container { position: relative; width: 250px; height: 440px; overflow: hidden; border-left: 4px solid #334155; margin: 0 auto; }
        .gauge-arc { position: absolute; width: 440px; height: 440px; border-radius: 50%; left: -220px; background: conic-gradient(from 0deg, #4ade80 0deg, #facc15 90deg, #f87171 180deg); -webkit-mask: radial-gradient(circle, transparent 64%, black 65%); mask: radial-gradient(circle, transparent 64%, black 65%); }
        .rocket-pivot { position: absolute; top: 50%; left: 0; width: 200px; height: 2px; transform-origin: left center; transition: transform 0.8s cubic-bezier(0.34, 1.56, 0.64, 1); animation: oscillate 3s infinite ease-in-out; }
        .rocket-wrapper { position: absolute; right: 0; top: 50%; transform: translateY(-50%) rotate(45deg); display: flex; align-items: center; justify-content: center; transition: filter 0.5s ease-out; }
        .rocket { font-size: 5rem; z-index: 2; user-select: none; }
        .rocket-wrapper::after { content: "🔥"; position: absolute; font-size: 2rem; bottom: -18px; left: -18px; transform: rotate(45deg) scale(var(--fire-scale)); opacity: var(--fire-opacity); filter: blur(0.5px); animation: flicker 0.1s infinite alternate; z-index: 1; }
        
        /* Animations */
        @keyframes flicker { from { transform: rotate(45deg) scale(calc(var(--fire-scale) * 0.9)); } to { transform: rotate(45deg) scale(calc(var(--fire-scale) * 1.1)) translateY(2px); } }
        @keyframes oscillate { 0%, 100% { transform: translateY(-50%) translateY(0px) rotate(var(--rot-base)); } 50% { transform: translateY(-50%) translateY(5px) rotate(calc(var(--rot-base) + 2deg)); } }
        @keyframes breathing { 0%, 100% { opacity: 1; } 50% { opacity: 0.75; } }
        @keyframes fadeInUp { from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); } }

        .animate-fadeInUp { animation: fadeInUp 0.8s ease-out forwards; }
        .animate-breathing { animation: breathing 3s infinite ease-in-out; }

        @keyframes floatUp {
            0% { transform: translateY(100vh) scale(0.5); opacity: 0; }
            50% { opacity: 0.8; }
            100% { transform: translateY(-10vh) scale(1.5); opacity: 0; }
        }
        .particle {
            position: absolute;
            bottom: -10px;
            background: white;
            border-radius: 50%;
            animation: floatUp linear infinite;
            opacity: 0;
            pointer-events: none;
        }
    </style>
    <!-- Boxicons -->
    <link href='https://unpkg.com/boxicons@2.1.4/css/boxicons.min.css' rel='stylesheet'>
    <!-- Chart.js -->
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="text-gray-200 min-h-screen p-4 md:p-8">

 <!-- Sidebar Navigation -->
        <div class="sidebar hidden" id="ditox-navbar">
            <div class="logo-details">
                <i class='bx bxs-rocket icon'></i>
                <div class="logo_name text-xl font-bold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">DITOX</div>
                <i class='bx bx-menu' id="btn"></i>
            </div>
            <ul class="nav-list mt-8">
                <li>
                    <button onclick="showSection('dashboard')" class="nav-btn">
                        <i class='bx bx-grid-alt'></i>
                        <span class="links_name">Panel del Bot</span>
                    </button>
                    <span class="tooltip">Panel del Bot</span>
                </li>
                <li>
                    <button onclick="showSection('bitacora')" class="nav-btn">
                        <i class='bx bx-book-bookmark'></i>
                        <span class="links_name">Bitácora</span>
                    </button>
                    <span class="tooltip">Bitácora Ditox</span>
                </li>
                <li>
                    <button onclick="showSection('history')" class="nav-btn">
                        <i class='bx bx-history'></i>
                        <span class="links_name">Historial</span>
                    </button>
                    <span class="tooltip">Historial de Señales</span>
                </li>
                <li>
                    <button onclick="showSection('users')" class="nav-btn">
                        <i class='bx bx-user'></i>
                        <span class="links_name">Usuarios</span>
                    </button>
                    <span class="tooltip">Panel de Usuarios</span>
                </li>
                <li>
                    <button onclick="showSection('broadcast')" class="nav-btn">
                        <i class='bx bx-broadcast'></i>
                        <span class="links_name">Broadcast</span>
                    </button>
                    <span class="tooltip">Broadcast a Grupos</span>
                </li>
                <li>
                    <button onclick="showSection('youtube')" class="nav-btn">
                        <i class='bx bxl-youtube'></i>
                        <span class="links_name">YouTube</span>
                    </button>
                    <span class="tooltip">Canales YouTube</span>
                </li>
                <li>
                    <button onclick="showSection('traders')" class="nav-btn">
                        <i class='bx bx-brain'></i>
                        <span class="links_name">Traders</span>
                    </button>
                    <span class="tooltip">Traders</span>
                </li>
            </ul>
        </div>



    <div class="stars-layer"></div>

    <div class="max-w-7xl mx-auto animate-fadeInUp">
        
        <!-- Header -->
        <header class="mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
            <div class="flex items-center gap-3">
                <div class="p-3 bg-blue-600/20 rounded-xl border border-blue-500/30">
                    <span class="text-3xl">🚀</span>
                </div>
                <div>
                    <h1 class="text-4xl font-bold text-white tracking-tight">IndicAlerts <span class="text-blue-500">Ditox</span></h1>
                    <p class="text-gray-400 text-sm">Sistema de Monitoreo según RSI22 Suavizado</p>
                </div>
            </div>
            
            <div class="flex items-center gap-4">
                 <button onclick="document.getElementById('modal-info').showModal()" class="text-sm text-gray-400 hover:text-white transition-colors">¿Qué es?</button>
                <div class="h-4 w-px bg-gray-700"></div>
                <button onclick="document.getElementById('modal-alert').showModal()" class="text-sm text-red-400 hover:text-red-300 transition-colors">⚠️ Disclaimer</button>
                <div class="h-4 w-px bg-gray-700"></div>
                <button id="btn-soy-ditox" onclick="toggleDitoxMode()" class="text-sm text-purple-400 hover:text-purple-300 transition-colors bg-purple-900/20 px-3 py-1 rounded border border-purple-500/20">Soy Ditox</button>
                
                <!-- API Validity Bar (Admin Only) -->
                <div id="api-validity-container" class="hidden flex-col gap-1 bg-gray-800/50 p-2 rounded-xl border border-gray-700 w-48">
                    <div class="flex justify-between text-[10px] font-mono text-gray-400 uppercase">
                        <span>Vigencia de API sin IP</span>
                        <span id="api-validity-text" class="text-green-400">29 días</span>
                    </div>
                    <div class="w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                        <div id="api-validity-bar" class="bg-blue-500 h-1.5 rounded-full" style="width: 100%"></div>
                    </div>
                </div>
                
                <!-- Ditox Active Switch (Admin Only) -->
                <div id="admin-switch-container" class="hidden flex items-center gap-2 bg-gray-800/50 p-2 rounded-xl border border-gray-700">
                    <span class="text-[10px] font-mono text-gray-400 uppercase">Bot:</span>
                    <button id="btn-admin-switch" onclick="toggleAdminSwitch()" class="w-12 h-6 bg-red-600 rounded-full relative transition-colors duration-300">
                        <div class="w-4 h-4 bg-white rounded-full absolute top-1 left-1 transition-transform duration-300"></div>
                    </button>
                    <span id="status-text-switch" class="text-xs font-bold text-red-400">OFF</span>
                </div>
            </div>
        </header>

        <!-- SECTION: DASHBOARD -->
        <div id="section-dashboard" class="space-y-12">
            <!-- Ideas Ditox Section -->
            <section class="mb-16 bg-gray-800/30 backdrop-blur-lg rounded-3xl border border-gray-700/50 relative overflow-hidden" id="ideas-ditox-section">
                <!-- Stars Background from ditox.css -->
                <div class="container absolute inset-0 z-0 pointer-events-none" id="ditox-bg" style="background: radial-gradient(ellipse at bottom, #1b2735 0%, #090a0f 100%);">
                    <div id="stars"></div>
                    <div id="stars:after"></div>
                </div>
                
                <div class="relative z-10 p-8">
                    <div class="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
                        <h2 class="text-2xl font-bold text-white uppercase tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">Ideas Ditox</h2>
                        <div class="ditox-admin hidden flex gap-3">
                            <button onclick="createNewIdea()" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-2 px-6 rounded-xl shadow-[0_0_15px_rgba(37,99,235,0.3)] transition-all transform hover:scale-105">+ Agregar idea</button>
                            <button onclick="archiveIdea()" class="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white font-bold py-2 px-6 rounded-xl shadow-[0_0_15px_rgba(147,51,234,0.3)] transition-all transform hover:scale-105">Guardar ciclo</button>
                            <button onclick="deleteIdea()" class="bg-gray-700 hover:bg-red-600 text-white font-bold py-2 px-4 rounded-xl transition-colors">Eliminar</button>
                        </div>
                    </div>

                    <!-- Indicators (Constant Component) -->
                    <div id="idea-indicators" class="hidden absolute top-24 right-8 bg-gray-900/60 backdrop-blur-md p-5 rounded-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.5)] z-20 hover:bg-gray-900/80 transition-colors">
                        <div class="text-center">
                            <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold mb-1">Dirección</p>
                            <div id="idea-dir" class="text-2xl font-black text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]">LONG</div>
                        </div>
                        <div class="text-center mt-3 pt-3 border-t border-white/10">
                            <p class="text-[10px] text-gray-400 uppercase tracking-widest font-bold mb-1">Temporalidad</p>
                            <div id="idea-tf" class="text-lg font-bold text-blue-300 drop-shadow-[0_0_10px_rgba(147,197,253,0.5)]">4h</div>
                        </div>
                        <div class="ditox-admin hidden mt-3 pt-3 border-t border-white/10 space-y-2">
                            <select id="edit-idea-dir" class="bg-gray-800/80 text-white text-xs w-full p-2 rounded-lg border border-gray-600 outline-none focus:border-blue-500" onchange="updateIdeaIndicators()">
                                <option value="Long">Long</option><option value="Short">Short</option>
                            </select>
                            <select id="edit-idea-tf" class="bg-gray-800/80 text-white text-xs w-full p-2 rounded-lg border border-gray-600 outline-none focus:border-blue-500" onchange="updateIdeaIndicators()">
                                <option value="1h">1h</option><option value="2h">2h</option><option value="3h">3h</option><option value="4h">4h</option><option value="1D">1D</option><option value="1 Semana">1 Semana</option>
                            </select>
                        </div>
                    </div>

                    <!-- Empty State -->
                    <div id="idea-empty" class="text-center py-24 bg-gray-900/40 rounded-3xl border border-gray-700/30 backdrop-blur-sm">
                        <div class="text-6xl mb-4 opacity-50">🛸</div>
                        <h3 class="text-2xl font-light text-gray-400">Sin ideas en gestión actualmente</h3>
                        <div class="ditox-admin hidden mt-6">
                            <button onclick="createNewIdea()" class="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 px-8 rounded-xl shadow-[0_0_20px_rgba(37,99,235,0.4)] transition-all transform hover:scale-105">+ Agregar nueva idea</button>
                        </div>
                    </div>

                    <!-- Active Idea Content -->
                    <div id="idea-active" class="hidden">
                        <!-- Navigation spheres -->
                        <div class="flex justify-center gap-4 md:gap-12 mb-12" id="phases-nav">
                            <div class="phase-sphere cursor-pointer flex flex-col items-center transition-all duration-300 hover:scale-110" onclick="showPhase(1)" id="sphere-1">
                                <div class="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-[0_0_20px_rgba(59,130,246,0.5)] border-2 border-white/20 relative overflow-hidden group">
                                   <div class="absolute inset-0 bg-white/20 animate-pulse-slow"></div>
                                   <span class="text-2xl font-bold text-white relative z-10 drop-shadow-lg">1</span>
                                </div>
                                <p class="text-center mt-3 text-sm text-gray-300 font-bold uppercase tracking-wider">Sospecha</p>
                            </div>
                            <div class="phase-sphere cursor-pointer opacity-30 flex flex-col items-center transition-all duration-300 hover:scale-110" onclick="showPhase(2)" id="sphere-2">
                                <div class="w-16 h-16 rounded-full bg-gradient-to-br from-indigo-400 to-indigo-600 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)] border-2 border-white/20">
                                   <span class="text-2xl font-bold text-white drop-shadow-lg">2</span>
                                </div>
                                <p class="text-center mt-3 text-sm text-gray-300 font-bold uppercase tracking-wider">Idea</p>
                            </div>
                            <div class="phase-sphere cursor-pointer opacity-30 flex flex-col items-center transition-all duration-300 hover:scale-110" onclick="showPhase(3)" id="sphere-3">
                                <div class="w-16 h-16 rounded-full bg-gradient-to-br from-purple-400 to-purple-600 flex items-center justify-center shadow-[0_0_20px_rgba(168,85,247,0.3)] border-2 border-white/20">
                                   <span class="text-2xl font-bold text-white drop-shadow-lg">3</span>
                                </div>
                                <p class="text-center mt-3 text-sm text-gray-300 font-bold uppercase tracking-wider">Actualización</p>
                            </div>
                            <div class="phase-sphere cursor-pointer opacity-30 flex flex-col items-center transition-all duration-300 hover:scale-110" onclick="showPhase(4)" id="sphere-4">
                                <div class="w-16 h-16 rounded-full bg-gradient-to-br from-pink-400 to-pink-600 flex items-center justify-center shadow-[0_0_20px_rgba(236,72,153,0.3)] border-2 border-white/20">
                                   <span class="text-2xl font-bold text-white drop-shadow-lg">4</span>
                                </div>
                                <p class="text-center mt-3 text-sm text-gray-300 font-bold uppercase tracking-wider">Resultado</p>
                            </div>
                        </div>

                        <!-- Phase Content Container -->
                        <div id="phase-content-container" class="bg-gray-900/70 p-8 rounded-3xl border border-white/10 min-h-[400px] flex flex-col items-center justify-center relative transition-all duration-500 shadow-2xl backdrop-blur-xl">
                            <p id="phase-last-updated" class="absolute top-4 left-6 text-[10px] font-mono text-gray-400 uppercase tracking-widest bg-black/40 px-3 py-1 rounded-full"></p>
                            
                            <!-- Content Area -->
                            <div class="w-full flex flex-col md:flex-row items-center justify-center gap-8 mt-8 relative z-10">
                                <img id="phase-image" src="" alt="Fase Imagen" class="w-full md:w-1/2 rounded-xl shadow-[0_10px_30px_rgba(0,0,0,0.5)] hidden object-contain transition-opacity duration-300 border border-white/5" style="max-height: 50vh;">
                                <div id="phase-desc" class="mt-4 md:mt-0 text-lg text-gray-200 w-full md:w-1/2 text-left leading-relaxed"></div>
                            </div>
                            
                            <!-- Editor (Admin Only) -->
                            <div class="ditox-admin hidden w-full flex flex-col items-center mt-12 border-t border-white/10 pt-8">
                                <p class="text-sm text-blue-400 mb-3 font-semibold uppercase tracking-wider"><span class="mr-2">📸</span>Haz clic en el área y presiona <b>Ctrl+V</b> para pegar captura</p>
                                <div id="paste-area" tabindex="0" class="w-full h-32 bg-gray-900/50 border-2 border-dashed border-blue-500/50 hover:border-blue-400 rounded-2xl flex items-center justify-center text-gray-500 focus:outline-none focus:border-blue-400 focus:bg-blue-900/20 mb-6 transition-all cursor-pointer shadow-inner">
                                    <span class="text-lg">Pegar imagen aquí...</span>
                                </div>
                                <textarea id="edit-phase-desc" class="w-full bg-gray-900/80 text-white p-4 rounded-2xl mb-6 border border-gray-700 focus:border-blue-500 focus:outline-none shadow-inner" rows="4" placeholder="Descripción de la fase (soporta HTML básico: <b>negritas</b>, <i>cursivas</i> y emojis)"></textarea>
                                <button onclick="saveCurrentPhase()" class="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-400 hover:to-emerald-500 text-white font-bold py-3 px-12 rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all transform hover:-translate-y-1 text-lg">Guardar Fase</button>
                            </div>
                        </div>
                    </div>
                    
                    <!-- History Section -->
                    <div id="ideas-history-section" class="mt-12 hidden">
                        <h3 class="text-lg font-bold text-gray-400 mb-4 border-b border-gray-700 pb-2 uppercase tracking-widest">Historial de Ideas</h3>
                        <div class="overflow-x-auto">
                            <table class="min-w-full text-left">
                                <thead>
                                    <tr class="border-b border-gray-700/50 text-gray-400 text-xs uppercase tracking-wider">
                                        <th class="py-3 px-4">Fecha</th>
                                        <th class="py-3 px-4">Ciclo</th>
                                        <th class="py-3 px-4">Dirección</th>
                                        <th class="py-3 px-4">Fases</th>
                                        <th class="py-3 px-4">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody id="ideas-history-body">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </section>

            <!-- Mercado Summary Section -->
            <section class="mb-16 bg-gray-800/30 backdrop-blur-lg rounded-3xl border border-gray-700/50 p-8">
                <h2 class="text-2xl font-bold text-white mb-8 border-b border-gray-700 pb-4 uppercase">Resumen del Mercado</h2>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
                    <!-- Left: Advanced Rocket Gauge -->
                    <div class="flex flex-col items-center">
                        <h3 class="text-lg font-semibold text-gray-400 mb-8">¿Hacia dónde vamos?</h3>
                        <div id="rocket-gauge-container" class="gauge-container" style="--fire-scale: ${marketSummary.fireIntensity * 1.4}; --fire-opacity: ${marketSummary.fireIntensity};">
                            <div class="gauge-arc"></div>
                            <div id="rocket-pivot" class="rocket-pivot" style="--rot-base: ${marketSummary.rocketAngle}deg; transform: translateY(-50%) rotate(${marketSummary.rocketAngle}deg);">
                                <div id="rocket-wrapper" class="rocket-wrapper" style="filter: grayscale(${1 - marketSummary.saturation}) opacity(${marketSummary.opacity});">
                                    <div class="rocket">🚀</div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Right: Mega State -->
                    <div class="text-center md:text-left">
                        <p class="text-gray-400 text-sm uppercase tracking-widest mb-2 font-semibold">Estado Dominante</p>
                        <h2 id="dominant-state" class="text-5xl md:text-6xl font-black tracking-tighter leading-none transition-all duration-100 animate-breathing" 
                            style="color: ${marketSummary.rocketColor}">
                            ${marketSummary.dominantState.toUpperCase()}
                        </h2>
                    </div>
                </div>
            </section>

            <!-- Stats Grid (Categorized) -->
            <div class="space-y-12 mb-16">
                <section>
                    <div class="flex items-center gap-4 mb-6">
                        <h2 class="text-2xl font-bold text-blue-400">Large Caps</h2>
                        <div class="h-px flex-grow bg-gradient-to-r from-blue-500/50 to-transparent"></div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${largeCapsHtml}
                    </div>
                </section>

                <section>
                    <div class="flex items-center gap-4 mb-6">
                        <h2 class="text-2xl font-bold text-green-400">Mid Caps</h2>
                        <div class="h-px flex-grow bg-gradient-to-r from-green-500/50 to-transparent"></div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${midCapsHtml}
                    </div>
                </section>

                <section>
                    <div class="flex items-center gap-4 mb-6">
                        <h2 class="text-2xl font-bold text-orange-400">Small Caps</h2>
                        <div class="h-px flex-grow bg-gradient-to-r from-orange-500/50 to-transparent"></div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        ${smallCapsHtml}
                    </div>
                </section>
            </div>

            <!-- Tips Psicotrading Section -->
            <section class="mt-16 mb-8 bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-blue-500/20 p-8 shadow-2xl">
                <div class="text-center mb-8">
                    <h2 class="text-3xl font-bold text-white tracking-tight">Tips de Psicotrading</h2>
                    <p class="text-blue-400 font-mono text-sm mt-1">By Ditox</p>
                    <p class="text-gray-400 mt-4 max-w-2xl mx-auto text-sm">
                        La psicología es el 80% del trading. Evitar el <span class="text-red-400 font-bold">TILT</span> (pérdida del control emocional) es la clave absoluta para alcanzar la rentabilidad consistente. Un trader tranquilo sigue su plan; un trader alterado regala su dinero al mercado.
                    </p>
                </div>
                <div class="relative w-full max-w-4xl mx-auto group mt-10">
                    <!-- Quote Overlay (The Extra Touch) -->
                    <div class="absolute -top-8 left-1/2 -translate-x-1/2 z-20 w-11/12 max-w-2xl transition-all duration-500 ease-in-out transform hover:-translate-y-1" id="carousel-quote-container">
                        <div class="bg-gray-900/80 backdrop-blur-md border border-blue-500/40 shadow-[0_10px_30px_rgba(59,130,246,0.2)] rounded-2xl p-5 text-center">
                            <p id="carousel-quote" class="text-blue-300 font-medium text-sm md:text-base italic transition-opacity duration-300">"El mercado es un dispositivo para transferir dinero del impaciente al paciente."</p>
                            <p id="carousel-author" class="text-xs text-gray-500 mt-2 font-bold uppercase tracking-wider">- Warren Buffett</p>
                        </div>
                    </div>

                    <!-- Carousel Track -->
                    <div class="overflow-hidden rounded-2xl shadow-2xl border border-gray-700/50 relative pt-8" id="carousel-viewport">
                        <div class="flex transition-transform duration-700 ease-[cubic-bezier(0.25,1,0.5,1)]" id="carousel-track">
                            <!-- Slides -->
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip1.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip2.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip3.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip4.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip5.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                            <div class="min-w-full flex justify-center items-center bg-gray-900/50 p-2">
                                <img src="/src/assets/tip6.png" class="w-full h-auto object-contain max-h-[500px] rounded-xl shadow-lg">
                            </div>
                        </div>

                        <!-- Navigation Buttons -->
                        <button onclick="moveCarousel(-1)" class="absolute left-4 top-[55%] -translate-y-1/2 bg-black/60 hover:bg-blue-600/90 text-white w-12 h-12 rounded-full flex items-center justify-center backdrop-blur transition-all opacity-0 group-hover:opacity-100 transform -translate-x-4 group-hover:translate-x-0 shadow-[0_0_15px_rgba(0,0,0,0.5)] border border-white/20 z-10">
                            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M15 19l-7-7 7-7"></path></svg>
                        </button>
                        <button onclick="moveCarousel(1)" class="absolute right-4 top-[55%] -translate-y-1/2 bg-black/60 hover:bg-blue-600/90 text-white w-12 h-12 rounded-full flex items-center justify-center backdrop-blur transition-all opacity-0 group-hover:opacity-100 transform translate-x-4 group-hover:translate-x-0 shadow-[0_0_15px_rgba(0,0,0,0.5)] border border-white/20 z-10">
                            <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"></path></svg>
                        </button>
                    </div>

                    <!-- Dots -->
                    <div class="flex justify-center items-center gap-3 mt-6" id="carousel-dots">
                        <!-- Dots injected by JS -->
                    </div>
                </div>
            </section>
        </div>

        <!-- SECTION: HISTORY -->
        <div id="section-history" class="hidden">
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-gray-700/50 overflow-hidden shadow-2xl">
                <div class="p-6 border-b border-gray-700/50 flex justify-between items-center">
                    <h2 class="text-xl font-bold text-white">Historial de Señales (Últimas 20)</h2>
                    <div class="flex gap-2">
                        <span class="h-3 w-3 rounded-full bg-red-500 block"></span>
                        <span class="h-3 w-3 rounded-full bg-yellow-500 block"></span>
                        <span class="h-3 w-3 rounded-full bg-green-500 block"></span>
                    </div>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider">
                                <th class="py-4 px-6 font-semibold">Fecha</th>
                                <th class="py-4 px-6 font-semibold">Hora</th>
                                <th class="py-4 px-6 font-semibold">Par</th>
                                <th class="py-4 px-6 font-semibold">TF</th>
                                <th class="py-4 px-6 font-semibold">Señal / Estado</th>
                                <th class="py-4 px-6 font-semibold">Tangente (RSI22 Suav)</th>
                                <th class="py-4 px-6 font-semibold ditox-column hidden">Observación (by Ditox)</th>
                            </tr>
                        </thead>
                        <tbody id="history-table-body" class="text-sm divide-y divide-gray-700/50">
                            ${historyRows.length ? historyRows : '<tr><td colspan="6" class="py-8 text-center text-gray-500 italic">Esperando primeras señales del mercado...</td></tr>'}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- SECTION: BITACORA DITOX (Admin Only) -->
        <div id="section-bitacora" class="hidden">
            <!-- RENTABILIDAD DITOX CHART -->
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-purple-500/30 overflow-hidden shadow-2xl p-6 mb-8 relative">
                <h2 class="text-2xl font-bold text-white flex items-center gap-2 mb-4">
                    <span>📈</span> Rentabilidad DItox
                </h2>
                <div class="flex flex-wrap justify-between items-center mb-6 gap-4">
                    <div class="flex flex-col">
                        <label class="text-xs text-gray-400 uppercase tracking-widest mb-1">Capital Actual ($)</label>
                        <input type="number" id="capital-actual" value="1000" step="100" class="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white font-mono w-28 focus:border-purple-500 focus:outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-xs text-gray-400 uppercase tracking-widest mb-1">Tasa Mensual (%)</label>
                        <input type="number" id="tasa-mensual" value="17.5" step="0.1" class="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white font-mono w-24 focus:border-purple-500 focus:outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-xs text-gray-400 uppercase tracking-widest mb-1">Rango (Meses)</label>
                        <select id="rango-meses" class="bg-gray-900 border border-gray-700 rounded-lg p-2 text-white font-mono focus:border-purple-500 focus:outline-none">
                            <option value="6">6 Meses</option>
                            <option value="12">12 Meses</option>
                            <option value="18">18 Meses</option>
                            <option value="24">24 Meses</option>
                        </select>
                    </div>
                    <div class="flex flex-col text-right ml-auto">
                        <span class="text-xs text-gray-400 uppercase tracking-widest">Proyección Final</span>
                        <span id="proyeccion-final" class="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-green-300">0.00 USDT</span>
                    </div>
                </div>
                <div class="rentabilidad-chart-container">
                    <canvas id="rentabilidadChart"></canvas>
                </div>
            </div>
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-purple-500/30 overflow-hidden shadow-2xl p-6">
                <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
                    <div>
                        <h2 class="text-2xl font-bold text-white flex items-center gap-2">
                            <span>📔</span> Bitácora Ditox
                        </h2>
                        <p class="text-gray-400 text-sm mt-1">Registro y análisis psicológico de operaciones en MEXC.</p>
                    </div>
                    <button onclick="syncMexcTrades()" id="btn-sync-mexc" class="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-sm font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-purple-500/30 transition-all flex items-center gap-2 hover:scale-105">
                        <span id="sync-icon">🔄</span> Sincronizar Operaciones
                    </button>
                </div>
                <div class="overflow-x-auto custom-scrollbar">
                    <table class="w-full text-left border-collapse min-w-[1200px]">
                        <thead>
                            <tr class="bg-gray-900/80 text-gray-300 text-xs uppercase tracking-wider">
                                <th class="py-4 px-4 font-semibold rounded-tl-xl">Fecha/Par</th>
                                <th class="py-4 px-4 font-semibold">Operación</th>
                                <th class="py-4 px-4 font-semibold text-center bg-blue-900/20">Técnico (Híbrido)</th>
                                <th class="py-4 px-4 font-semibold text-center bg-purple-900/20">Psicología (Default: Sí/No)</th>
                                <th class="py-4 px-4 font-semibold w-48">Resultados / Reflexión</th>
                                <th class="py-4 px-4 font-semibold text-center rounded-tr-xl">% Confianza</th>
                            </tr>
                        </thead>
                        <tbody id="bitacora-table-body" class="text-sm divide-y divide-gray-700/50">
                            <tr><td colspan="6" class="py-8 text-center text-gray-500">Haz clic en "Sincronizar Operaciones" para cargar datos de MEXC.</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- SECTION: USERS (Admin Only) -->
        <div id="section-users" class="hidden">
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-purple-500/30 overflow-hidden shadow-2xl">
                <div class="p-6 border-b border-purple-500/30 flex justify-between items-center bg-purple-900/10">
                    <h2 class="text-xl font-bold text-purple-400 flex items-center gap-2">
                        <span>👥</span> Gestión de Usuarios
                    </h2>
                     <button onclick="sendGeneralBroadcast()" class="bg-gradient-to-r from-blue-600 to-purple-600 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg hover:shadow-purple-500/30 transition-all">
                        📢 Enviar Mensaje General
                    </button>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-gray-900/50 text-gray-400 text-xs uppercase tracking-wider">
                                <th class="py-4 px-6 font-semibold">ID</th>
                                <th class="py-4 px-6 font-semibold">Usuario</th>
                                <th class="py-4 px-6 font-semibold w-1/3">Configuración (Pares)</th>
                                <th class="py-4 px-6 font-semibold">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="user-table-body" class="text-sm divide-y divide-gray-700/50">
                            <tr><td colspan="4" class="py-8 text-center text-gray-500">Cargando base de datos de usuarios...</td></tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- SECTION: BROADCAST GROUPS (Admin Only) -->
        <div id="section-broadcast" class="hidden">
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-purple-500/30 overflow-hidden shadow-2xl p-6">
                <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 border-b border-purple-500/30 pb-4">
                    <div>
                        <h2 class="text-2xl font-bold text-purple-400 flex items-center gap-2">
                            <span>🚀</span> Enviar Mensaje a Grupos
                        </h2>
                        <p class="text-gray-400 text-sm mt-1">Envía análisis, imágenes y texto a múltiples grupos a la vez.</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Left: Form -->
                    <div class="space-y-4 bg-gray-900/40 p-6 rounded-2xl border border-gray-700/50">
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Mensaje (HTML permitido)</label>
                            <textarea id="broadcast-message-text" rows="5" class="w-full bg-gray-800 text-gray-200 border border-gray-600 rounded-xl p-3 focus:ring-2 focus:ring-purple-500 focus:outline-none" placeholder="Escribe tu mensaje o análisis..."></textarea>
                        </div>
                        
                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Imagen (Opcional)</label>
                            <input type="file" id="broadcast-image" accept="image/*" class="w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-purple-900/30 file:text-purple-400 hover:file:bg-purple-900/50 transition-all cursor-pointer">
                            <div id="image-preview-container" class="mt-4 hidden">
                                <img id="broadcast-image-preview" src="" class="max-h-48 rounded-xl border border-gray-600 object-contain mx-auto">
                            </div>
                        </div>

                        <button id="btn-send-broadcast-groups" onclick="sendGroupBroadcast()" class="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-3 rounded-xl shadow-lg hover:shadow-purple-500/30 transition-all flex justify-center items-center gap-2">
                            <span>📨</span> Enviar a Grupos Seleccionados
                        </button>
                    </div>

                    <!-- Right: Groups List -->
                    <div class="bg-gray-900/40 p-6 rounded-2xl border border-gray-700/50 flex flex-col max-h-[500px]">
                        <div class="flex justify-between items-center mb-4">
                            <label class="block text-sm font-medium text-gray-300">Seleccionar Grupos</label>
                            <div>
                                <button onclick="addGroup()" class="text-xs text-blue-400 hover:text-blue-300 font-bold mr-3">+ Agregar Grupo</button>
                                <button onclick="toggleAllGroups()" class="text-xs text-purple-400 hover:text-purple-300 underline">Marcar / Desmarcar Todos</button>
                            </div>
                        </div>
                        
                        <div id="groups-list-container" class="flex-grow overflow-y-auto custom-scrollbar space-y-2 pr-2">
                            <p class="text-gray-500 text-sm text-center py-4">Cargando grupos...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- SECTION: YOUTUBE CHANNELS (Admin Only) -->
        <div id="section-youtube" class="hidden">
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-red-500/30 overflow-hidden shadow-2xl p-6">
                <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 border-b border-red-500/30 pb-4">
                    <div>
                        <h2 class="text-2xl font-bold text-red-400 flex items-center gap-2">
                            <span>📺</span> Gestión de Canales YouTube
                        </h2>
                        <p class="text-gray-400 text-sm mt-1">Añade y edita canales de YouTube para el resumen automatizado.</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    <!-- Left: Form Placeholder or info -->
                    <div class="space-y-4 bg-gray-900/40 p-6 rounded-2xl border border-gray-700/50 flex flex-col justify-center items-center text-center">
                        <div class="text-6xl mb-4">🎥</div>
                        <h3 class="text-xl font-bold text-white mb-2">Bot de YouTube</h3>
                        <p class="text-sm text-gray-400">
                            Los canales añadidos aquí serán escaneados continuamente para extraer y resumir los últimos videos sobre trading y crypto. El bot actualizará los botones del comando <code class="bg-gray-800 px-1 py-0.5 rounded text-red-400">/yt</code> automáticamente.
                        </p>
                    </div>

                    <!-- Right: Channels List -->
                    <div class="bg-gray-900/40 p-6 rounded-2xl border border-gray-700/50 flex flex-col max-h-[500px]">
                        <div class="flex justify-between items-center mb-4">
                            <label class="block text-sm font-medium text-gray-300">Canales Registrados</label>
                            <div>
                                <button onclick="addYoutubeChannel()" class="text-xs text-red-400 hover:text-red-300 font-bold mr-3">+ Agregar Canal</button>
                            </div>
                        </div>
                        
                        <div id="youtube-list-container" class="flex-grow overflow-y-auto custom-scrollbar space-y-2 pr-2">
                            <p class="text-gray-500 text-sm text-center py-4">Cargando canales...</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- SECTION: TRADERS (Admin Only) -->
        <div id="section-traders" class="hidden">
            <div class="bg-gray-800/40 backdrop-blur-xl rounded-3xl border border-amber-500/30 overflow-hidden shadow-2xl p-6">
                <div class="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 border-b border-amber-500/30 pb-4">
                    <div>
                        <h2 class="text-2xl font-bold text-amber-400 flex items-center gap-2">
                            <span>🧠</span> Gestión de Traders
                        </h2>
                        <p class="text-gray-400 text-sm mt-1">Registra traders, sigue su estado y su nivel de Aura en tiempo real.</p>
                    </div>
                    <button id="btn-add-trader" onclick="addTrader()" class="bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-gray-900 font-bold text-sm px-6 py-3 rounded-xl shadow-lg hover:shadow-amber-500/30 transition-all flex items-center gap-2 hover:scale-105">
                        <span>+</span> Agregar Trader
                    </button>
                </div>

                <!-- Grid de tarjetas -->
                <div id="traders-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                    <p class="text-gray-500 text-sm text-center py-8 col-span-full">Cargando traders...</p>
                </div>
            </div>
        </div>

    </div>

    <!-- Modals -->
    <dialog id="modal-info" class="bg-gray-900 text-white rounded-2xl p-0 w-full max-w-2xl shadow-2xl backdrop:bg-black/80 border border-gray-700">
        <div class="p-8">
            <h3 class="text-2xl font-bold mb-4 text-blue-400">¿Cómo funciona IndicAlert?</h3>
            <div class="space-y-4 text-gray-300 leading-relaxed">
                <p>Todo parte desde el <strong class="text-white">RSI suavizado</strong>, que en pocas palabras, determina la tendencia de la fuerza del mercado.</p>
                <p>Cuando este suavizado es horizontal o plano, IndicAlert notificará porque es un buen momento de buscar una operación.</p>
                <div class="bg-gray-800 p-4 rounded-xl border border-gray-700">
                    <p class="text-sm">🤖 <strong class="text-white">Algoritmo:</strong> Se basa en los últimos 10 periodos anteriores para determinar si se viene de una fuerza bajista o alcista, determinando un posible LONG o SHORT.</p>
                </div>
                
                <div>
                    <h4 class="font-bold text-white mb-2 text-lg">Significado de los Estados:</h4>
                    <ul class="space-y-3 text-sm">
                        <li class="bg-purple-900/20 p-3 rounded-lg border border-purple-500/30">
                            <strong class="text-purple-400 block mb-1">🚀 En euforia:</strong> 
                            El movimiento tiene mucha fuerza, por lo que buscar una op al sentido contrario tiene bajas probabilidades de salir bien.
                        </li>
                        <li class="bg-blue-900/20 p-3 rounded-lg border border-blue-500/30">
                            <strong class="text-blue-400 block mb-1">⚡ En curso...:</strong> 
                            El movimiento ya se está dando, si estás dentro, disfruta; de lo contrario, espera a que se calme.
                        </li>
                        <li class="bg-green-900/20 p-3 rounded-lg border border-green-500/30">
                            <strong class="text-green-400 block mb-1">🍏 En terreno de...:</strong> 
                            El movimiento anterior se calmó y probablemente esté a puertas de dar otro movimiento al sentido contrario, DEJA TU ORDEN LIMIT SIEMPRE (recomendación).
                        </li>
                        <li class="bg-gray-800/50 p-3 rounded-lg border border-gray-600/30">
                            <strong class="text-gray-400 block mb-1">🦀 Indecisión:</strong>
                            El mercado no habla claro. Lo mejor es no operar.
                        </li>
                    </ul>
                </div>
            </div>
            <div class="mt-8 text-right">
                <button onclick="this.closest('dialog').close()" class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-lg font-medium transition-colors">Entendido</button>
            </div>
        </div>
    </dialog>

    <dialog id="modal-alert" class="bg-gray-900 text-white rounded-2xl p-0 w-full max-w-lg shadow-2xl backdrop:bg-black/80 border border-red-900/50">
        <div class="p-8 border-l-4 border-red-500">
            <h3 class="text-2xl font-bold mb-4 text-red-500">⚠️ Advertencia de Riesgo</h3>
            <p class="text-gray-300 mb-6 leading-relaxed">
                IndicAlert <strong class="text-white">NO es una herramienta de asesoría financiera</strong>. DYOR.
            </p>
            <div class="text-right">
                <button onclick="this.closest('dialog').close()" class="text-gray-400 hover:text-white text-sm underline">Cerrar</button>
            </div>
        </div>
    </dialog>

    <dialog id="modal-review" class="bg-slate-900 text-white rounded-3xl p-0 w-full max-w-md shadow-2xl border border-blue-500/30">
        <div class="relative overflow-hidden p-8 text-center">
            <div class="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-purple-600"></div>
            
            <div class="mb-6">
                 <div id="review-emoji" class="text-6xl mb-4 filter drop-shadow-xl animate-bounce"></div>
                 <h3 id="review-symbol" class="text-3xl font-bold text-white mb-1"></h3>
                 <p class="text-blue-400 font-mono text-sm tracking-widest">TIMEFRAME: 2H</p>
            </div>

            <div class="bg-slate-800/50 rounded-2xl p-6 mb-6 border border-slate-700">
                <div class="grid grid-cols-2 gap-4 text-left">
                    <div>
                        <p class="text-xs text-slate-400 uppercase">Precio Actual</p>
                        <p id="review-price" class="text-xl font-mono text-white"></p>
                    </div>
                    <div>
                        <p class="text-xs text-slate-400 uppercase">Estado</p>
                        <p id="review-status" class="text-sm font-bold text-white leading-tight"></p>
                    </div>
                </div>
            </div>

            <div id="review-macro-container" class="bg-slate-800/50 rounded-2xl p-4 mb-6 border border-slate-700 text-center hidden">
                 <p class="text-xs text-slate-400 uppercase">Fuerza Macro (4h)</p>
                 <p id="review-macro" class="text-lg font-bold text-white"></p>
            </div>

            <div id="review-entry-container" class="mt-4 p-4 rounded-2xl bg-purple-900/20 border border-purple-500/30 hidden">
                <p class="text-xs text-purple-400 uppercase font-bold mb-1">🎯 Última Entrada</p>
                <p id="review-entry" class="text-lg font-mono text-white font-bold"></p>
            </div>
            <br>

            <button onclick="this.closest('dialog').close()" class="w-full py-3 rounded-xl bg-white text-slate-900 font-bold hover:bg-gray-200 transition-colors">
                Cerrar Vista
            </button>
        </div>
    </dialog>

    <!-- Custom Prompt Modal -->
    <dialog id="modal-prompt" class="bg-gray-900 text-white rounded-3xl p-0 w-full max-w-md shadow-2xl backdrop:bg-black/80 border border-purple-500/30">
        <div class="p-8">
            <h3 id="prompt-title" class="text-2xl font-bold mb-4 bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent"></h3>
            <div class="mb-6">
                <textarea id="prompt-input" class="w-full bg-gray-800/50 border border-gray-700 rounded-2xl p-4 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all placeholder-gray-600" rows="3"></textarea>
            </div>
            <div class="flex justify-end gap-3">
                <button onclick="closePrompt()" class="px-6 py-2 text-sm font-semibold text-gray-400 hover:text-white transition-colors">Cancelar</button>
                <button onclick="handlePromptConfirm()" class="px-8 py-2 bg-gradient-to-r from-purple-600 to-blue-600 rounded-xl text-sm font-bold hover:shadow-[0_0_20px_rgba(168,85,247,0.4)] transition-all transform active:scale-95 text-white">Confirmar</button>
            </div>
        </div>
    </dialog>

    <dialog id="modal-tip" class="bg-black/90 w-full h-full max-w-none max-h-none m-0 backdrop:bg-black/90 p-0 border-0 flex items-center justify-center overflow-hidden transition-opacity duration-500 opacity-0 relative" onclick="closeTipModal()">
        <div id="particles-container" class="absolute inset-0 pointer-events-none"></div>
        <img id="modal-tip-img" src="" alt="Tip Modal" class="max-w-[90vw] max-h-[90vh] object-contain rounded-2xl shadow-2xl z-10 scale-95 transition-transform duration-500">
    </dialog>

    <script>
        // Inject Configuration
        window.FLAT_SYMBOLS = ${JSON.stringify(require('./config').SYMBOLS)};
        window.ADMIN_PASSWORD = ${JSON.stringify(ADMIN_PASSWORD)};
    </script>
    <script src="/dashboard.js"></script>
</body>
</html>
    `;
    res.send(html);
});

function startServer() {
    app.listen(PORT, () => {
        console.log(`🚀 Servidor Dashboard: http://localhost:${PORT}`);
    });
}

module.exports = {
    startServer,
    app
};
