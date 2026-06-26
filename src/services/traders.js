/**
 * traders.js — Módulo de comandos Telegram para el sistema de Traders.
 * Patrón idéntico a youtube.js: función setupTraderCommands(bot) exportada.
 */

const { Trader } = require('../db/mongo');

// ── Función auxiliar: calcula Aura sin instanciar el método virtual ───────────
function getAuraLevel(hits, misses) {
    const total = hits + misses;
    if (total === 0) return { winRate: 0, level: 'B' };
    const wr = (hits / total) * 100;
    let level;
    if (wr >= 80)      level = 'AAA';
    else if (wr >= 75) level = 'AA';
    else if (wr >= 70) level = 'A';
    else               level = 'B';
    return { winRate: parseFloat(wr.toFixed(1)), level };
}

// ── Emoji de estado ────────────────────────────────────────────────────────────
function stateEmoji(state) {
    if (state === 'alcista')  return '🟢';
    if (state === 'bajista')  return '🔴';
    return '⚪';
}

// ── Setup de comandos ──────────────────────────────────────────────────────────
function setupTraderCommands(bot) {

    // /traders — Lista todos los traders con estado e inline keyboard
    bot.onText(/^\/traders$/i, async (msg) => {
        const chatId = msg.chat.id;
        const threadId = msg.message_thread_id;
        const sendOpts = threadId ? { message_thread_id: threadId, parse_mode: 'HTML' } : { parse_mode: 'HTML' };

        try {
            const traders = await Trader.find({}).sort({ createdAt: 1 });

            if (traders.length === 0) {
                return bot.sendMessage(chatId, '❌ No hay traders registrados aún.', sendOpts);
            }

            // Construir lista de texto
            const lines = traders.map((t, i) => {
                const emoji = stateEmoji(t.state);
                const stateLabel = t.state.charAt(0).toUpperCase() + t.state.slice(1);
                return `${i + 1} <b>${t.name}</b> (${stateLabel}${emoji})`;
            });

            const listaTexto = lines.join('\n');
            const headerText = `📊 <b>TRADERS DITOX</b>\n\n${listaTexto}`;

            // Construir inline keyboard: 1 botón por fila (o 2 si son muchos)
            const inline_keyboard = traders.map(t => ([
                { text: t.name, callback_data: `trader_detail_${t._id}` }
            ]));

            await bot.sendMessage(chatId, headerText, {
                ...sendOpts,
                reply_markup: { inline_keyboard }
            });

        } catch (error) {
            console.error('[TRADERS] Error en /traders:', error.message);
            bot.sendMessage(chatId, '❌ Error al obtener la lista de traders.', sendOpts);
        }
    });

    // Callback: trader_detail_{id} — Muestra la ficha completa del trader
    bot.on('callback_query', async (query) => {
        const data = query.data;
        if (!data.startsWith('trader_detail_')) return;

        const traderId = data.replace('trader_detail_', '');
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        try {
            const trader = await Trader.findById(traderId);
            if (!trader) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Trader no encontrado.', show_alert: true });
            }

            const { winRate, level } = getAuraLevel(trader.hits, trader.misses);
            const emoji = stateEmoji(trader.state);
            const stateLabel = trader.state.charAt(0).toUpperCase() + trader.state.slice(1);
            const historial = trader.recentHistory.length > 0
                ? trader.recentHistory.join('')
                : '—';

            // Nivel con color visual por texto
            const auraDisplay = `${level} (${winRate}% de acierto)`;

            let respuesta =
`🧠 <b>Trader: ${trader.name}</b>

✨ <b>Aura:</b> ${auraDisplay}
📌 <b>Estado:</b> ${stateLabel} ${emoji}
🔥 <b>Historial reciente:</b> ${historial}`;

            if (trader.mainIdea) {
                respuesta += `\n💡 <b>Idea principal:</b> ${trader.mainIdea}`;
            }

            // Responder editando el mensaje o enviando uno nuevo
            await bot.editMessageText(respuesta, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: query.message.reply_markup // Mantiene los botones
            }).catch(async () => {
                // Si no se puede editar, enviar mensaje nuevo
                await bot.sendMessage(chatId, respuesta, { parse_mode: 'HTML' });
            });

            bot.answerCallbackQuery(query.id);

        } catch (error) {
            console.error('[TRADERS] Error en callback trader_detail:', error.message);
            bot.answerCallbackQuery(query.id, { text: '❌ Error al obtener datos del trader.' });
        }
    });

    console.log('✅ [TRADERS] Comandos del bot registrados.');
}

module.exports = { setupTraderCommands };
