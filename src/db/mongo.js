const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config');
const { userDatabase } = require('../services/state');

const UserSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    username: String,
    preferences: [String],
    joinedAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

const StickerSchema = new mongoose.Schema({
    fileId: { type: String, required: true, unique: true },
    addedAt: { type: Date, default: Date.now }
});
const Sticker = mongoose.model('Sticker', StickerSchema);

const AudioSchema = new mongoose.Schema({
    fileId: { type: String, required: true, unique: true },
    uniqueId: { type: String },
    hash: { type: String },
    dataBase64: { type: String },
    addedAt: { type: Date, default: Date.now }
});
const Audio = mongoose.model('Audio', AudioSchema);

const BitacoraTradeSchema = new mongoose.Schema({
    mexcId: { type: String, required: true, unique: true },
    symbol: String,
    time: Date,
    direction: String, // LONG / SHORT
    size: Number,
    entryPrice: Number,
    leverage: Number,
    // Condiciones Técnicas Híbridas
    techFavor4h: { type: Boolean, default: false },
    techFavor2h: { type: Boolean, default: false },
    techRsiExtremo: { type: Boolean, default: false },
    techRsiTangente0: { type: Boolean, default: false },
    techDivRsi: { type: Boolean, default: false },
    techDivCipher: { type: Boolean, default: false },
    // Condiciones Psicotrading
    psiRetroceso: { type: Boolean, default: true },
    psiImpulsiva: { type: Boolean, default: false },
    psiPermitio: { type: Boolean, default: true },
    psiTranquilo: { type: Boolean, default: true },
    psiIncertidumbre: { type: Boolean, default: false },
    // Resultados
    resultadoEstado: { type: String, default: 'Sin entrada' }, // TP, SL, Sin entrada
    roi: { type: String, default: '' },
    reflexion: { type: String, default: '' }
});
const BitacoraTrade = mongoose.model('BitacoraTrade', BitacoraTradeSchema);

const TargetGroupSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    name: { type: String, required: true }
});
const TargetGroup = mongoose.model('TargetGroup', TargetGroupSchema);

const YoutubeChannelSchema = new mongoose.Schema({
    channelId: { type: String, required: true, unique: true },
    nombre: { type: String, required: true },
    logoUrl: { type: String, default: '' }
});
const YoutubeChannel = mongoose.model('YoutubeChannel', YoutubeChannelSchema);

// ── Ditox Idea Schema ────────────────────────────────────────────────────────
const DitoxIdeaPhaseSchema = new mongoose.Schema({
    phaseNumber: { type: Number, required: true }, // 1 to 4
    image: { type: String, default: '' }, // Base64 or URL
    description: { type: String, default: '' },
    lastUpdated: { type: Date, default: null }
});

const DitoxIdeaSchema = new mongoose.Schema({
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
    cycleName: { type: String, default: '' },
    direction: { type: String, enum: ['Long', 'Short'], default: 'Long' },
    timeframe: { type: String, default: '4h' },
    phases: [DitoxIdeaPhaseSchema],
    createdAt: { type: Date, default: Date.now },
    archivedAt: { type: Date }
});

const DitoxIdea = mongoose.model('DitoxIdea', DitoxIdeaSchema);

// ── Trader Schema ─────────────────────────────────────────────────────────────
// hits/misses arrancan en 7/3 para que el win-rate base sea del 70%.
// Así si el primer resultado real es un fallo: 7/(7+3+1)=63% (pierde rango A).
// Si acierta: 8/(7+3+1)=72% (mantiene rango A).
const TraderSchema = new mongoose.Schema({
    name:          { type: String, required: true },
    isYoutuber:    { type: Boolean, default: false },
    state:         { type: String, enum: ['durmiendo', 'alcista', 'bajista'], default: 'durmiendo' },
    hits:          { type: Number, default: 7 },
    misses:        { type: Number, default: 3 },
    recentHistory: { type: [String], default: [] }, // emojis ✅ / ❌, máx 5
    mainIdea:      { type: String, default: '' }
}, { timestamps: true });

/** Calcula el win-rate y devuelve el nivel de Aura */
TraderSchema.methods.getAuraLevel = function () {
    const total = this.hits + this.misses;
    if (total === 0) return { winRate: 0, level: 'B' };
    const wr = (this.hits / total) * 100;
    let level;
    if (wr >= 80)      level = 'AAA';
    else if (wr >= 75) level = 'AA';
    else if (wr >= 70) level = 'A';
    else               level = 'B';
    return { winRate: parseFloat(wr.toFixed(1)), level };
};

const Trader = mongoose.model('Trader', TraderSchema);

// Conexión a Base de Datos
function connectDB() {
    if (MONGODB_URI) {
        mongoose.connect(MONGODB_URI)
            .then(() => console.log('✅ Conectado a MongoDB'))
            .catch(err => console.error('❌ Error conectando a MongoDB:', err));
    } else {
        console.warn('⚠️ MONGODB_URI no definido. Se usará almacenamiento en memoria/archivo (si existe).');
    }
}

// Cargar usuarios (MongoDB -> Memoria)
async function loadUsers() {
    // Intentar cargar de MongoDB si hay conexión
    if (mongoose.connection.readyState === 1 || MONGODB_URI) {
        try {
            const users = await User.find({});
            users.forEach(u => {
                userDatabase[u.id] = {
                    id: u.id,
                    username: u.username,
                    preferences: u.preferences
                };
            });
            console.log(`👥 Usuarios cargados desde MongoDB: ${Object.keys(userDatabase).length}`);
        } catch (e) {
            console.error('Error cargando de MongoDB:', e);
        }
    } else {
        console.warn('⚠️ No hay conexión a MongoDB para cargar usuarios cada vez.');
    }
}

// Guardar usuario (Memoria + MongoDB Async)
async function saveUser(chatId, username = 'Usuario') {
    const idStr = String(chatId);
    let changed = false;

    if (!userDatabase[idStr]) {
        userDatabase[idStr] = {
            id: idStr,
            username: username || 'Usuario',
            preferences: []
        };
        changed = true;
    } else if (username && userDatabase[idStr].username !== username && username !== 'Usuario') {
        userDatabase[idStr].username = username;
        changed = true;
    }

    if (changed) {
        // Guardar en Mongo
        if (mongoose.connection.readyState === 1 || MONGODB_URI) {
            saveUserToMongo(userDatabase[idStr]);
        }
    }
}

async function saveUserToMongo(userData) {
    try {
        await User.findOneAndUpdate(
            { id: userData.id },
            userData,
            { upsert: true, new: true }
        );
        console.log(`💾 Usuario guardado en DB: ${userData.id}`);
    } catch (e) {
        console.error('Error guardando en Mongo:', e.message);
    }
}

module.exports = {
    connectDB,
    User,
    loadUsers,
    saveUser,
    saveUserToMongo,
    Sticker,
    Audio,
    BitacoraTrade,
    TargetGroup,
    YoutubeChannel,
    Trader,
    DitoxIdea
};
