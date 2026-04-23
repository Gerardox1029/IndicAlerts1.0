const RSI = require('technicalindicators').RSI;
const SMA = require('technicalindicators').SMA;

function calcularIndicadores(closes, highs, lows, period = 20, smaPeriod = 20, lookback = 10) {
    if (!closes || closes.length < 50) return null;

    // RSI
    const rsiInput = { values: closes, period: period };
    const rsiValues = RSI.calculate(rsiInput);

    if (rsiValues.length < period) return null;

    // RSI Suavizado: SMA sobre el RSI
    const smaInput = { period: smaPeriod, values: rsiValues };
    const rsiSuavizadoValues = SMA.calculate(smaInput);

    if (rsiSuavizadoValues.length < lookback + 2) return null;

    // Tangente actual
    const currentRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 1];
    const prevRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 2];
    const tangente = currentRsiSuavizado - prevRsiSuavizado;

    // Historial de tangentes (hasta 10 periodos para análisis macro de 4h)
    const tangentsHistory = [];
    for (let j = 0; j < 10; j++) {
        const idx = rsiSuavizadoValues.length - 1 - j;
        if (idx - 1 >= 0) {
            tangentsHistory.push(rsiSuavizadoValues[idx] - rsiSuavizadoValues[idx - 1]);
        }
    }

    // Análisis de Curvatura (Últimos 'lookback' periodos)
    // Extraemos hasta la vela anterior a la actual para no evaluar el cierre no completado de la última a fondo
    const recentValues = rsiSuavizadoValues.slice(-(lookback + 1), -1);
    let increasingCount = 0;
    let decreasingCount = 0;
    for (let i = 1; i < recentValues.length; i++) {
        if (recentValues[i] > recentValues[i - 1]) increasingCount++;
        if (recentValues[i] < recentValues[i - 1]) decreasingCount++;
    }

    let curveTrend = 'NEUTRAL';
    const threshold = recentValues.length - 1;
    if (threshold > 0) {
        if (decreasingCount >= threshold * 0.9) curveTrend = 'DOWN';
        else if (increasingCount >= threshold * 0.9) curveTrend = 'UP';
    }

    return {
        rsiSuavizado: currentRsiSuavizado,
        tangente: tangente,
        tangentsHistory: tangentsHistory, // [t0, t1, ... t9] (Actual -> Pasado)
        curveTrend: curveTrend,
        currentPrice: closes[closes.length - 1],
        highs, 
        lows
    };
}

function calcularTICK(highs, lows, currentPrice, terrain) {
    if (!highs || !lows || highs.length < 5 || lows.length < 5) return null;
    
    const last5Highs = highs.slice(-5);
    const last5Lows = lows.slice(-5);

    // Identificar formato de los decimales de la moneda
    const currentPriceStr = currentPrice.toString();
    const decimalIndex = currentPriceStr.indexOf('.');
    const decimals = decimalIndex === -1 ? 0 : currentPriceStr.length - decimalIndex - 1;

    let tickValue = 0;

    if (terrain === 'LONG') {
        const sortedLows = [...last5Lows].sort((a, b) => a - b);
        const sortedHighs = [...last5Highs].sort((a, b) => b - a);

        const level1 = (sortedLows[0] + sortedLows[1]) / 2; // Promedio 2 mínimos de mecha
        const level0 = (sortedHighs[0] + sortedHighs[1]) / 2; // Promedio 2 máximos de mecha

        // Retroceso 1.618 hacia abajo
        tickValue = level0 + 1.618 * (level1 - level0);
    } else if (terrain === 'SHORT') {
        const sortedLows = [...last5Lows].sort((a, b) => a - b);
        const sortedHighs = [...last5Highs].sort((a, b) => b - a);

        const level1 = (sortedHighs[0] + sortedHighs[1]) / 2; // Promedio 2 máximos de mecha
        const level0 = (sortedLows[0] + sortedLows[1]) / 2; // Promedio 2 mínimos de mecha

        // Retroceso 1.618 hacia arriba
        tickValue = level0 + 1.618 * (level1 - level0);
    } else {
        return null;
    }

    return tickValue.toFixed(decimals);
}

module.exports = {
    calcularIndicadores,
    calcularTICK
};
