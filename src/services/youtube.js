const Parser = require('rss-parser');
const { YoutubeTranscript } = require('youtube-transcript');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const parser = new Parser();
const CANALES_YT = {
    CryptoBruj: { id: 'UChYI1ptK3fy06LzLnwsm8pA', nombre: 'CryptoBruj' },
    InformeCrypto: { id: 'UCccJ73p62TFlX1ImgWEdp4g', nombre: 'Informe Crypto' }
};

let ultimosVideos = { CryptoBruj: null, InformeCrypto: null };

async function generarResumenIA(videoUrl, nombreCanal, fechaPublicacion) {
    try {
        const transcriptData = await YoutubeTranscript.fetchTranscript(videoUrl, { lang: 'es' }).catch(() => YoutubeTranscript.fetchTranscript(videoUrl));
        const textoCompleto = transcriptData.map(t => t.text).join(' ');

        if (!process.env.GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY no está configurada en .env");
        }

        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `Actúa como un trader institucional y analista técnico experto en criptomonedas.
A continuación te proporcionaré la transcripción completa del último análisis del canal "${nombreCanal}".

Tu tarea es analizar meticulosamente el texto, detectar la dirección del mercado que propone el autor, e identificar liquidez, indicadores y zonas de precio clave.

DEBES generar tu respuesta ESTRICTAMENTE siguiendo este formato exacto:

🎥 **Resumen del nuevo video de @${nombreCanal}**

🔸 **[Idea principal 1]**
[Explicación concisa, técnica y directa de la idea 1]

🔸 **[Idea principal 2]**
[Explicación concisa, técnica y directa de la idea 2]

🛤️ **Camino de DIOS (Análisis de Precio):**
[Precio Actual] ➡️ [Precio Objetivo 1] [📉/📈] ➡️ [Precio Objetivo 2] [📉/📈]
Explicación: [Explicación técnica profunda basada en la transcripción de por qué se irá a esos niveles. Menciona liquidaciones, divergencias u ondas si el autor lo hace].

Reglas inquebrantables:
1. NO inventes datos. Extrae solo lo que se menciona en la transcripción.
2. Si el autor no da precios exactos, deduce la tendencia e indica las zonas.
3. No saludes, no te despidas y no agregues ningún texto fuera de la plantilla solicitada.

Transcripción del video:
${textoCompleto}`;

        const result = await model.generateContent(prompt);
        let analisisIA = result.response.text();

        const horas = Math.floor((new Date() - new Date(fechaPublicacion)) / 3600000);
        const dias = Math.floor(horas / 24);
        let tiempo = horas < 1 ? 'Menos de 1 hora' : (horas < 24 ? `${horas} horas` : `${dias} días`);

        analisisIA += `\n\n⏱️ Publicado hace: ${tiempo}\n🔗 Link: ${videoUrl}`;
        return analisisIA;
    } catch (error) {
        console.error(`Error procesando video de ${nombreCanal}:`, error.message);
        return `❌ Error procesando el video de ${nombreCanal}. Asegúrate de que tenga subtítulos automáticos y de haber configurado GEMINI_API_KEY en tu .env. Detalles: ${error.message}`;
    }
}

async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const [clave, canal] of Object.entries(CANALES_YT)) {
            try {
                const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${canal.id}`);
                const ultimoVideo = feed.items[0];

                if (!ultimoVideo) continue;

                if (ultimosVideos[clave] !== null && ultimosVideos[clave] !== ultimoVideo.id) {
                    console.log(`[ALERTA] ¡Nuevo video detectado de ${canal.nombre}!`);
                    const resumen = await generarResumenIA(ultimoVideo.link, canal.nombre, ultimoVideo.pubDate);

                    // Enviar alerta de BTCUSDT a todos los que tengan la preferencia o a todos (Broadcast)
                    await enviarTelegramFn(resumen, 'BTCUSDT', { parse_mode: 'Markdown' });
                }

                ultimosVideos[clave] = ultimoVideo.id;
            } catch (error) {
                console.error(`Error en polling de YT para ${canal.nombre}:`, error.message);
            }
        }
    }

    // Inicializar para no disparar alertas retroactivas
    await chequearNuevosVideos();
    // Ejecutar cada 5 minutos
    setInterval(chequearNuevosVideos, 15 * 60 * 1000);
    console.log("✅ Polling de YouTube iniciado.");
}

function setupYoutubeCommands(bot) {
    bot.onText(/^\/yt$/, (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;

        const opciones = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "🔮 CryptoBruj", callback_data: "yt_CryptoBruj" },
                        { text: "📊 Informe Crypto", callback_data: "yt_InformeCrypto" }
                    ]
                ]
            }
        };
        if (threadId) opciones.message_thread_id = threadId;

        bot.sendMessage(chatId, "🤖 **Resumen del último video de Youtube:**\nSelecciona un canal para obtener un resumen sofisticado de su último análisis:", opciones);
    });

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;

        if (action.startsWith('yt_')) {
            const canalClave = action.split('_')[1];
            const canal = CANALES_YT[canalClave];

            if (!canal) return;

            bot.answerCallbackQuery(callbackQuery.id);
            const mensajeCarga = await bot.sendMessage(chatId, `⏳ Extrayendo y analizando el último video de **${canal.nombre}**... (Esto puede tardar un poco)`);

            try {
                const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${canal.id}`);
                const ultimoVideo = feed.items[0];

                if (!ultimoVideo) {
                    bot.editMessageText("❌ No se encontraron videos recientes.", { chat_id: chatId, message_id: mensajeCarga.message_id });
                    return;
                }

                const resumen = await generarResumenIA(ultimoVideo.link, canal.nombre, ultimoVideo.pubDate);
                bot.editMessageText(resumen, { chat_id: chatId, message_id: mensajeCarga.message_id, parse_mode: 'Markdown' });

            } catch (error) {
                console.error("Error en /yt:", error.message);
                bot.editMessageText("❌ Ocurrió un error consultando el video.", { chat_id: chatId, message_id: mensajeCarga.message_id });
            }
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };
