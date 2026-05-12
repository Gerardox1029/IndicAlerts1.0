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
const { saveUserToMongo, User } = require('./db/mongo');
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

const TARGET_GROUPS = [
    { id: '-1003055730763', name: 'Grupo 1 (-1003055730763)' },
    { id: '-1002236838794', name: 'Grupo 2 (-1002236838794)' },
    { id: '@MEXCSpanish', name: 'MEXC Spanish' },
    { id: '@BCDTrading', name: 'BCD Trading' },
    { id: '@AltCryptoGrupo', name: 'AltCrypto Grupo' },
    { id: '-1002875737156', name: 'Grupo 3 (-1002875737156)' },
    { id: '-1002614085310', name: 'Grupo 4 (-1002614085310)' },
    { id: '-1003128852916', name: 'Grupo 5 (-1003128852916)' },
    { id: '-1003752210566', name: 'Grupo Pruebas (Test -1003752210566)' }
];

app.get('/admin/groups', (req, res) => {
    res.json(TARGET_GROUPS);
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
</head>
<body class="text-gray-200 min-h-screen p-4 md:p-8">
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

        <!-- Ditox Nav Bar -->
        <nav id="ditox-navbar" class="hidden mb-8 bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-2 flex justify-center gap-2 shadow-2xl">
            <button onclick="showSection('dashboard')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                🚀 Panel del Bot
            </button>
            <button onclick="showSection('bitacora')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                📔 Bitácora Ditox
            </button>
            <button onclick="showSection('history')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                📜 Historial de Señales
            </button>
            <button onclick="showSection('users')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                👥 Panel de Usuarios
            </button>
            <button onclick="showSection('broadcast')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                📢 Broadcast a Grupos
            </button>
        </nav>


        <nav class="hidden mb-8 bg-gray-800/60 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-2 flex justify-center gap-2 shadow-2xl">
            <button onclick="showSection('scalper')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                🚀 Scalper Mode
            </button>
            <button onclick="showSection('dashboard')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                📜 Intraday Mode
            </button>
            <button onclick="showSection('swingtrader')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                👥 Swing trader Mode
            </button>
        </nav>

        <!-- SECTION: DASHBOARD -->
        <div id="section-dashboard" class="space-y-12">
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
                <div class="grid grid-cols-3 grid-rows-2 gap-6">
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip1.png')">
                        <img src="/src/assets/tip1.png" alt="Tip 1" class="w-full h-auto object-cover">
                    </div>
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip2.png')">
                        <img src="/src/assets/tip2.png" alt="Tip 2" class="w-full h-auto object-cover">
                    </div>
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip3.png')">
                        <img src="/src/assets/tip3.png" alt="Tip 3" class="w-full h-auto object-cover">
                    </div>
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip4.png')">
                        <img src="/src/assets/tip4.png" alt="Tip 4" class="w-full h-auto object-cover">
                    </div>
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip5.png')">
                        <img src="/src/assets/tip5.png" alt="Tip 5" class="w-full h-auto object-cover">
                    </div>
                    <div class="rounded-xl overflow-hidden shadow-lg border border-gray-700 hover:border-blue-500/50 transition-all hover:scale-105 cursor-pointer" onclick="openTipModal('/src/assets/tip6.png')">
                        <img src="/src/assets/tip6.png" alt="Tip 6" class="w-full h-auto object-cover">
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
                            <button onclick="toggleAllGroups()" class="text-xs text-purple-400 hover:text-purple-300 underline">Marcar / Desmarcar Todos</button>
                        </div>
                        
                        <div id="groups-list-container" class="flex-grow overflow-y-auto custom-scrollbar space-y-2 pr-2">
                            <p class="text-gray-500 text-sm text-center py-4">Cargando grupos...</p>
                        </div>
                    </div>
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
