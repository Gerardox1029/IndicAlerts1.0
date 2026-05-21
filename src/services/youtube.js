const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { YoutubeTranscript } = require('youtube-transcript');
const Parser = require('rss-parser'); // 🚀 NUEVA IMPORTACIÓN

const rssParser = new Parser();

// ─── Configuración de Canales ─────────────────────────────────────────────────
const CANALES_YT = {
    CryptoBruj: { channelId: 'UChYI1ptK3fy06LzLnwsm8pA', nombre: 'Cryptobruj' },
    InformeCrypto: { channelId: 'UCccJ73p62TFlX1ImgWEdp4g', nombre: 'Informe Crypto' }
};

let ultimosVideos = { CryptoBruj: null, InformeCrypto: null };

// ─── Funciones Auxiliares ────────────────────────────────────────────────────

// Convierte el formato ISO 8601 de YouTube (ej. PT15M33S) a segundos totales
function getDurationInSeconds(duration) {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1]) || 0;
    const minutes = parseInt(match[2]) || 0;
    const seconds = parseInt(match[3]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
}

// ─── PROMPT DEL SISTEMA ──────────────────────────────────────────────────────
function buildPrompt(nombreCanal, titulo, transcripcion) {
    return `Actúa como un analista financiero experto. Te proporcionaré el título y la transcripción completa del último video de YouTube de \"${nombreCanal}\".
    
Título del video: \"${titulo}\"
Transcripción:
"""
${transcripcion}
"""

Basándote exclusivamente en esta transcripción, genera un resumen técnico y fundamental sobre Bitcoin. Sigue estrictamente este formato:

Visión ${nombreCanal}: [Resume el estado actual del precio, tendencia y zonas clave de soporte/resistencia o liquidación mencionadas].

Fundamentales: [Detalla los eventos macro o noticias específicas que afectan la volatilidad y el sentido del movimiento].

Reglas:
1. Sé directo y conciso.
2. Usa emojis relacionados (ej: 📈, 📉, ₿).
3. No añadas introducciones, conclusiones ni texto innecesario fuera de la estructura solicitada.
4. Si hay precios específicos, inclúyelos siempre.`;
}

// ─── Obtener último video VÁLIDO via RSS + YouTube API (Costo: 1 punto) ──────
async function getLatestValidVideo(canalKey) {
    const canal = CANALES_YT[canalKey];
    const apiKey = process.env.YT_API_V3;

    if (!apiKey) throw new Error('YT_API_V3 no está configurada en .env');

    try {
        // 1. Leer el RSS gratuito de YouTube (Costo: 0 puntos)
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${canal.channelId}`;
        const feed = await rssParser.parseURL(rssUrl);

        if (!feed.items || feed.items.length === 0) {
            throw new Error(`No se encontraron videos en el RSS de ${canal.nombre}`);
        }

        // Tomar los últimos 3 videos del RSS para asegurar que encontramos uno válido
        const videoIds = feed.items.slice(0, 3).map(item => item.id.replace('yt:video:', ''));

        // 2. Consultar detalles de esos 3 videos de un solo golpe (Costo: 1 punto)
        const apiUrl = 'https://www.googleapis.com/youtube/v3/videos';
        const params = {
            part: 'snippet,contentDetails',
            id: videoIds.join(','),
            key: apiKey
        };

        const response = await axios.get(apiUrl, { params });

        if (response.status !== 200) {
            throw new Error(`YouTube API error: Status code ${response.status}`);
        }

        const items = response.data.items;

        // 3. Filtrar Shorts (< 60s) y Directos/Estrenos
        for (const item of items) {
            const durationSecs = getDurationInSeconds(item.contentDetails.duration);
            const isLive = item.snippet.liveBroadcastContent !== 'none'; // Descarta 'live' y 'upcoming'

            if (durationSecs >= 60 && !isLive) {
                return {
                    id: item.id,
                    url: `https://www.youtube.com/watch?v=${item.id}`,
                    title: item.snippet.title,
                    publishedAt: item.snippet.publishedAt,
                    channelTitle: item.snippet.channelTitle
                };
            }
        }

        throw new Error('NO_VALID_VIDEO');
    } catch (error) {
        console.error(`[YT] Error al obtener el último video válido de ${canal.nombre}:`, error.message);
        throw error;
    }
}

// ─── Extraer Transcripción ───────────────────────────────────────────────────
async function getTranscript(videoId) {
    try {
        const transcriptRaw = await YoutubeTranscript.fetchTranscript(videoId);
        return transcriptRaw.map(item => item.text).join(' ');
    } catch (error) {
        throw new Error('NO_TRANSCRIPT');
    }
}

// ─── Generar resumen con Gemini ───────────────────────────────────────────────
async function generarResumenIA(video, nombreCanal) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');

    const transcripcion = await getTranscript(video.id);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = buildPrompt(nombreCanal, video.title, transcripcion);

    console.log(`[GEMINI] Procesando transcripción de "${video.title}"...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    let analisisIA = response.text;
    if (!analisisIA) throw new Error('Respuesta vacía');

    // Limpieza de caracteres conflictivos para Telegram
    analisisIA = analisisIA.replace(/\*\*/g, '');

    const publicado = new Date(video.publishedAt);
    const horasAtras = Math.floor((Date.now() - publicado) / 3600000);
    const diasAtras = Math.floor(horasAtras / 24);
    const tiempoStr = horasAtras < 1 ? 'Hace menos de 1 hora'
        : horasAtras < 24 ? `Hace ${horasAtras} horas`
            : `Hace ${diasAtras} día${diasAtras > 1 ? 's' : ''}`;

    analisisIA += `\n\n⏱️ Publicado: ${tiempoStr}\n🔗 <a href=\"${video.url}\">Ver video original</a>`;
    return analisisIA;
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const clave of Object.keys(CANALES_YT)) {
            try {
                const video = await getLatestValidVideo(clave);

                if (ultimosVideos[clave] === null) {
                    ultimosVideos[clave] = video.id;
                    continue;
                }

                if (ultimosVideos[clave] !== video.id) {
                    console.log(`[ALERTA] ¡Nuevo video VÁLIDO de ${CANALES_YT[clave].nombre}! → ${video.title}`);
                    ultimosVideos[clave] = video.id;

                    const resumen = await generarResumenIA(video, CANALES_YT[clave].nombre);
                    await enviarTelegramFn(resumen, 'BTCUSDT', { skipSticker: true });
                }
            } catch (error) {
                if (error.message === 'NO_VALID_VIDEO') {
                    console.warn(`[YT] No hay videos válidos para ${CANALES_YT[clave].nombre}.`);
                } else {
                    console.error(`[YT] Error en polling de ${CANALES_YT[clave].nombre}:`, error.message);
                }
            }
        }
    }

    try {
        await chequearNuevosVideos();
        console.log('✅ Polling optimizado iniciado (RSS + YT API a 1 punto). Filtrando Shorts/Directos.');
        setInterval(chequearNuevosVideos, 15 * 60 * 1000);
    } catch (error) {
        console.error('[YT] Error crítico al iniciar el polling:', error.message);
    }
}

// ─── FLUJO 2: Comando Manual /yt ─────────────────────────────────────────────
function setupYoutubeCommands(bot) {
    bot.onText(/^\/yt$/, (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;

        const opciones = {
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔮 Cryptobruj', callback_data: 'yt_CryptoBruj' },
                    { text: '📊 Informe Crypto', callback_data: 'yt_InformeCrypto' }
                ]]
            }
        };
        if (threadId) opciones.message_thread_id = threadId;

        bot.sendMessage(
            chatId,
            '🤖 <b>Resumen de Análisis (YouTube):</b>\nSelecciona un canal para extraer el último video (ignorando Shorts/Directos):',
            { ...opciones, parse_mode: 'HTML' }
        );
    });

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        if (!action.startsWith('yt_')) return;

        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const canalClave = action.replace('yt_', '');
        const canal = CANALES_YT[canalClave];
        if (!canal) return;

        bot.answerCallbackQuery(callbackQuery.id, { text: `Buscando último video válido de ${canal.nombre}...` });

        const mensajeCarga = await bot.sendMessage(
            chatId,
            `🔍 Buscando y analizando el último video válido de <b>${canal.nombre}</b>...\n_Ignorando Shorts y transmisiones en vivo._`,
            { parse_mode: 'HTML' }
        );

        try {
            const video = await getLatestValidVideo(canalClave);
            const resumen = await generarResumenIA(video, canal.nombre);

            await bot.editMessageText(resumen, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

        } catch (error) {
            console.error(`[YT] Error en callback /yt para ${canal.nombre}:`, error.message);

            let errorMsg = '❌ Ocurrió un error procesando el video.';
            if (error.message === 'NO_TRANSCRIPT') {
                errorMsg = '❌ El último video de este canal no tiene subtítulos generados aún.';
            } else if (error.message === 'NO_VALID_VIDEO') {
                errorMsg = '❌ Los últimos videos del canal son solo Shorts o Directos. No hay contenido analizable.';
            } else if (error.message.includes('503')) {
                errorMsg = '❌ Los servidores de Gemini están saturados en este momento. Intenta en unos minutos.';
            } else {
                errorMsg = `❌ Error inesperado: ${error.message}`;
            }

            bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'HTML'
            }).catch(() => bot.sendMessage(chatId, errorMsg, { parse_mode: 'HTML' }));
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };