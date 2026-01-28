const RSI = require('technicalindicators').RSI;
const SMA = require('technicalindicators').SMA;

function calcularIndicadores(closes, highs, lows) {
    if (!closes || closes.length < 50) return null;

    // RSI de 20 períodos
    const rsiInput = { values: closes, period: 20 };
    const rsiValues = RSI.calculate(rsiInput);

    if (rsiValues.length < 20) return null;

    // RSI Suavizado: SMA de 20 sobre el RSI
    const smaInput = { period: 20, values: rsiValues };
    const rsiSuavizadoValues = SMA.calculate(smaInput);

    if (rsiSuavizadoValues.length < 15) return null;

    const currentRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 1];
    const prevRsiSuavizado = rsiSuavizadoValues[rsiSuavizadoValues.length - 2];
    const tangente = currentRsiSuavizado - prevRsiSuavizado;

    // Análisis de Curvatura (Últimos 10 periodos)
    const recentValues = rsiSuavizadoValues.slice(-11, -1);
    let increasingCount = 0;
    let decreasingCount = 0;
    for (let i = 1; i < recentValues.length; i++) {
        if (recentValues[i] > recentValues[i - 1]) increasingCount++;
        if (recentValues[i] < recentValues[i - 1]) decreasingCount++;
    }

    let curveTrend = 'NEUTRAL';
    const threshold = recentValues.length - 1;
    if (decreasingCount >= threshold * 0.9) curveTrend = 'DOWN';
    else if (increasingCount >= threshold * 0.9) curveTrend = 'UP';

    // RSI 22 (Para referencia visual si se necesita, aunque no se usa en lógica crítica aquí)
    const rsi22Values = RSI.calculate({ values: closes, period: 22 });
    // const currentRsi22 = rsi22Values.length > 0 ? rsi22Values[rsi22Values.length - 1] : 0;

    return {
        rsiSuavizado: currentRsiSuavizado,
        tangente: tangente,
        curveTrend: curveTrend,
        currentPrice: closes[closes.length - 1],
        highs, // Pasar para referencia de decimales
        lows
    };
}

module.exports = {
    calcularIndicadores
};
