// Shared state in memory

let userDatabase = {}; // Cache en memoria para acceso rápido

let estadoAlertas = {};
let history = [];

let terrainAlertsTracker = {
    'LONG': [], // { symbol, timestamp }
    'SHORT': [],
    lastConsolidatedAlert: { 'LONG': 0, 'SHORT': 0 },
    lastGeneralAlertTime: 0 // Cooldown de 12h
};

let waitingForNickname = new Set(); // IDs de usuarios a los que les pedimos apodo

let marketSummary = {
    rocketAngle: -90,
    rocketColor: 'rgb(156, 163, 175)',
    dominantState: 'Calculando...',
    terrainNote: 'Indecisión (No operar)',
    saturation: 0,
    opacity: 0.5,
    fireIntensity: 0
};

let stickyDatabase = [];
let audioDatabase = [];

module.exports = {
    userDatabase,
    estadoAlertas,
    history,
    terrainAlertsTracker,
    waitingForNickname,
    marketSummary,
    stickyDatabase,
    audioDatabase,
    isSystemActive: true // Default state (Active immediately)
};
