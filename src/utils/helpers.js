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

function getPeruTime(date = new Date()) {
    const options = {
        timeZone: 'America/Lima',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    // Format: 10/02/2026, 09:46 p. m. -> Replace comma with hyphen and ensure uppercase AM/PM
    let timeStr = date.toLocaleString('es-PE', options);
    timeStr = timeStr.replace(',', ' -').toUpperCase();

    // Ensure P. M. / A. M. spacing if needed (though locale usually handles it well, Spanish locale uses p. m.)
    // We want "P. M." or "A. M." logic. 
    // The default es-PE might give "p. m." or "a. m."
    // .toUpperCase() makes it "P. M." or "A. M."
    return timeStr;
}

module.exports = {
    getDecimals,
    formatPrice,
    getPeruTime
};
