const RSI = require('technicalindicators').RSI;
const SMA = require('technicalindicators').SMA;

function calcularIndicadores(closes, highs, lows, rsiPeriod = 20, smaPeriod = 20, tangentCount = 3) {
    if (!closes || closes.length < (rsiPeriod + smaPeriod + 5)) return null;

    // RSI
    const rsiInput = { values: closes, period: rsiPeriod };
    const rsiValues = RSI.calculate(rsiInput);

    if (rsiValues.length < 1) return null;

    // RSI Suavizado: SMA sobre el RSI
    const smaInput = { period: smaPeriod, values: rsiValues };
    const rsiSuavizadoValues = SMA.calculate(smaInput);

    if (rsiSuavizadoValues.length < 2) return null;

    // Tangente actual
    const currentRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 1];
    const prevRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 2];
    const tangente = currentRsiSuavizado - prevRsiSuavizado;

    // Historial de tangentes
    const tangentsHistory = [];
    const availablePoints = rsiSuavizadoValues.length;
    for (let i = 0; i < tangentCount; i++) {
        const idx = availablePoints - 1 - i;
        if (idx > 0) {
            tangentsHistory.push(rsiSuavizadoValues[idx] - rsiSuavizadoValues[idx - 1]);
        }
    }

    // Análisis de Curvatura (basado en tangentCount)
    const recentValues = rsiSuavizadoValues.slice(-(tangentCount + 1), -1);
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

    // RSI 22 (Para referencia visual si se necesita)
    // const rsi22Values = RSI.calculate({ values: closes, period: 22 });

    return {
        rsiSuavizado: currentRsiSuavizado,
        tangente: tangente,
        tangentsHistory: tangentsHistory, // [t0, t1, t2...]
        curveTrend: curveTrend,
        currentPrice: closes[closes.length - 1],
        highs,
        lows
    };
}

function calcularTICK(highs, lows, currentPrice, terrain) {
    if (!highs || !lows || highs.length < 5 || lows.length < 5) return null;

    // Obtener decimales del precio actual para el formateo final
    const priceStr = currentPrice.toString();
    const decimals = priceStr.includes('.') ? priceStr.split('.')[1].length : 0;

    // Últimas 5 velas (2h)
    const last5Highs = highs.slice(-5);
    const last5Lows = lows.slice(-5);

    let tickValue;

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

function calcularTangenteRSI(closes) {
    if (!closes || closes.length < 35) return null; // 14 (RSI) + 20 (SMA)
    
    const rsiValues = RSI.calculate({ values: closes, period: 14 });
    if (rsiValues.length < 1) return null;
    
    const smaValues = SMA.calculate({ values: rsiValues, period: 20 });
    if (smaValues.length < 2) return null;
    
    const currentSMA = smaValues[smaValues.length - 1];
    const prevSMA = smaValues[smaValues.length - 2];
    
    return currentSMA - prevSMA;
}

module.exports = {
    calcularIndicadores,
    calcularTICK,
    calcularTangenteRSI
};
