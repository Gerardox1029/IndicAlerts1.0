const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');
const { YoutubeTranscript } = require('youtube-transcript');
const Parser = require('rss-parser'); // 🚀 NUEVA IMPORTACIÓN
const { YoutubeChannel } = require('../db/mongo');
const fs = require('fs');
const path = require('path');

const rssParser = new Parser();

let ultimosVideos = {};

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

function buildPrompt(nombreCanal, titulo, transcripcion) {
    return `Actúa como un analista financiero experto en trading de criptomonedas a corto plazo. Te proporcionaré el título y la transcripción de un video de YouTube de "${nombreCanal}".
    
Título del video: "${titulo}"
Transcripción:
"""
${transcripcion}
"""

Tu objetivo es extraer EXCLUSIVAMENTE la estrategia e información útil para el CORTO PLAZO (próximos 1, 2 o 3 días máximo). 

REGLAS DE FILTRADO (LO QUE DEBES IGNORAR):
1. Ignora por completo análisis macroeconómicos, fundamentales tradicionales o noticias.
2. Ignora estrategias de largo plazo (como compras Spot a meses, Hold, o acumulación DCA).
3. Ignora los nombres de indicadores técnicos (no menciones RSI, MACD, Medias Móviles, etc.). Concéntrate solo en el precio y la acción resultante.
4. Ignora proyecciones lejanas (ej. "objetivos a final de año", caídas a zonas irrelevantes para los próximos 3 días).
5. Ignora análisis de altcoins, solo BTC.

Genera el resumen siguiendo ESTRICTAMENTE esta estructura exacta (mantén los saltos de línea):

Visión ${nombreCanal} ([alcista/bajista/neutral]): [Breve estado actual ₿ en MAYÚSCULAS con emoji direccional 📈/📉/🟢/🔴]

🪬Idea principal: [Resumen de 1 o 2 líneas del movimiento inmediato esperado con emoji direccional 📈/📉/🟢/🔴]]. 

🎯Ideas clave: 

[Aquí introduce SOLO los gatillos operativos de los próximos 1-3 días (ej. zonas exactas de Long, Short, Liquidaciones o rebotes inminentes), redacta máximo 3 ideas, cada una en una línea diferente y todas comenzando con el emogi 💡, de forma ultra-concreta, usando emojis y sin repetir información entre ideas].

Reglas OBLIGATORIAS de formato:
1. Sé extremadamente puntual, directo y estilo telegrama. Cero introducciones, saludos o conclusiones.
2. Resalta TODOS los precios exactos en negrita usando las etiquetas <strong>precio</strong> (Ejemplo: <strong>$64,800</strong>).
3. Resalta las palabras relacionadas a tendencia con las etiquetas <strong>tendencia</strong> (Ejemplo: <strong>alcista</strong>, <strong>bajista</strong>).
4. Resalta Visión, Idea Principal e Ideas clave con la etiqueta <strong></strong>.
5. No agregues subtítulos ni listas con viñetas después de "Ideas clave:"  
6. Mantén los saltos de línea entre cada sección tal cual se muestra en la estructura para facilitar la lectura rápida, cada Idea Clave tiene un salto de línea`;
}

// ─── Obtener último video VÁLIDO via RSS + YouTube API (Costo: 1 punto) ──────
async function getLatestValidVideo(canal) {
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

// ─── Lógica de Caché ──────────────────────────────────────────────────────────
const CACHE_DIR = path.join(__dirname, '../../cache_analisis');

function cleanOldCache() {
    if (!fs.existsSync(CACHE_DIR)) return;
    
    const files = fs.readdirSync(CACHE_DIR);
    const now = Date.now();
    const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

    files.forEach(file => {
        if (!file.endsWith('.json')) return;
        const filePath = path.join(CACHE_DIR, file);
        try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > TEN_DAYS_MS) {
                fs.unlinkSync(filePath);
                console.log(`[CACHE CLEANUP] Archivo antiguo eliminado: ${file}`);
            }
        } catch (e) {
            console.error(`[CACHE ERROR] Error al limpiar cache ${file}:`, e.message);
        }
    });
}

// ─── Generar resumen con Gemini (Con Caché Local Integrado) ───────────────────
async function generarResumenIA(video, nombreCanal) {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const videoId = video.id;
    const cachePath = path.join(CACHE_DIR, `${videoId}.json`);

    // 1. Verificación: Si existe (Cache Hit)
    if (fs.existsSync(cachePath)) {
        try {
            const cachedData = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
            console.log(`[CACHE HIT] Usando análisis guardado para el video: ${videoId}`);
            return cachedData.analisis;
        } catch (e) {
            console.warn(`[CACHE WARNING] Archivo corrupto, se regenerará: ${videoId}`);
        }
    }

    // 2. Si no existe (Cache Miss)
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY no configurada');

    // 2.1 Limpieza de archivos antiguos
    cleanOldCache();

    // 2.2 Llamada a Gemini
    const transcripcion = await getTranscript(videoId);
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = buildPrompt(nombreCanal, video.title, transcripcion);

    console.log(`[GEMINI] Procesando transcripción de "${video.title}"... (Cache Miss)`);

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

    // 2.3 Guardar el resultado en caché
    try {
        const cacheContent = {
            video_id: videoId,
            nombre_canal: nombreCanal,
            fecha_creacion: new Date().toISOString(),
            analisis: analisisIA
        };
        fs.writeFileSync(cachePath, JSON.stringify(cacheContent, null, 2), 'utf8');
        console.log(`[CACHE SAVE] Análisis guardado en caché: ${videoId}.json`);
    } catch (e) {
        console.error(`[CACHE ERROR] No se pudo guardar el archivo: ${videoId}.json`, e.message);
    }

    return analisisIA;
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        try {
            const canales = await YoutubeChannel.find();
            for (const canal of canales) {
                try {
                    const video = await getLatestValidVideo(canal);

                    if (!ultimosVideos[canal.channelId]) {
                        ultimosVideos[canal.channelId] = video.id;
                        continue;
                    }

                    if (ultimosVideos[canal.channelId] !== video.id) {
                        console.log(`[ALERTA] ¡Nuevo video VÁLIDO de ${canal.nombre}! → ${video.title}`);
                        ultimosVideos[canal.channelId] = video.id;

                        const resumen = await generarResumenIA(video, canal.nombre);
                        await enviarTelegramFn(resumen, 'BTCUSDT', { skipSticker: true });
                    }
                } catch (error) {
                    if (error.message === 'NO_VALID_VIDEO') {
                        console.warn(`[YT] No hay videos válidos para ${canal.nombre}.`);
                    } else {
                        console.error(`[YT] Error en polling de ${canal.nombre}:`, error.message);
                    }
                }
            }
        } catch (error) {
            console.error('[YT] Error al obtener canales de la DB:', error.message);
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
    bot.onText(/^\/yt$/, async (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;

        try {
            const canales = await YoutubeChannel.find();
            if (canales.length === 0) {
                return bot.sendMessage(chatId, '❌ No hay canales de YouTube configurados.');
            }

            const buttons = canales.map(c => ({ text: `🎥 ${c.nombre}`, callback_data: `yt_${c.channelId}` }));

            const inline_keyboard = [];
            for (let i = 0; i < buttons.length; i += 2) {
                inline_keyboard.push(buttons.slice(i, i + 2));
            }

            const opciones = {
                reply_markup: { inline_keyboard }
            };
            if (threadId) opciones.message_thread_id = threadId;

            bot.sendMessage(
                chatId,
                '🤖 <b>Resumen de Análisis (YouTube):</b>\nSelecciona un canal para extraer el último video (ignorando Shorts/Directos):',
                { ...opciones, parse_mode: 'HTML' }
            );
        } catch (error) {
            bot.sendMessage(chatId, '❌ Error al cargar canales de YouTube.');
        }
    });

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        if (!action.startsWith('yt_')) return;

        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const channelId = action.replace('yt_', '');

        try {
            const canal = await YoutubeChannel.findOne({ channelId });
            if (!canal) return bot.answerCallbackQuery(callbackQuery.id, { text: 'Canal no encontrado', show_alert: true });

            bot.answerCallbackQuery(callbackQuery.id, { text: `Buscando último video válido de ${canal.nombre}...` });

            const mensajeCarga = await bot.sendMessage(
                chatId,
                `🔍 Buscando y analizando el último video válido de <b>${canal.nombre}</b>...\n_Ignorando Shorts y transmisiones en vivo._`,
                { parse_mode: 'HTML' }
            );

            try {
                const video = await getLatestValidVideo(canal);
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
        } catch (error) {
            console.error(error);
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };