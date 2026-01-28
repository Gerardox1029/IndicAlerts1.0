function getDecimals(value) {
    if (!value && value !== 0) return 0;
    const s = String(value);
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
}

function formatPrice(value, referenceValue) {
    if (!value && value !== 0) return '0';
    const decimals = getDecimals(referenceValue);
    return parseFloat(value).toFixed(decimals);
}

function getPeruTime() {
    return new Date().toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    }).toUpperCase();
}

module.exports = {
    getDecimals,
    formatPrice,
    getPeruTime
};
