const axios = require('axios');
const { GoogleGenAI } = require('@google/genai');

// ─── Configuración de Canales ─────────────────────────────────────────────────
// Channel IDs oficiales de YouTube (verificados)
const CANALES_YT = {
    CryptoBruj: { channelId: 'UChYI1ptK3fy06LzLnwsm8pA', nombre: 'CryptoBruj' },
    InformeCrypto: { channelId: 'UCccJ73p62TFlX1ImgWEdp4g', nombre: 'Informe Crypto' }
};

// Cache: ID del último video detectado por canal (evita alertas retroactivas)
let ultimosVideos = { CryptoBruj: null, InformeCrypto: null };

// ─── PROMPT DEL SISTEMA — "Camino de DIOS" ───────────────────────────────────
function buildPrompt(nombreCanal, titulo, descripcion) {
    return `Actúa como un trader institucional y analista técnico experto en criptomonedas.

A continuación recibirás el TÍTULO y la DESCRIPCIÓN del último video publicado por el canal "${nombreCanal}".
Basándote en estos textos, debes inferir el análisis técnico del mercado, identificar la dirección del precio de BTC u otras criptos, zonas de precio clave, indicadores relevantes (RSI, MACD, EMA, liquidaciones, soportes/resistencias) y la narrativa técnica que el analista propone.

TÍTULO DEL VIDEO:
"${titulo}"

DESCRIPCIÓN DEL VIDEO:
${descripcion || '(Sin descripción disponible)'}

---

DEBES generar tu respuesta ESTRICTAMENTE con este formato Markdown exacto. No agregues nada fuera de la plantilla:

🎥 **Resumen del nuevo video de @${nombreCanal}**

🔸 **[Idea principal 1 — extráela del título/descripción]**
[Explicación técnica concisa y directa]

🔸 **[Idea principal 2 — extráela del título/descripción]**
[Explicación técnica concisa y directa]

🛤️ **Camino de DIOS (Análisis de Precio):**
[Precio Actual estimado/mencionado] ➡️ [Precio Objetivo 1] [📉/📈] ➡️ [Precio Objetivo 2] [📉/📈]
Explicación: [Justificación técnica detallada. Si hay precios numéricos en el título o descripción, úsalos. Si no, infiere zonas lógicas según el contexto del video. Menciona liquidaciones, divergencias y ondas si el analista las señala].

Reglas inquebrantables:
1. Extrae SOLO datos que aparezcan en el título o descripción. NO inventes cifras que no estén presentes.
2. Si no hay precios exactos, usa el contexto para inferir zonas técnicas (ej: "soporte actual ➡️ resistencia clave 📈").
3. No saludes, no te despidas y NO agregues texto fuera de la plantilla.
4. Si hay valores de RSI, precios o porcentajes mencionados, inclúyelos con precisión.`;
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
        maxResults: 1,
        order: 'date',
        type: 'video',
        key: apiKey
    };

    const response = await axios.get(url, { params });
    const items = response.data.items;

    if (!items || items.length === 0) {
        throw new Error(`No se encontraron videos para el canal ${canal.nombre}`);
    }

    const item = items[0];
    const videoId = item.id.videoId;
    const snippet = item.snippet;

    console.log(`[YT API] Último video de ${canal.nombre}: "${snippet.title}" (${snippet.publishedAt})`);

    return {
        id: videoId,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        title: snippet.title,
        description: snippet.description,
        publishedAt: snippet.publishedAt,
        channelTitle: snippet.channelTitle
    };
}

// ─── Generar resumen con Gemini ───────────────────────────────────────────────
async function generarResumenIA(video, nombreCanal) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY no está configurada en .env');
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = buildPrompt(nombreCanal, video.title, video.description);

    console.log(`[GEMINI] Generando resumen de "${video.title}"...`);

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
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

    analisisIA += `\n\n⏱️ Publicado: ${tiempoStr}\n🔗 Link: ${video.url}`;
    return analisisIA;
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const clave of Object.keys(CANALES_YT)) {
            try {
                const video = await getLatestVideo(clave);

                // Alertar solo si es un video nuevo (no el que ya teníamos)
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

    // Primera ejecución: solo registrar estado actual, NO enviar alertas
    await chequearNuevosVideos();
    console.log('✅ Polling de YouTube iniciado (cada 15 min via YouTube Data API v3).');

    setInterval(chequearNuevosVideos, 15 * 60 * 1000);
}

// ─── FLUJO 2: Comando Manual /yt ─────────────────────────────────────────────
function setupYoutubeCommands(bot) {
    // /yt → muestra botones de selección de canal
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

    // Callback de botones inline
    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        if (!action.startsWith('yt_')) return;

        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const canalClave = action.replace('yt_', '');
        const canal = CANALES_YT[canalClave];
        if (!canal) return;

        bot.answerCallbackQuery(callbackQuery.id, { text: `Consultando último video de ${canal.nombre}...` });

        const mensajeCarga = await bot.sendMessage(
            chatId,
            `🔍 Obteniendo y analizando el último video de *${canal.nombre}*...\n_Usando YouTube Data API v3 + Gemini 2.5 Flash_`,
            { parse_mode: 'Markdown' }
        );

        try {
            const video = await getLatestVideo(canalClave);
            const resumen = await generarResumenIA(video, canal.nombre);

            await bot.editMessageText(resumen, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('[YT] Error en callback /yt:', error.message);

            let errorMsg = '❌ Ocurrió un error procesando el video.';
            if (error.message.includes('YOUTUBE_API_KEY')) {
                errorMsg = '❌ Error: `YOUTUBE_API_KEY` no configurada. Contacta al administrador.';
            } else if (error.message.includes('quota')) {
                errorMsg = '❌ Se agotó la cuota diaria de YouTube Data API. Intenta mañana.';
            } else if (error.message.includes('GEMINI_API_KEY')) {
                errorMsg = '❌ Error: `GEMINI_API_KEY` no configurada. Contacta al administrador.';
            } else if (error.message.includes('vacía')) {
                errorMsg = '❌ La IA no pudo generar un resumen para este video. Intenta de nuevo.';
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
