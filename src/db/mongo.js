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
    saveUser,
    saveUserToMongo,
    Sticker,
    Audio,
    BitacoraTrade
};
