require('dotenv').config();
const { connectDB, loadUsers } = require('./src/db/mongo');
const { initBot, setProcesarMercado } = require('./src/bot');
const { startServer } = require('./src/server');
const { startMarketLoop, procesarMercado } = require('./src/engine/loop');
const { enviarTelegram } = require('./src/bot');
const { startYoutubePolling } = require('./src/services/youtube');

async function main() {
    console.log('🚀 Iniciando IndicAlerts Ditox (Modularizado)...');

    // 1. Conexión a Base de Datos
    connectDB();
    await loadUsers();

    // 2. Iniciar Bot de Telegram
    initBot();

    // 3. Inyección de Dependencias (Ciclo reverso)
    setProcesarMercado(procesarMercado);

    // 4. Iniciar Servidor Express
    startServer();

    // 5. Iniciar Bucle de Mercado
    startMarketLoop();

    // 6. Iniciar Polling de Youtube
    startYoutubePolling(enviarTelegram);
}

main().catch(err => {
    console.error('❌ Error fatal al iniciar:', err);
});
