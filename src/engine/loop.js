const {
    SYMBOLS,
    INTERVALS,
    CHECK_INTERVAL_MS,
    REQUEST_DELAY_MS,
    CATEGORIES
} = require('../config');
const state = require('../services/state');
const { fetchData } = require('../api/binance');
const { calcularIndicadores } = require('./indicators');
const { enviarTelegram } = require('../bot');
const { formatPrice } = require('../utils/helpers');

// State references
const {
    estadoAlertas,
    history,
    terrainAlertsTracker,
    marketSummary
} = state;

// --- Helpers ---

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



function obtenerEstado(tangente, curveTrend, symbol) {
    if (tangente > 1) return { text: "LONG en euforia, no buscar SHORT", emoji: "🚀", color: "text-purple-400", weight: -10 };
    if (tangente > 0.10) return { text: "LONG en curso...", emoji: "🟢", color: "text-green-400", weight: -5 };

    if (tangente < -1) return { text: "SHORT en euforia, no buscar LONG", emoji: "🩸", color: "text-red-500", weight: 10 };
    if (tangente < -0.10) return { text: "SHORT en curso...", emoji: "🔴", color: "text-red-400", weight: 5 };

    if (curveTrend === 'DOWN') {
        return { text: "En terreno de LONG", emoji: "🍏", color: "text-lime-400", weight: 0, terrain: 'LONG' };
    }
    if (curveTrend === 'UP') {
        return { text: "En terreno de SHORT", emoji: "🍎", color: "text-orange-400", weight: 0, terrain: 'SHORT' };
    }

    return { text: "Indecisión (No operar)", emoji: "🦀", color: "text-gray-400", weight: 0 };
}

function evaluarAlertas(symbol, interval, indicadores, lastCandleTime, highs, lows, macroTrend = null) {
    const { tangente, curveTrend } = indicadores;
    let signal = null;

    if (tangente >= -0.10 && tangente <= 0.10) {
        if (curveTrend === 'DOWN') signal = 'LONG';
        else if (curveTrend === 'UP') signal = 'SHORT';
    }

    if (!signal) return null;

    // Validación extra para TF 2h con TF 4h
    // Validación extra para TF 2h con CONFIRMACIÓN MACRO (4h)
    if (interval === '2h') {
        if (signal === 'LONG') {
            // Requiere Macro Alcista (3 velas 4h con tangente positiva)
            if (macroTrend !== 'ALCISTA') return null;
        } else if (signal === 'SHORT') {
            // Requiere Macro Bajista (3 velas 4h con tangente negativa)
            if (macroTrend !== 'BAJISTA') return null;
        }
    }

    const key = `${symbol}_${interval}`;
    const estadoPrevio = estadoAlertas[key] || {};
    const now = Date.now();
    const TWELVE_HOURS = 12 * 60 * 60 * 1000;

    // 1. Same Candle Check (Anti-Spam)
    if (estadoPrevio.lastCandleTime === lastCandleTime) {
        return null;
    }

    // 2. Strict 12h Cooldown (Per Symbol)
    // Blocks ANY new individual alert for this symbol if one was sent < 12h ago.
    if (estadoPrevio.lastAlertTime) {
        if (now - estadoPrevio.lastAlertTime < TWELVE_HOURS) {
            // Update candle time to avoid re-checking every tick, but DO NOT send alert.
            // Also update entry type to keep state current for internal logic if needed.
            estadoAlertas[key] = {
                ...estadoPrevio,
                lastCandleTime: lastCandleTime,
                lastEntryType: signal
            };
            return null;
        }
    }

    // If we pass checks, we allow the alert.
    estadoAlertas[key] = {
        lastAlertSignal: signal,
        lastCandleTime: lastCandleTime,
        lastAlertTime: now,
        lastEntryType: signal
    };

    return { signal };
}

// --- Main Processes ---

async function checkConsolidatedAlerts() {
    const now = Date.now();
    const oneHour = 3600000;
    const twelveHours = 12 * 60 * 60 * 1000;

    // 1. Global General Alert Cooldown Check
    // If ANY general alert allowed in the last 12h, block ALL general alerts.
    if (terrainAlertsTracker.lastGeneralAlertTime && (now - terrainAlertsTracker.lastGeneralAlertTime < twelveHours)) {
        return;
    }

    let alertSent = false;

    for (const type of ['LONG', 'SHORT']) {
        if (alertSent) break; // If we sent one type, we stop (though usually only one triggers).

        const hits = terrainAlertsTracker[type];
        if (hits.length >= 3) {
            // Check if this specific type has been 'seen' recently? 
            // Actually, we rely on the Global 12h Cooldown above. 
            // We just need to ensure we don't spam if we just sent it.
            // But the global cooldown handles it. 
            // We might adding a "freshness" check (e.g. hits must be recent), 
            // but the loop clears old hits via trackTerrain timestamps logic elsewhere? 
            // Wait, trackTerrain adds to list. Who clears the list?
            // The list should probably be cleaned of old items.
            // Assuming `procesarMercado` or `trackTerrain` logic cleans it. 
            // Looking at `procesarMercado` (not fully visible), it likely resets lists or cleans.
            // For now, I trust the hit aggregation logic.

            if (now - terrainAlertsTracker.lastConsolidatedAlert[type] > oneHour) {
                const dominantPairs = hits.map(h => h.symbol.replace('USDT', '')).join(', ');
                const dateStr = new Date().toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });

                const message = `🚨 ALERTA DE MERCADO DITOX - ${dateStr}\n\nEn terreno de ${type},\nA TRADEAR! 🚀🔥\n\nDominantes: ${dominantPairs}`;

                const sentMessages = await enviarTelegram(message);

                // Set Global General Cooldown
                terrainAlertsTracker.lastGeneralAlertTime = now;
                alertSent = true;

                history.unshift({
                    time: new Date().toISOString(),
                    symbol: 'MERCADO',
                    interval: 'Global',
                    signal: `${type}`,
                    estadoText: `Consolidado ${type}`,
                    estadoEmoji: type === 'LONG' ? '🚀' : '🔻',
                    tangente: 0,
                    sentMessages: sentMessages || [],
                    observation: null,
                    id: Date.now(),
                    isConsolidated: true,
                    consolidatedDateStr: dateStr,
                    consolidatedDominants: dominantPairs
                });
                if (history.length > 20) history.pop();

                terrainAlertsTracker.lastConsolidatedAlert[type] = now;
            }
        }
    }
}

async function procesarMercado() {
    console.log(`[${new Date().toLocaleTimeString()}] Escaneando...`);

    let totalWeight = 0;
    let longTerrainCount = 0;
    let shortTerrainCount = 0;

    const now = Date.now();
    const oneHour = 3600000;

    // Mutate arrays from state directly
    const longList = terrainAlertsTracker.LONG.filter(t => now - t.timestamp < oneHour);
    const shortList = terrainAlertsTracker.SHORT.filter(t => now - t.timestamp < oneHour);

    // Update state arrays in place
    terrainAlertsTracker.LONG.splice(0, terrainAlertsTracker.LONG.length, ...longList);
    terrainAlertsTracker.SHORT.splice(0, terrainAlertsTracker.SHORT.length, ...shortList);

    for (const symbol of SYMBOLS) {
        for (const interval of INTERVALS) {
            await new Promise(r => setTimeout(r, REQUEST_DELAY_MS));

            const marketData = await fetchData(symbol, interval);
            if (!marketData) continue;

            const { closes, highs, lows, closeTimes } = marketData;
            const indicadores = calcularIndicadores(closes, highs, lows);
            if (!indicadores) continue;

            const lastCandleTime = closeTimes[closeTimes.length - 1];
            const estadoInfo = obtenerEstado(indicadores.tangente, indicadores.curveTrend, symbol);

            totalWeight += estadoInfo.weight || 0;
            if (estadoInfo.terrain === 'LONG') longTerrainCount++;
            if (estadoInfo.terrain === 'SHORT') shortTerrainCount++;

            const key = `${symbol}_${interval}`;
            if (!estadoAlertas[key]) estadoAlertas[key] = {};
            estadoAlertas[key].currentStateText = estadoInfo.text;
            estadoAlertas[key].currentStateEmoji = estadoInfo.emoji;
            estadoAlertas[key].currentPrice = indicadores.currentPrice;
            estadoAlertas[key].tangente = indicadores.tangente;

            // --- Lógica de validación con 4h para alertas de 2h y estado ---
            let macroTrend = 'NEUTRAL'; // ALCISTA, BAJISTA, NEUTRAL

            // Solo buscamos 4h si es 2h
            if (interval === '2h') {
                try {
                    const data4h = await fetchData(symbol, '4h');
                    if (data4h) {
                        const ind4h = calcularIndicadores(data4h.closes, data4h.highs, data4h.lows);
                        if (ind4h && ind4h.tangentsHistory && ind4h.tangentsHistory.length >= 3) {
                            // Evaluar últimas 3 velas (t0, t1, t2)
                            const [t0, t1, t2] = ind4h.tangentsHistory;
                            if (t0 > 0 && t1 > 0 && t2 > 0) macroTrend = 'ALCISTA';
                            else if (t0 < 0 && t1 < 0 && t2 < 0) macroTrend = 'BAJISTA';
                        }
                    }
                } catch (e) {
                    console.error(`Error validando 4h para ${symbol}:`, e.message);
                }
            }

            // Actualizar Estado en Dashboard con info Macro
            if (macroTrend === 'ALCISTA' && estadoInfo.terrain === 'LONG') {
                estadoAlertas[key].macroStatus = "Confirmación MACRO (4h) 🚀";
                // Solo aquí sumamos al trackTerrain para alerta general
                trackTerrain('LONG', symbol);
            } else if (macroTrend === 'BAJISTA' && estadoInfo.terrain === 'SHORT') {
                estadoAlertas[key].macroStatus = "Confirmación MACRO (4h) 🔻";
                trackTerrain('SHORT', symbol);
            } else if (estadoInfo.terrain) {
                estadoAlertas[key].macroStatus = "Sin confirmación MACRO (4h) ⚠️";
            } else {
                estadoAlertas[key].macroStatus = "";
            }

            const result = evaluarAlertas(symbol, interval, indicadores, lastCandleTime, highs, lows, macroTrend);

            if (result && result.signal) {
                const { signal } = result;



                const macroText = macroTrend === 'ALCISTA' ? "<b>Fuerza macro (4h):</b> Alcista 🚀" :
                    macroTrend === 'BAJISTA' ? "<b>Fuerza macro (4h):</b> Bajista 🔻" : "";

                let message = `🚀 ALERTA DITOX\n\n 💎 <b>${symbol} (${interval})</b>\n\n💰 <b>Precio:</b> $${indicadores.currentPrice}\n📸 <b>Estado:</b> ${estadoInfo.text} ${estadoInfo.emoji}\n🪐 ${macroText}`;

                const sentMessages = await enviarTelegram(message, symbol);

                history.unshift({
                    time: new Date().toISOString(),
                    symbol, interval, signal,
                    estadoText: estadoInfo.text,
                    estadoEmoji: estadoInfo.emoji,
                    tangente: indicadores.tangente,
                    sentMessages: sentMessages || [],
                    observation: null,
                    macroText, // Guardar texto macro para reportes admin
                    currentPrice: indicadores.currentPrice, // Guardar precio para reporte admin
                    id: Date.now()
                });
                if (history.length > 20) history.pop();
            }
        }
    }

    const maxPossibleWeight = SYMBOLS.length * 10;
    marketSummary.rocketAngle = (totalWeight / maxPossibleWeight) * 90;

    if (longTerrainCount > 0 || shortTerrainCount > 0) {
        const totalTerrain = longTerrainCount + shortTerrainCount;
        const greenRatio = longTerrainCount / totalTerrain;
        const red = Math.floor(255 * (1 - greenRatio));
        const green = Math.floor(255 * greenRatio);
        marketSummary.rocketColor = `rgb(${red}, ${green}, 0)`;
        marketSummary.terrainNote = longTerrainCount >= shortTerrainCount ? "En terreno de LONG 🚀" : "En terreno de SHORT 🔻";
    } else {
        marketSummary.rocketColor = 'rgb(156, 163, 175)';
        marketSummary.terrainNote = "Indecisión (No operar) ⚖️";
    }

    const val = marketSummary.rocketAngle;

    if (val <= -15) {
        marketSummary.fireIntensity = (val - (-15)) / ((-90) - (-15));
    } else {
        marketSummary.fireIntensity = 0;
    }

    if (val >= 15) {
        const factor = (val - 90) / (15 - 90);
        marketSummary.saturation = factor;
        marketSummary.opacity = 0.4 + (factor * 0.6);
    } else {
        marketSummary.saturation = 1;
        marketSummary.opacity = 1;
    }

    if (marketSummary.terrainNote && marketSummary.terrainNote !== "Indecisión (No operar) ⚖️") {
        marketSummary.dominantState = marketSummary.terrainNote;
    } else {
        if (val >= 45) marketSummary.dominantState = "SHORT en Euforia 🔻💀";
        else if (val > 15) marketSummary.dominantState = "Short en curso... 📉";
        else if (val <= -45) marketSummary.dominantState = "LONG en Euforia 🚀🔥";
        else if (val < -15) marketSummary.dominantState = "Long en curso... 📈";
        else marketSummary.dominantState = "Indecisión ⚖️";
    }

    const startColor = [156, 163, 175];
    const targetColor = val < 0 ? [74, 222, 128] : [248, 113, 113];
    const absVal = Math.min(Math.abs(val) / 90, 1);

    const r = Math.floor(startColor[0] + (targetColor[0] - startColor[0]) * absVal);
    const g = Math.floor(startColor[1] + (targetColor[1] - startColor[1]) * absVal);
    const b = Math.floor(startColor[2] + (targetColor[2] - startColor[2]) * absVal);
    marketSummary.rocketColor = `rgb(${r}, ${g}, ${b})`;

    await checkConsolidatedAlerts();
}

// --- Auto Shutdown Logic (Fri 3:30PM - Mon 00:00AM) ---
let isShutdown = false;

async function checkShutdownSchedule() {
    const now = new Date();
    // Peru Time (UTC-5)
    const peruTime = new Date(now.toLocaleString("en-US", { timeZone: "America/Lima" }));
    const day = peruTime.getDay(); // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
    const hour = peruTime.getHours();
    const minute = peruTime.getMinutes();

    // Viernes 15:30 (3:30 PM) -> Shutdown
    // Lunes 00:00 -> Wakeup (handled by not matching shutdown condition)

    let shouldBeOff = false;

    // Viernes >= 15:30
    if (day === 5) {
        if (hour > 15 || (hour === 15 && minute >= 30)) {
            shouldBeOff = true;
        }
    }
    // Sábado (6) y Domingo (0)
    else if (day === 6 || day === 0) {
        shouldBeOff = true;
    }

    if (shouldBeOff && !isShutdown) {
        isShutdown = true;
        console.log("💤 BOT APAGADO AUTOMÁTICAMENTE (Fin de semana)");
        await enviarTelegram("💤 BOT APAGADO: Estimado usuario, no me llevo bien con los fines de semana por falta de liquidez, nos vemos el lunes :D");
    } else if (!shouldBeOff && isShutdown) {
        isShutdown = false;
        console.log("☀️ BOT ENCENDIDO AUTOMÁTICAMENTE (Lunes)");
        await enviarTelegram("☀️ ¡Bot encendido! Lunes de oportunidades. ¡A tradear! 🚀");
    }

    return isShutdown;
}

function startMarketLoop() {
    setInterval(async () => {
        // 1. Check Admin Switch (Overrides everything)
        if (!state.isSystemActive) {
            console.log(`[${new Date().toLocaleTimeString()}] ⏸ SISTEMA EN PAUSA (Admin Switch OFF)`);

            // Update Dashboard visuals to reflect "Paused"
            state.marketSummary.dominantState = "SISTEMA DESACTIVADO 🛑";
            state.marketSummary.rocketColor = "rgb(75, 85, 99)"; // Gray-600
            state.marketSummary.terrainNote = "Esperando activación manual...";
            state.marketSummary.fireIntensity = 0;
            state.marketSummary.saturation = 0;
            return; // Skip execution
        }

        // 2. Check Schedule (Fri-Mon Shutdown)
        const off = await checkShutdownSchedule();
        if (!off) {
            procesarMercado();
        } else {
            // Weekend Mode
            state.marketSummary.dominantState = "MODO DORMIR 💤 (Fin de Semana)";
            state.marketSummary.rocketColor = "rgb(55, 65, 81)"; // Dark Gray
            state.marketSummary.terrainNote = "Bot Descansando...";
        }
    }, CHECK_INTERVAL_MS);

    // Initial Run
    if (state.isSystemActive) {
        checkShutdownSchedule().then(off => {
            if (!off) procesarMercado();
        });
    } else {
        console.log(`[${new Date().toLocaleTimeString()}] Sistema inicia DESACTIVADO.`);
    }
}

module.exports = {
    procesarMercado,
    checkConsolidatedAlerts,
    startMarketLoop,
    obtenerEstado
};
