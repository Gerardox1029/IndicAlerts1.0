const ytSearch = require('yt-search');
const { YoutubeTranscript } = require('youtube-transcript');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Configuración de Canales ─────────────────────────────────────────────────
// Identificamos canales por su @handle — yt-search los resuelve sin depender de
// los RSS feeds de YouTube, que son inestables desde finales de 2025.
const CANALES_YT = {
    CryptoBruj: { handle: 'Cryptobruj', nombre: 'CryptoBruj' },
    InformeCrypto: { handle: 'InformeCrypto', nombre: 'Informe Crypto' }
};

// Cache: guardamos el ID del último video visto por canal para detectar novedades
let ultimosVideos = { CryptoBruj: null, InformeCrypto: null };

// ─── Obtener último video de un canal via yt-search ──────────────────────────
async function getLatestVideo(handle) {
    try {
        // Buscar los videos más recientes del canal
        const result = await ytSearch({ query: handle, category: 'channel' });

        // Buscar el canal exacto entre los resultados
        const channel = result.channels.find(c =>
            c.name.toLowerCase().includes(handle.toLowerCase())
        ) || result.channels[0];

        if (!channel) throw new Error(`Canal no encontrado: ${handle}`);

        // Buscar videos del canal por nombre
        const videosResult = await ytSearch(handle);
        const videos = videosResult.videos.filter(v =>
            v.author && v.author.name.toLowerCase().includes(handle.toLowerCase())
        );

        if (!videos || videos.length === 0) throw new Error('No se encontraron videos');

        // El primer resultado es el más reciente
        const ultimo = videos[0];
        return {
            id: ultimo.videoId,
            url: `https://www.youtube.com/watch?v=${ultimo.videoId}`,
            title: ultimo.title,
            publishedAt: ultimo.ago,
            author: ultimo.author ? ultimo.author.name : handle
        };
    } catch (error) {
        console.error(`[YT] Error buscando videos de ${handle}:`, error.message);
        return null;
    }
}

// ─── Generación de Resumen con Gemini ────────────────────────────────────────
async function generarResumenIA(video, nombreCanal) {
    try {
        // 1. Obtener transcripción (intentar español primero, luego cualquier idioma)
        let transcriptData;
        try {
            transcriptData = await YoutubeTranscript.fetchTranscript(video.url, { lang: 'es' });
        } catch {
            transcriptData = await YoutubeTranscript.fetchTranscript(video.url);
        }

        if (!transcriptData || transcriptData.length === 0) {
            throw new Error('No se encontraron subtítulos en este video. Prueba con otro.');
        }

        const textoCompleto = transcriptData.map(t => t.text).join(' ');

        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY no está configurada en .env');
        }

        // 2. Enviar a Gemini con el System Prompt del "Camino de DIOS"
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

        const prompt = `Actúa como un trader institucional y analista técnico experto en criptomonedas.
A continuación te proporcionaré la transcripción completa del último análisis del canal "${nombreCanal}".

Tu tarea es analizar meticulosamente el texto, detectar la dirección del mercado que propone el autor, e identificar liquidez, indicadores (RSI, MACD, EMA) y zonas de precio clave para BTC u otras criptos.

DEBES generar tu respuesta ESTRICTAMENTE siguiendo este formato exacto (usa Markdown con asteriscos para negrita):

🎥 **Resumen del nuevo video de @${nombreCanal}**

🔸 **[Idea principal 1]**
[Explicación concisa, técnica y directa de la idea 1]

🔸 **[Idea principal 2]**
[Explicación concisa, técnica y directa de la idea 2]

🛤️ **Camino de DIOS (Análisis de Precio):**
[Precio Actual] ➡️ [Precio Objetivo 1] [📉/📈] ➡️ [Precio Objetivo 2] [📉/📈]
Explicación: [Explicación técnica profunda basada en la transcripción. Menciona liquidaciones, divergencias u ondas si el autor las menciona. Ej: "En 74k hay liquidaciones pendientes, debe romper para ir a 78.8k"].

Reglas inquebrantables:
1. NO inventes datos. Extrae solo lo que se menciona en la transcripción.
2. Si el autor no da precios exactos, deduce la tendencia e indica zonas de soporte/resistencia.
3. No saludes, no te despidas y no agregues NINGÚN texto fuera de la plantilla.

Transcripción del video:
${textoCompleto}`;

        const result = await model.generateContent(prompt);
        let analisisIA = result.response.text();

        // 3. Agregar pie con metadatos del video
        analisisIA += `\n\n⏱️ Publicado: ${video.publishedAt}\n🔗 Link: ${video.url}`;
        return analisisIA;

    } catch (error) {
        console.error(`[YT] Error generando resumen de ${nombreCanal}:`, error.message);
        throw error; // Re-throw para que el llamador maneje el mensaje de error al usuario
    }
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const [clave, canal] of Object.entries(CANALES_YT)) {
            try {
                const video = await getLatestVideo(canal.handle);
                if (!video) continue;

                // Solo alertar si ya teníamos un video registrado Y es uno nuevo
                if (ultimosVideos[clave] !== null && ultimosVideos[clave] !== video.id) {
                    console.log(`[ALERTA] ¡Nuevo video de ${canal.nombre}! → ${video.title}`);
                    const resumen = await generarResumenIA(video, canal.nombre);
                    // Broadcast a usuarios con preferencia BTCUSDT
                    await enviarTelegramFn(resumen, 'BTCUSDT', { skipSticker: true });
                }

                // Actualizar caché
                ultimosVideos[clave] = video.id;
            } catch (error) {
                console.error(`[YT] Error en polling de ${canal.nombre}:`, error.message);
            }
        }
    }

    // Primera ejecución: solo registrar estado actual, no enviar alertas retroactivas
    await chequearNuevosVideos();
    console.log('✅ Polling de YouTube iniciado (cada 15 min via yt-search).');

    // Polling cada 15 minutos
    setInterval(chequearNuevosVideos, 15 * 60 * 1000);
}

// ─── FLUJO 2: Comando Manual /yt ─────────────────────────────────────────────
function setupYoutubeCommands(bot) {
    // Comando /yt → muestra botones de selección de canal
    bot.onText(/^\/yt$/, (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;

        const opciones = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔮 CryptoBruj', callback_data: 'yt_CryptoBruj' },
                    { text: '📊 Informe Crypto', callback_data: 'yt_InformeCrypto' }
                ]]
            }
        };
        if (threadId) opciones.message_thread_id = threadId;

        bot.sendMessage(
            chatId,
            '🤖 *Resumen del último video de Youtube:*\nSelecciona un canal para obtener un resumen sofisticado de su último análisis:',
            opciones
        );
    });

    // Callback de los botones inline
    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        if (!action.startsWith('yt_')) return;

        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const canalClave = action.replace('yt_', '');
        const canal = CANALES_YT[canalClave];

        if (!canal) return;

        // Confirmar el tap al usuario
        bot.answerCallbackQuery(callbackQuery.id, { text: `Buscando video de ${canal.nombre}...` });

        // Mensaje de "cargando"
        const mensajeCarga = await bot.sendMessage(
            chatId,
            `⏳ Buscando y analizando el último video de *${canal.nombre}*...\n_Esto puede tardar 20-40 segundos._`,
            { parse_mode: 'Markdown' }
        );

        try {
            // 1. Obtener último video
            const video = await getLatestVideo(canal.handle);
            if (!video) {
                return bot.editMessageText(
                    '❌ No se pudo obtener el último video. Intenta de nuevo en un momento.',
                    { chat_id: chatId, message_id: mensajeCarga.message_id }
                );
            }

            // 2. Generar resumen con IA
            const resumen = await generarResumenIA(video, canal.nombre);

            // 3. Reemplazar mensaje de carga con el resumen
            await bot.editMessageText(resumen, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('[YT] Error en callback /yt:', error.message);
            const errorMsg = error.message.includes('subtítulos')
                ? `❌ El video más reciente de *${canal.nombre}* no tiene subtítulos automáticos disponibles aún. Intenta más tarde.`
                : `❌ Error procesando el video: ${error.message}`;

            bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown'
            }).catch(() => bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' }));
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };
