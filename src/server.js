const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const {
    PORT,
    CATEGORIES,
    MONGODB_URI
} = require('./config');
const state = require('./services/state');
const { saveUserToMongo, User } = require('./db/mongo');
const { getBot, enviarTelegram, simulateSignalEffect } = require('./bot');
const { checkConsolidatedAlerts } = require('./engine/loop');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../'))); // Serve static from root

// Helper state local pointers
const {
    userDatabase,
    estadoAlertas,
    history,
    marketSummary
} = state;

// --- Routes ---

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
    if (password !== 'awd ') return res.status(403).json({ success: false });

    try {
        const bot = getBot();
        if (bot) await bot.sendMessage(userId, `📩 **MENSAJE DEL ADMINISTRADOR:**\n\n${message}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Admin: Actualizar señal
app.post('/admin/update-signal', async (req, res) => {
    const { password, signalId, observationType } = req.body;

    if (password !== 'awd ') {
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
        baseMessage = `🚨 ALERTA DE MERCADO DITOX - ${signalEntry.consolidatedDateStr}\n\nEn terreno de ${type},\nA TRADEAR! 🚀🔥\n\nDominantes: ${signalEntry.consolidatedDominants}\n\nObservación (by Ditox): ${observationType} ${obsEmoji}`;
    } else {
        baseMessage = `🚀 ALERTA DITOX
💎 ${signalEntry.symbol}

⏱ Temporalidad: ${signalEntry.interval}
📈 Estado: ${signalEntry.estadoText} ${signalEntry.estadoText.includes('LONG') && signalEntry.tangente > 1 ? '🚀' :
                signalEntry.estadoText.includes('LONG') ? '🟢' :
                    signalEntry.estadoText.includes('SHORT') && signalEntry.tangente < -1 ? '🩸' :
                        signalEntry.estadoText.includes('SHORT') ? '🔴' :
                            signalEntry.estadoText.includes('Terreno de LONG') ? '🍏' : '🍎'}
 Observación: ${observationType} ${obsEmoji}`;

        // Ensure lastEntryPrice exists and is valid before formatting
        /* REMOVED ENTRY TICK LOGIC */
    }

    console.log(`📝 Actualizando señal ${signalId} con observación: ${observationType}`);

    if (signalEntry.sentMessages && Array.isArray(signalEntry.sentMessages)) {
        const bot = getBot();
        for (const msgInfo of signalEntry.sentMessages) {
            try {
                if (bot) {
                    await bot.editMessageText(baseMessage, {
                        chat_id: msgInfo.chatId,
                        message_id: msgInfo.messageId
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
    if (password !== 'awd ') return res.status(403).json({ success: false });

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
    if (password !== 'awd ') return res.status(403).json({ success: false });

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
    if (password !== 'awd ') return res.status(403).json({ success: false });

    const user = userDatabase[userId];
    if (user) {
        const msg = `🧪 SIMULACRO DE ALERTA GENERAL\n\nHola ${user.username}, esto es una prueba del sistema de alertas generales.`;
        try {
            const bot = getBot();
            if (bot) await bot.sendMessage(userId, msg);
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
    if (password !== 'awd ') return res.status(401).json({ success: false, message: 'Unauthorized' });

    state.isSystemActive = active;

    console.log(`🔌 Sistema ${active ? 'ACTIVADO' : 'DESACTIVADO'} por admin.`);
    res.json({ success: true, active: state.isSystemActive });
});

// Admin: Broadcast Message
app.post('/admin/broadcast-message', async (req, res) => {
    const { password, message } = req.body;
    if (password !== 'awd ') return res.status(401).json({ success: false, message: 'Unauthorized' });
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

        // REMOVED ENTRY TICK UI LOGIC
        const lastEntryInfo = '';

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
                    <p class="text-sm font-medium text-gray-300">${statusText}</p>
                    ${lastEntryInfo}
                </div>

                <button onclick="openReviewModal('${s}', '${price}', '${statusText}', '${statusEmoji}', '${estado.lastEntryType || ''}')" 
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
                    animation: { 'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite' }
                }
            }
        }
    </script>
    <style>
        body { background: #0f111a; background-image: radial-gradient(circle at 15% 50%, rgba(76, 29, 149, 0.1), transparent 25%), radial-gradient(circle at 85% 30%, rgba(37, 99, 235, 0.1), transparent 25%); }
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
    </style>
</head>
<body class="text-gray-200 min-h-screen p-4 md:p-8">

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
            <button onclick="showSection('history')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                📜 Historial de Señales
            </button>
            <button onclick="showSection('users')" class="nav-btn px-6 py-2 rounded-xl text-sm font-bold text-gray-300 hover:bg-purple-900/30 hover:text-white transition-all">
                👥 Panel de Usuarios
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
                            El movimiento ya se está dando.
                        </li>
                        <li class="bg-green-900/20 p-3 rounded-lg border border-green-500/30">
                            <strong class="text-green-400 block mb-1">🍏 En terreno de...:</strong> 
                            El mercado se calmó y probablemente esté a puertas de dar otro movimiento.
                        </li>
                        <li class="bg-gray-800/50 p-3 rounded-lg border border-gray-600/30">
                            <strong class="text-gray-400 block mb-1">🦀 Indecisión:</strong>
                            El mercado no habla claro.
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
