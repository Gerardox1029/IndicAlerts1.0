const ytSearch = require('yt-search');
const { GoogleGenAI } = require('@google/genai');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ─── Configuración de Canales ─────────────────────────────────────────────────
const CANALES_YT = {
    CryptoBruj:    { handle: 'Cryptobruj',    query: 'CryptoBruj bitcoin',     nombre: 'CryptoBruj'    },
    InformeCrypto: { handle: 'Informe Crypto', query: 'Informe Crypto bitcoin', nombre: 'Informe Crypto' }
};

// Cache: ID del último video detectado por canal (evita alertas retroactivas)
let ultimosVideos = { CryptoBruj: null, InformeCrypto: null };

// Directorio temporal del sistema operativo (limpio tras reinicio)
const TEMP_DIR = os.tmpdir();

// ─── PROMPT DEL SISTEMA — "Camino de DIOS" ───────────────────────────────────
function buildPrompt(nombreCanal) {
    return `Actúa como un trader institucional y analista técnico experto en criptomonedas.
Vas a escuchar el audio completo del último análisis del canal "${nombreCanal}".

Tu tarea es identificar: la dirección del mercado, zonas de precio clave (BTC u otras criptos), indicadores técnicos (RSI, MACD, EMA, CMF, WaveTrend/Cipher), liquidaciones y soportes/resistencias que el analista mencione.

DEBES generar tu respuesta ESTRICTAMENTE con este formato Markdown exacto:

🎥 **Resumen del nuevo video de @${nombreCanal}**

🔸 **[Idea principal 1]**
[Explicación concisa, técnica y directa]

🔸 **[Idea principal 2]**
[Explicación concisa, técnica y directa]

🛤️ **Camino de DIOS (Análisis de Precio):**
[Precio Actual] ➡️ [Precio Objetivo 1] [📉/📈] ➡️ [Precio Objetivo 2] [📉/📈]
Explicación: [Justificación técnica profunda. Menciona liquidaciones, divergencias y ondas si el autor las mencionó. Ej: "En $74k hay liquidaciones pendientes, debe romper para ir a $78.8k"].

Reglas inquebrantables:
1. Extrae SOLO datos que el analista mencione en el audio. NO inventes cifras.
2. Si no hay precios exactos, deduce zonas (ej: soporte actual ➡️ resistencia mayor 📈).
3. No saludes, no te despidas y NO agregues texto fuera de la plantilla.
4. Si el analista menciona RSI, MACD u otros indicadores con valores numéricos, inclúyelos en la explicación de cada idea.`;
}

// ─── DESCARGAR AUDIO con yt-dlp ──────────────────────────────────────────────
function descargarAudio(videoUrl) {
    return new Promise((resolve, reject) => {
        // Nombre de archivo único por timestamp
        const filename = `yt_audio_${Date.now()}`;
        const outputPath = path.join(TEMP_DIR, filename);

        // Descarga el audio en la calidad más baja posible (~64kbps m4a)
        // --no-playlist: evita descargar listas completas
        // --max-filesize 50m: protección contra videos de más de 50MB
        const cmd = [
            'yt-dlp',
            `"${videoUrl}"`,
            '-f', 'bestaudio[ext=m4a][abr<=128]/bestaudio[abr<=128]/bestaudio',
            '--extract-audio',
            '--audio-format', 'm4a',
            '--audio-quality', '9',      // 9 = calidad más baja (yt-dlp scale)
            '--no-playlist',
            '--max-filesize', '60m',
            '--no-warnings',
            '-o', `"${outputPath}.%(ext)s"`
        ].join(' ');

        console.log(`[YT-DLP] Descargando audio de: ${videoUrl}`);

        exec(cmd, { timeout: 120000 }, (error, stdout, stderr) => {
            if (error) {
                console.error('[YT-DLP] Error descargando:', stderr || error.message);
                return reject(new Error(`yt-dlp falló: ${stderr || error.message}`));
            }

            // Buscar el archivo generado (la extensión puede variar)
            const posibles = ['.m4a', '.mp3', '.webm', '.ogg'].map(ext => outputPath + ext);
            const archivoFinal = posibles.find(p => fs.existsSync(p));

            if (!archivoFinal) {
                return reject(new Error('yt-dlp terminó pero no se encontró el archivo de audio'));
            }

            const stats = fs.statSync(archivoFinal);
            console.log(`[YT-DLP] Audio descargado: ${archivoFinal} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
            resolve(archivoFinal);
        });
    });
}

// ─── LIMPIAR archivo local de forma segura ────────────────────────────────────
function limpiarArchivo(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log(`[YT] Archivo temporal eliminado: ${filePath}`);
        } catch (e) {
            console.warn(`[YT] No se pudo eliminar ${filePath}:`, e.message);
        }
    }
}

// ─── GENERAR RESUMEN con Gemini Files API ────────────────────────────────────
async function generarResumenIA(video, nombreCanal) {
    let audioPath = null;
    let uploadedFile = null;

    try {
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY no está configurada en .env');
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // PASO 1 — Descargar audio con yt-dlp
        audioPath = await descargarAudio(video.url);

        // PASO 2 — Subir audio a Gemini Files API
        console.log(`[GEMINI] Subiendo archivo a Files API...`);
        const mimeType = audioPath.endsWith('.mp3') ? 'audio/mp3' : 'audio/mp4';

        uploadedFile = await ai.files.upload({
            file: audioPath,
            config: { mimeType }
        });

        console.log(`[GEMINI] Archivo subido: ${uploadedFile.uri} (expira en 48h)`);

        // PASO 3 — Generar resumen con gemini-2.5-flash
        const prompt = buildPrompt(nombreCanal);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { fileData: { mimeType, fileUri: uploadedFile.uri } },
                        { text: prompt }
                    ]
                }
            ]
        });

        let analisisIA = response.text;
        if (!analisisIA) throw new Error('Gemini devolvió una respuesta vacía');

        // PASO 4 — Agregar metadatos del video al pie del mensaje
        const tiempo = video.publishedAt || 'Reciente';
        analisisIA += `\n\n⏱️ Publicado: ${tiempo}\n🔗 Link: ${video.url}`;

        return analisisIA;

    } catch (error) {
        console.error(`[YT] Error generando resumen de ${nombreCanal}:`, error.message);
        throw error;
    } finally {
        // LIMPIEZA GARANTIZADA — se ejecuta siempre, haya error o no
        limpiarArchivo(audioPath);
        // Nota: el archivo en la nube de Google se elimina automáticamente a las 48h
    }
}

// ─── Obtener último video de un canal via yt-search ──────────────────────────
async function getLatestVideo(canal) {
    try {
        const videosResult = await ytSearch(canal.query);

        // Normalizar el handle para comparar (quitar espacios, minúsculas)
        const handleNorm = canal.handle.toLowerCase().replace(/\s+/g, '');

        // Filtrar por nombre de autor (flexible)
        let videos = videosResult.videos.filter(v => {
            if (!v.author || !v.author.name) return false;
            const authorNorm = v.author.name.toLowerCase().replace(/\s+/g, '');
            return authorNorm.includes(handleNorm) || handleNorm.includes(authorNorm);
        });

        // Fallback: si no coincide el autor, usar primer resultado del query
        if (!videos || videos.length === 0) {
            console.warn(`[YT] No se filtró autor para ${canal.nombre}, usando primer resultado`);
            videos = videosResult.videos;
        }

        if (!videos || videos.length === 0) throw new Error('No se encontraron videos');

        const ultimo = videos[0];
        console.log(`[YT] Último video de ${canal.nombre}: "${ultimo.title}" (${ultimo.ago})`);
        return {
            id: ultimo.videoId,
            url: `https://www.youtube.com/watch?v=${ultimo.videoId}`,
            title: ultimo.title,
            publishedAt: ultimo.ago,
            author: ultimo.author ? ultimo.author.name : canal.handle
        };
    } catch (error) {
        console.error(`[YT] Error buscando videos de ${canal.nombre}:`, error.message);
        return null;
    }
}

// ─── FLUJO 1: Polling Constante (cada 15 min) ─────────────────────────────────
async function startYoutubePolling(enviarTelegramFn) {
    async function chequearNuevosVideos() {
        for (const [clave, canal] of Object.entries(CANALES_YT)) {
            try {
                const video = await getLatestVideo(canal);
                if (!video) continue;

                // Alertar solo si es un video nuevo (no el que ya teníamos)
                if (ultimosVideos[clave] !== null && ultimosVideos[clave] !== video.id) {
                    console.log(`[ALERTA] ¡Nuevo video de ${canal.nombre}! → ${video.title}`);
                    const resumen = await generarResumenIA(video, canal.nombre);
                    await enviarTelegramFn(resumen, 'BTCUSDT', { skipSticker: true });
                }

                ultimosVideos[clave] = video.id;
            } catch (error) {
                console.error(`[YT] Error en polling de ${canal.nombre}:`, error.message);
            }
        }
    }

    // Primera ejecución: registrar estado actual sin enviar alertas
    await chequearNuevosVideos();
    console.log('✅ Polling de YouTube iniciado (cada 15 min, audio via yt-dlp + Gemini).');

    setInterval(chequearNuevosVideos, 15 * 60 * 1000);
}

// ─── FLUJO 2: Comando Manual /yt ─────────────────────────────────────────────
function setupYoutubeCommands(bot) {
    bot.onText(/^\/yt$/, (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;

        const opciones = {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [[
                    { text: '🔮 CryptoBruj',    callback_data: 'yt_CryptoBruj'    },
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

    bot.on('callback_query', async (callbackQuery) => {
        const action = callbackQuery.data;
        if (!action.startsWith('yt_')) return;

        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const canalClave = action.replace('yt_', '');
        const canal = CANALES_YT[canalClave];
        if (!canal) return;

        bot.answerCallbackQuery(callbackQuery.id, { text: `Buscando video de ${canal.nombre}...` });

        const mensajeCarga = await bot.sendMessage(
            chatId,
            `⏳ Descargando y analizando el audio del último video de *${canal.nombre}*...\n_Este proceso puede tardar 30-60 segundos según la duración del video._`,
            { parse_mode: 'Markdown' }
        );

        try {
            const video = await getLatestVideo(canal);
            if (!video) {
                return bot.editMessageText(
                    '❌ No se pudo encontrar el último video. Intenta de nuevo.',
                    { chat_id: chatId, message_id: mensajeCarga.message_id }
                );
            }

            const resumen = await generarResumenIA(video, canal.nombre);

            await bot.editMessageText(resumen, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id,
                parse_mode: 'Markdown'
            });

        } catch (error) {
            console.error('[YT] Error en callback /yt:', error.message);

            let errorMsg = '❌ Ocurrió un error procesando el video.';
            if (error.message.includes('yt-dlp')) {
                errorMsg = '❌ No se pudo descargar el audio del video. YouTube puede estar bloqueando la descarga temporalmente.';
            } else if (error.message.includes('filesize') || error.message.includes('60m')) {
                errorMsg = '❌ El video es demasiado largo/pesado para procesarlo. Intenta con uno más corto.';
            } else if (error.message.includes('GEMINI') || error.message.includes('API_KEY')) {
                errorMsg = '❌ Error de configuración de IA. Contacta al administrador.';
            }

            bot.editMessageText(errorMsg, {
                chat_id: chatId,
                message_id: mensajeCarga.message_id
            }).catch(() => bot.sendMessage(chatId, errorMsg));
        }
    });
}

module.exports = { startYoutubePolling, setupYoutubeCommands };
