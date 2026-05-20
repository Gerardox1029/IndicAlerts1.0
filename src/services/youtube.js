const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { YoutubeTranscript } = require('youtube-transcript'); // 🚀 NUEVA IMPORTACIÓN

// ─── Configuración de Canales ─────────────────────────────────────────────────
const CANALES_YT = {
    CryptoBruj: { channelId: 'UChYI1ptK3fy06LzLnwsm8pA', nombre: 'Cryptobruj' },
    InformeCrypto: { channelId: 'UCccJ73p62TFlX1ImgWEdp4g', nombre: 'Informe Crypto' }
};

let ultimosVideos = { Cryptobruj: null, InformeCrypto: null };

// ─── PROMPT DEL SISTEMA ──────────────────────────────────────────────────────
function buildPrompt(nombreCanal, titulo, transcripcion) {
    return `Actúa como un analista financiero experto. Te proporcionaré el título y la transcripción completa del último video de YouTube de "${nombreCanal}".
    
Título del video: "${titulo}"
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

// ─── Obtener último video via YouTube Data API v3 ────────────────────────────
async function getLatestVideo(canalKey) {
    const canal = CANALES_YT[canalKey];
    const apiKey = process.env.YOUTUBE_API_KEY;

    if (!apiKey) throw new Error('YOUTUBE_API_KEY no está configurada en .env');

    const url = 'https://www.googleapis.com/youtube/v3/search';
    const params = {
        part: 'snippet',
        channelId: canal.channelId,
        maxResults: 3,
        order: 'date',
        type: 'video',
        videoDuration: 'medium',
        key: apiKey
    };

    const response = await axios.get(url, { params });
    const items = response.data.items;

    if (!items || items.length === 0) {
        throw new Error(`No se encontraron videos para el canal ${canal.nombre}`);
    }

    const item = items[0];
    return {
        id: item.id.videoId,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle
    };
}

// ─── Extraer Transcripción ───────────────────────────────────────────────────
// 🚀 NUEVA FUNCIÓN: Obtiene el texto plano del video
async function getTranscript(videoId) {
    try {
        console.log(`[YT TRANSCRIPT] Extrayendo subtítulos del video ${videoId}...`);
        const transcriptRaw = await YoutubeTranscript.fetchTranscript(videoId);

        // Unir todos los fragmentos de texto en un solo string
        const textoCompleto = transcriptRaw.map(item => item.text).join(' ');
        return textoCompleto;
    } catch (error) {
        console.error(`[YT TRANSCRIPT] Error extrayendo subtítulos: ${error.message}`);
        throw new Error('NO_TRANSCRIPT');
    }
}

// ─── Generar resumen con Gemini ───────────────────────────────────────────────
async function generarResumenIA(video, nombreCanal) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY no está configurada en .env');
    }

    // 1. Obtener la transcripción real
    const transcripcion = await getTranscript(video.id);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = buildPrompt(nombreCanal, video.title, transcripcion);

    console.log(`[GEMINI] Procesando transcripción de "${video.title}"...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash', // Flash es ideal porque tiene 1 millón de tokens de contexto (soporta transcripciones de horas sin problema)
        contents: [{ role: 'user', parts: [{ text: prompt }] }]
    });

    let analisisIA = response.text;
    if (!analisisIA) throw new Error('Gemini devolvió una respuesta vacía');

    // Calcular tiempo transcurrido desde publicación
    const publicado = new Date(video.publishedAt);
    const horasAtras = Math.floor((Date.now() - publicado) / 3600000);
    const diasAtras = Math.floor(horasAtras / 24);
    const tiempoStr = horasAtras < 1 ? 'Hace menos de 1 hora'
        : horasAtras < 24 ? `Hace ${horasAtras} horas`
            : `Hace ${diasAtras} día${diasAtras > 1 ? 's' : ''}`;

    analisisIA += `\n\n⏱️ Publicado: ${tiempoStr}\n🔗 [Ver video original](${video.url})`;
    return analisisIA;
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const clave of Object.keys(CANALES_YT)) {
            try {
                const video = await getLatestVideo(clave);

                if (ultimosVideos[clave] !== null && ultimosVideos[clave] !== video.id) {
                    console.log(`[ALERTA] ¡Nuevo video de ${CANALES_YT[clave].nombre}! → ${video.title}`);
                    const resumen = await generarResumenIA(video, CANALES_YT[clave].nombre);
                    await enviarTelegramFn(resumen, 'BTCUSDT', { skipSticker: true });
                }

                ultimosVideos[clave] = video.id;
            } catch (error) {
                console.error(`[YT] Error en polling de ${CANALES_YT[clave].nombre}:`, error.message);
            }
        }
    }

    await chequearNuevosVideos();
    console.log('✅ Polling de YouTube iniciado (Analizando transcripciones cada 15 min).');
    setInterval(chequearNuevosVideos, 15 * 60 * 1000);
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
            '🤖 *Resumen de Análisis (YouTube):*\nSelecciona un canal para extraer la transcripción de su último video y resumirla:',
            opciones
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

        bot.answerCallbackQuery(callbackQuery.id, { text: `Descargando transcripción de ${canal.nombre}...` });

        const mensajeCarga = await bot.sendMessage(
            chatId,
            `🔍 Extrayendo subtítulos y analizando el último video de *${canal.nombre}*...\n_Esto puede tomar unos segundos..._`,
            { parse_mode: 'Markdown' }
        );

        try {
            const video = await getLatestVideo(canalClave);
            const resumen = await generarResumenIA(video, canal.nombre);

            await bot.editMessageText(resumen, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true // Evita que Telegram muestre una miniatura gigante del video
            });

        } catch (error) {
            console.error('[YT] Error en callback /yt:', error.message);

            let errorMsg = '❌ Ocurrió un error procesando el video.';
            if (error.message === 'NO_TRANSCRIPT') {
                errorMsg = '❌ El último video de este canal no tiene subtítulos disponibles para analizar.';
            } else if (error.message.includes('YOUTUBE_API_KEY')) {
                errorMsg = '❌ Error: `YOUTUBE_API_KEY` no configurada.';
            } else if (error.message.includes('quota')) {
                errorMsg = '❌ Se agotó la cuota diaria de YouTube Data API.';
            } else if (error.message.includes('vacía')) {
                errorMsg = '❌ La IA no pudo generar un resumen. Intenta de nuevo.';
            }

            bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown'
            }).catch(() => bot.sendMessage(chatId, errorMsg, { parse_mode: 'Markdown' }));
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };