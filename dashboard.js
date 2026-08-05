const ADMIN_PWD = window.ADMIN_PASSWORD || 'awd ';

// --- SOUND EFFECTS (POP ONLY) ---
const audioContext = new (window.AudioContext || window.webkitAudioContext)();

function playPopSound() {
    if (audioContext.state === 'suspended') audioContext.resume();
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, audioContext.currentTime);
    osc.frequency.linearRampToValueAtTime(50, audioContext.currentTime + 0.08);
    gain.gain.setValueAtTime(0.7, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.08);
}

// Attach to all buttons globally
document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
        playPopSound();
    }
});

function openReviewModal(symbol, price, status, emoji, entryType, entryPrice, macroForce) {
    document.getElementById('review-symbol').textContent = symbol;
    document.getElementById('review-price').textContent = price;
    document.getElementById('review-status').textContent = status;
    document.getElementById('review-emoji').textContent = emoji;

    const entryContainer = document.getElementById('review-entry-container');
    const entryText = document.getElementById('review-entry');

    if (entryPrice && entryPrice !== 'undefined' && entryPrice !== '') {
        entryContainer.classList.remove('hidden');
        entryText.textContent = entryType + ': $' + entryPrice;
    } else {
        entryContainer.classList.add('hidden');
        entryText.textContent = '';
    }

    const macroContainer = document.getElementById('review-macro-container');
    const macroTextEl = document.getElementById('review-macro');
    if (macroContainer && macroTextEl) {
        if (macroForce) {
            macroContainer.classList.remove('hidden');
            macroTextEl.textContent = macroForce;
            macroTextEl.className = 'text-lg font-bold ' +
                (macroForce === 'Alcista' ? 'text-green-400 animate-light-waves' :
                    macroForce === 'Bajista' ? 'text-red-400 animate-light-waves' : 'text-gray-400');
        } else {
            macroContainer.classList.add('hidden');
        }
    }

    document.getElementById('modal-review').showModal();
}

async function fetchDashboardData() {
    try {
        const response = await fetch('/api/dashboard-data');
        const data = await response.json();

        // Actualizar Market Summary (Rocket Gauge)
        const sm = data.marketSummary;
        document.getElementById('dominant-state').textContent = sm.dominantState.toUpperCase();
        document.getElementById('dominant-state').style.color = sm.rocketColor;

        const pivot = document.getElementById('rocket-pivot');
        pivot.style.setProperty('--rot-base', sm.rocketAngle + 'deg');
        pivot.style.transform = `translateY(-50%) rotate(${sm.rocketAngle}deg)`;

        const wrapper = document.getElementById('rocket-wrapper');
        wrapper.style.filter = `grayscale(${1 - sm.saturation}) opacity(${sm.opacity})`;

        const container = document.getElementById('rocket-gauge-container');
        container.style.setProperty('--fire-scale', sm.fireIntensity * 1.4);
        container.style.setProperty('--fire-opacity', sm.fireIntensity);

        // Actualizar Cards (simbol)
        document.querySelectorAll('.crypto-card').forEach(card => {
            const symbol = card.getAttribute('data-symbol');
            const key = `${symbol}_2h`;
            const alertState = data.estadoAlertas[key];
            if (alertState) {
                const price = alertState.currentPrice ? '$' + alertState.currentPrice : 'Cargando...';
                const statusEmoji = alertState.currentStateEmoji || '⏳';
                const statusText = alertState.currentStateText || 'Esperando datos...';
                const macroStatus = alertState.macroStatus || '';
                const macroForce = alertState.macroForce || 'NEUTRAL';

                card.setAttribute('data-price', price);
                card.setAttribute('data-status', 'Estado: ' + statusText + ' ' + statusEmoji);
                card.querySelector('p.text-gray-400').textContent = price;
                card.querySelector('.text-3xl').textContent = statusEmoji;
                card.querySelector('.relative.z-10.mb-6 p').textContent = 'Estado: ' + statusText;

                // Macro Status Update
                let macroEl = card.querySelector('.macro-status');
                if (!macroEl) {
                    macroEl = document.createElement('p');
                    macroEl.className = 'macro-status text-xs font-bold mt-1 text-yellow-300';
                    card.querySelector('.relative.z-10.mb-6').appendChild(macroEl);
                }
                macroEl.textContent = macroStatus;
                macroEl.className = 'macro-status text-xs font-bold mt-1 ' +
                    (macroStatus.includes('🚀') ? 'text-green-400' :
                        macroStatus.includes('🔻') ? 'text-red-400' : 'text-yellow-500');

                // Macro Force Update
                let mfEl = card.querySelector('.macro-force');
                if (!mfEl) {
                    mfEl = document.createElement('p');
                    card.querySelector('.relative.z-10.mb-6').appendChild(mfEl);
                }

                let mfClass = 'macro-force text-sm font-bold mt-2 ';
                if (macroForce === 'ALCISTA') mfClass += 'text-green-400 animate-light-waves';
                else if (macroForce === 'BAJISTA') mfClass += 'text-red-400 animate-light-waves';
                else mfClass += 'text-gray-400';

                mfEl.className = mfClass;
                const mfText = macroForce.charAt(0).toUpperCase() + macroForce.slice(1).toLowerCase();
                mfEl.textContent = 'Macro (4h): ' + mfText;
            }
        });

        // Actualizar Historial
        const tbody = document.getElementById('history-table-body');

        // 1. Serialization for comparison
        const currentHistoryJSON = JSON.stringify(data.history);

        // 2. Check focus (Don't update if user is interacting with a dropdown/input in the table)
        const isUserInteracting = tbody.contains(document.activeElement);

        // Only update if data changed AND user is NOT interacting
        // (Or if we implemented smart diffing, but for now this prevents the dropdown closing issue)
        if (currentHistoryJSON !== window.lastHistoryJSON && !isUserInteracting) {
            window.lastHistoryJSON = currentHistoryJSON; // Update cache

            if (data.history.length > 0) {
                tbody.innerHTML = data.history.map(h => {
                    const obs = h.observation ? `<span class="block text-xs text-yellow-400 mt-1">📝 ${h.observation}</span>` : '';

                    const adminControls = `
                        <div class="ditox-admin hidden mt-2">
                            <select id="obs-select-${h.id}" class="bg-gray-700 text-xs text-white p-1 rounded mb-1 w-full">
                                <option value="">Seleccionar Observación...</option>
                                <option value="Señal dudosa" ${h.observation === 'Señal dudosa' ? 'selected' : ''}>Señal dudosa</option>
                                <option value="Señal FALSA" ${h.observation === 'Señal FALSA' ? 'selected' : ''}>Señal FALSA</option>
                                <option value="Liquidaciones a favor de la señal" ${h.observation === 'Liquidaciones a favor de la señal' ? 'selected' : ''}>Liquidaciones a favor</option>
                                <option value="Liquidaciones en contra de la señal" ${h.observation === 'Liquidaciones en contra de la señal' ? 'selected' : ''}>Liquidaciones en contra</option>
                                <option value="Señal aprobada por Ditox" ${h.observation === 'Señal aprobada por Ditox' ? 'selected' : ''}>Señal aprobada por Ditox</option>
                            </select>
                            <button onclick="updateSignal('${h.id}')" class="bg-blue-600 hover:bg-blue-500 text-white text-xs px-2 py-1 rounded w-full">
                                Actualizar Reporte
                            </button>
                        </div>
                   `;

                    return `
                    <tr class="border-b border-gray-700/50 hover:bg-white/5 transition-colors">
                        <td class="py-4 px-6 text-gray-400 font-mono text-xs">${new Date(h.time).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' })}</td>
                        <td class="py-4 px-6 text-gray-400 font-mono text-xs">${new Date(h.time).toLocaleTimeString()}</td>
                        <td class="py-4 px-6 text-blue-300 font-bold">${h.symbol}</td>
                        <td class="py-4 px-6 text-gray-400 text-xs">${h.interval}</td>
                        <td class="py-4 px-6">
                            <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${h.signal === 'LONG' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}">
                                ${h.estadoText}
                            </span>
                            ${obs}
                        </td>
                        <td class="py-4 px-6 text-gray-300 font-mono text-sm">
                            ${h.tangente.toFixed(4)}
                            ${h.tick ? `<div class="text-xs text-yellow-400 mt-1">🎯 $${h.tick}</div>` : ''}
                        </td>
                        <td class="py-4 px-6 text-gray-400 text-xs ditox-column hidden">
                            ${h.observation || 'Ninguna'}
                            ${adminControls}
                        </td>
                    </tr>`;
                }).join('');

                // Re-apply admin visibility if mode is on
                if (localStorage.getItem('ditoxMode') === 'true') {
                    document.querySelectorAll('.ditox-column').forEach(el => el.classList.remove('hidden'));
                    document.querySelectorAll('.ditox-admin').forEach(el => el.classList.remove('hidden'));
                }
            }
        } else if (isUserInteracting && currentHistoryJSON !== window.lastHistoryJSON) {
            console.log("Skipping table update due to user interaction");
        }

        if (localStorage.getItem('ditoxMode') === 'true' && typeof data.isSystemActive !== 'undefined') {
            const statusText = document.getElementById('status-text-switch');
            const btn = document.getElementById('btn-admin-switch');
            const knob = btn ? btn.querySelector('div') : null;

            if (statusText && btn && knob) {
                if (data.isSystemActive) {
                    statusText.innerText = 'ACTIVE';
                    statusText.classList.replace('text-red-400', 'text-green-400');
                    btn.classList.replace('bg-red-600', 'bg-green-600');
                    knob.style.transform = 'translateX(24px)';
                } else {
                    statusText.innerText = 'OFF';
                    statusText.classList.replace('text-green-400', 'text-red-400');
                    btn.classList.replace('bg-green-600', 'bg-red-600');
                    knob.style.transform = 'translateX(0px)';
                }
            }
        }

    } catch (e) {
        console.error("Error fetching data:", e);
    }
}

setInterval(fetchDashboardData, 3000);

// --- DITOX MODE LOGIC ---

// Missing Helper for Prompts
let activePromptCallback = null;

function customPrompt(title, callback, defaultValue = '') {
    const modal = document.getElementById('modal-prompt');
    if (!modal) return alert("Error: Modal prompt not found via ID");

    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-input').value = defaultValue;
    activePromptCallback = callback;
    modal.showModal();
    // Focus after a short delay to ensure visibility
    setTimeout(() => document.getElementById('prompt-input').focus(), 100);
}

function closePrompt() {
    const modal = document.getElementById('modal-prompt');
    if (modal) modal.close();
    activePromptCallback = null;
}

function handlePromptConfirm() {
    const val = document.getElementById('prompt-input').value;
    const callback = activePromptCallback;
    closePrompt();
    if (callback) callback(val);
}

// Reuse the modal for simple alerts (No Input)
function customAlert(title) {
    const modal = document.getElementById('modal-prompt');
    const input = document.getElementById('prompt-input');
    const btnCancel = modal.querySelector('.btn-cancel'); // Assuming class exists or we just rely on closePrompt

    // Hide input for alert mode
    input.classList.add('hidden');
    document.getElementById('prompt-title').textContent = title;

    // Override Confirm Button to just close
    const btnConfirm = modal.querySelector('button.bg-blue-600'); // Assuming selector
    // We define a one-time click handler or just let it call handlePromptConfirm which does nothing if no callback?
    // Let's rely on handlePromptConfirm closing it.
    activePromptCallback = null;

    modal.showModal();

    // Reset input visibility when closed? We need to handle that in closePrompt or re-show it in customPrompt
}
// Patch customPrompt to ensure input is visible
const originalCustomPrompt = customPrompt;
customPrompt = function (title, callback, defaultValue = '') {
    document.getElementById('prompt-input').classList.remove('hidden');
    originalCustomPrompt(title, callback, defaultValue);
}


// --- Ditox Admin Logic & Sections ---

function toggleAdminSwitch() {
    const statusText = document.getElementById('status-text-switch');
    const btn = document.getElementById('btn-admin-switch');
    const knob = btn.querySelector('div');

    const isOff = statusText.innerText === 'OFF';

    if (isOff) {
        // Enciéndelo
        statusText.innerText = 'ACTIVE';
        statusText.classList.replace('text-red-400', 'text-green-400');
        btn.classList.replace('bg-red-600', 'bg-green-600');
        knob.style.transform = 'translateX(24px)';

        // Call API to enable
        fetch('/admin/system-switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ADMIN_PWD, active: true })
        }).catch(console.error);

    } else {
        // Apágalo
        statusText.innerText = 'OFF';
        statusText.classList.replace('text-green-400', 'text-red-400');
        btn.classList.replace('bg-green-600', 'bg-red-600');
        knob.style.transform = 'translateX(0px)';

        // Call API to disable
        fetch('/admin/system-switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: ADMIN_PWD, active: false })
        }).catch(console.error);
    }
}

function showSection(sectionId) {
    // Hide all sections
    ['dashboard', 'history', 'users', 'bitacora', 'broadcast', 'youtube', 'traders'].forEach(s => {
        const el = document.getElementById(`section-${s}`);
        if(el) el.classList.add('hidden');
    });
    // Show target
    const target = document.getElementById(`section-${sectionId}`);
    if(target) target.classList.remove('hidden');

    // Update Nav Buttons
    // (Optional visual feedback for active tab)
}

function sendGeneralBroadcast() {
    customPrompt("Escribe el mensaje GENERAL para todos:", (msg) => {
        if (!msg) return;

        // No password prompt, use soft auth
        const password = ADMIN_PWD;
        fetch('/admin/broadcast-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password, message: msg })
        })
            .then(r => r.json())
            .then(d => {
                if (!d.success) alert("❌ Error: " + d.message);
                // Silent success
            });
    });
}

function toggleDitoxMode() {
    customPrompt("🔑 Contraseña Ditox", async (password) => {
        // Relaxed check: allow password without space or with extra spaces
        if (password && password.trim() === ADMIN_PWD.trim()) {
            console.log("Password correct, enabling Ditox Mode");
            localStorage.setItem('ditoxMode', 'true');
            // User requested NO confirmation message, just enter.
            location.reload();
        } else {
            console.log("Password incorrect:", password);
            alert("❌ Contraseña incorrecta");
        }
    });
}


// On Load Check & Admin Init
// Wrapped in logical check, runs immediately (Script is at end of body)
// { Removed block scope to expose functions globally
console.log("Checking Ditox Mode:", localStorage.getItem('ditoxMode'));
// Immediate fetch to prevent delay in Switch State or Data
fetchDashboardData();

if (localStorage.getItem('ditoxMode') === 'true') {
    // Show Ditox UI Elements
    const nav = document.getElementById('ditox-navbar');
    if (nav) nav.classList.remove('hidden');

    const adminSwitch = document.getElementById('admin-switch-container');
    if (adminSwitch) adminSwitch.classList.remove('hidden');
    
    const apiValidity = document.getElementById('api-validity-container');
    if (apiValidity) apiValidity.classList.remove('hidden');
    if (apiValidity) apiValidity.classList.replace('hidden', 'flex');

    loadBitacoraTrades(); // Load Bitacora data

    // Hide "Soy Ditox" button if visible
    const btnSoyDitox = document.getElementById('btn-soy-ditox');
    if (btnSoyDitox) btnSoyDitox.classList.add('hidden');

    // Add Logout Button
    const headerBtns = document.querySelector('header .flex.items-center.gap-4');
    if (headerBtns && !document.getElementById('btn-logout')) {
        const btnLogout = document.createElement('button');
        btnLogout.id = 'btn-logout';
        btnLogout.textContent = 'Salir (Ditox)';
        btnLogout.className = 'text-sm text-red-500 hover:text-red-400 transition-colors bg-red-900/20 px-3 py-1 rounded border border-red-500/20 ml-2';
        btnLogout.onclick = () => {
            localStorage.removeItem('ditoxMode');
            location.reload();
        };
        headerBtns.appendChild(btnLogout);
    }

    // Load Users
    fetch('/admin/users')
        .then(r => r.json())
        .then(users => {
            const tbody = document.getElementById('user-table-body');
            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="py-8 text-center text-gray-500">No hay usuarios registrados.</td></tr>';
                return;
            }
            tbody.innerHTML = users.map(u => {
                // Generate Elegant Checkboxes
                let checksHtml = '<div class="grid grid-cols-3 lg:grid-cols-4 gap-3 p-3 bg-gray-900/40 rounded-2xl border border-gray-700/30">';
                const symbols = window.FLAT_SYMBOLS || [];

                symbols.forEach(sym => {
                    const isChecked = u.preferences && u.preferences.includes(sym) ? 'checked' : '';
                    const symClean = sym.replace('USDT', '');
                    checksHtml += `
                        <label class="group flex items-center justify-between p-2 rounded-xl border border-transparent hover:border-purple-500/40 hover:bg-purple-900/10 transition-all cursor-pointer">
                            <span class="text-[11px] font-bold text-gray-400 group-hover:text-purple-300 font-mono tracking-tighter">${symClean}</span>
                            <div class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" onchange="toggleUserPref('${u.id}', '${sym}', this.checked)" ${isChecked} class="pref-chk-${u.id} sr-only peer" value="${sym}">
                                <div class="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                            </div>
                        </label>
                    `;
                });
                checksHtml += '</div>';

                return `
                <tr class="border-b border-gray-700/50 hover:bg-white/5 transition-colors">
                    <td class="py-6 px-6 text-gray-500 text-[10px] font-mono">${u.id}</td>
                    <td class="py-6 px-6">
                        <div class="flex items-center gap-3">
                            <div class="w-8 h-8 rounded-full bg-gradient-to-br from-purple-600 to-blue-600 flex items-center justify-center text-xs font-bold shadow-lg">
                                ${u.username ? u.username[0].toUpperCase() : 'A'}
                            </div>
                            <span class="text-white font-bold tracking-tight">${u.username || 'Anónimo'}</span>
                        </div>
                    </td>
                    <td class="py-6 px-6 w-full lg:w-2/3">
                        ${checksHtml}
                    </td>
                    <td class="py-6 px-6">
                        <div class="flex flex-col gap-2 min-w-[120px]">
                            <button onclick="sendPrivateMessage('${u.id}', '${u.username || 'Usuario'}')" 
                                class="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-lg hover:shadow-blue-500/20 active:scale-95">
                                <span>📩</span> Mensaje
                            </button>
                            <div class="grid grid-cols-2 gap-2">
                                <button onclick="simulateUserAlert('${u.id}')" title="Test Alert"
                                    class="bg-gray-800 hover:bg-purple-900/40 text-purple-400 p-2 rounded-lg text-xs transition-colors border border-gray-700 hover:border-purple-500/30 flex items-center justify-center">
                                    🧪
                                </button>
                                <button onclick="deleteUser('${u.id}')" title="Eliminar"
                                    class="bg-gray-800 hover:bg-red-900/40 text-red-500 p-2 rounded-lg text-xs transition-colors border border-gray-700 hover:border-red-500/30 flex items-center justify-center">
                                    🗑️
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
                `;
            }).join('');
        });

    loadGroupsForBroadcast();
    loadYoutubeChannels();
    loadTraders(); // ← Cargar traders al entrar en modo admin
}

function updateSignal(signalId) {
    const select = document.getElementById(`obs-select-${signalId}`);
    const obs = select.value;
    if (!obs) return customAlert("⚠ Selecciona una observación primero");

    const password = ADMIN_PWD; // Soft Auth

    fetch('/admin/update-signal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password, signalId, observationType: obs })
    })
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                customAlert("✅ Señal actualizada correctamente");
                fetchDashboardData();
            } else {
                customAlert("❌ Error: " + d.message);
            }
        });
}

function toggleUserPref(userId, symbol, isChecked) {
    const checkboxes = document.querySelectorAll(`.pref-chk-${userId}:checked`);
    const newPrefs = Array.from(checkboxes).map(c => c.value);

    // Soft auth as requested to improve UX
    const password = ADMIN_PWD;

    fetch('/admin/update-user-prefs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password, userId, preferences: newPrefs })
    })
        .then(r => r.json())
        .then(d => {
            if (!d.success) {
                console.error("Error guardando preferencia");
            } else {
                console.log("Preferencia actualizada:", symbol, isChecked);
            }
        });
}

function sendPrivateMessage(userId, username) {
    customPrompt(`Mensaje para ${username}`, (msg) => {
        if (!msg) return;
        // No password prompt, use soft auth
        const password = ADMIN_PWD;
        fetch('/admin/send-direct-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: password, userId, message: msg })
        })
            .then(r => r.json())
            .then(d => {
                if (!d.success) alert("❌ Error: " + d.message);
                // System message removed as requested
            });
    });
}

function deleteUser(userId) {
    if (!confirm("¿Seguro que deseas eliminar este usuario?")) return;
    // No password prompt, use soft auth
    const password = ADMIN_PWD;
    fetch('/admin/delete-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password, userId })
    })
        .then(r => r.json())
        .then(d => {
            if (d.success) location.reload();
            else alert("❌ Error");
        });
}


// } End of Init Scope (Removed)

function simulateUserAlert(userId) {
    // No password prompt, use soft auth
    const password = ADMIN_PWD;
    fetch('/admin/simulate-user-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password, userId })
    })
        .then(r => r.json())
        .then(d => {
            if (!d.success) alert("❌ Error: " + d.message);
        });
}

// --- BITACORA DITOX LOGIC ---

function calculateConfidence(trade) {
    let score = 0;
    const total = 11; // 6 tech, 5 psi
    
    if (trade.techFavor4h) score++;
    if (trade.techFavor2h) score++;
    if (trade.techRsiExtremo) score++;
    if (trade.techRsiTangente0) score++;
    if (trade.techDivRsi) score++;
    if (trade.techDivCipher) score++;
    
    // Psicotrading logic: NO adds for impulsiva/incertidumbre
    if (trade.psiRetroceso) score++;
    if (!trade.psiImpulsiva) score++; // NO = positive
    if (trade.psiPermitio) score++;
    if (trade.psiTranquilo) score++;
    if (!trade.psiIncertidumbre) score++; // NO = positive
    
    return Math.round((score / total) * 100);
}

async function loadBitacoraTrades() {
    try {
        const response = await fetch('/api/bitacora');
        const trades = await response.json();
        renderBitacora(trades);
    } catch (e) {
        console.error("Error loading bitacora:", e);
    }
}

function renderBitacora(trades) {
    const tbody = document.getElementById('bitacora-table-body');
    if (trades.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="py-8 text-center text-gray-500">No hay operaciones registradas.</td></tr>';
        return;
    }
    
    tbody.innerHTML = trades.map(t => {
        const conf = calculateConfidence(t);
        const confColor = conf === 100 ? 'text-green-400 font-black drop-shadow-[0_0_8px_rgba(74,222,128,0.8)]' : conf >= 70 ? 'text-blue-400' : conf >= 50 ? 'text-yellow-400' : 'text-red-400';
        
        const toggle = (field, label, inverted = false) => `
            <label class="flex items-center justify-between text-[10px] bg-gray-800/50 p-1.5 rounded-lg border border-gray-700/50 hover:border-purple-500/30 transition-colors cursor-pointer mb-1">
                <span class="text-gray-300 w-32 truncate">${label}</span>
                <div class="relative inline-flex items-center">
                    <input type="checkbox" onchange="updateBitacoraTrade('${t._id}', '${field}', this.checked)" ${t[field] ? 'checked' : ''} class="sr-only peer">
                    <div class="w-6 h-3 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-[12px] peer-checked:after:border-white after:content-[''] after:absolute after:top-[1px] after:left-[1px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-2.5 after:w-2.5 after:transition-all ${inverted ? 'peer-checked:bg-red-500' : 'peer-checked:bg-green-500'}"></div>
                </div>
            </label>
        `;

        return `
        <tr class="border-b border-gray-700/50 hover:bg-gray-800/20 transition-colors">
            <td class="py-4 px-4">
                <div class="font-bold text-blue-300">${t.symbol}</div>
                <div class="text-[10px] text-gray-500 font-mono">${new Date(t.time).toLocaleString()}</div>
            </td>
            <td class="py-4 px-4">
                <div class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${t.direction === 'LONG' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}">
                    ${t.direction}
                </div>
                <div class="text-[10px] text-gray-300 mt-1">Entrada: $${t.entryPrice || 0}</div>
                <div class="text-xs text-gray-400 mt-1">Vol: ${t.size}</div>
                <div class="text-[10px] text-gray-500">Lev: ${t.leverage}x</div>
            </td>
            <td class="py-4 px-4 bg-blue-900/5 border-x border-gray-700/30">
                <div class="grid gap-1">
                    ${toggle('techFavor4h', 'A favor 4h')}
                    ${toggle('techFavor2h', 'A favor 2h')}
                    ${toggle('techRsiExtremo', 'RSI Extremo (>60/<40)')}
                    ${toggle('techRsiTangente0', 'Tangente 0')}
                    ${toggle('techDivRsi', 'Div. RSI')}
                    ${toggle('techDivCipher', 'Div. Cipher+MFI')}
                </div>
            </td>
            <td class="py-4 px-4 bg-purple-900/5 border-r border-gray-700/30">
                <div class="grid gap-1">
                    ${toggle('psiRetroceso', 'Esperó retroceso')}
                    ${toggle('psiImpulsiva', 'Entrada impulsiva', true)}
                    ${toggle('psiPermitio', 'Mercado permitió')}
                    ${toggle('psiTranquilo', 'Ánimo tranquilo')}
                    ${toggle('psiIncertidumbre', 'Incertidumbre fund.', true)}
                </div>
            </td>
            <td class="py-4 px-4">
                <select onchange="updateBitacoraTrade('${t._id}', 'resultadoEstado', this.value)" class="w-full bg-gray-800 text-[10px] text-white p-1.5 rounded mb-2 border border-gray-700">
                    <option value="Sin entrada" ${t.resultadoEstado === 'Sin entrada' ? 'selected' : ''}>Sin entrada</option>
                    <option value="TP" ${t.resultadoEstado === 'TP' ? 'selected' : ''}>TP ✅</option>
                    <option value="SL" ${t.resultadoEstado === 'SL' ? 'selected' : ''}>SL ❌</option>
                </select>
                <input type="text" placeholder="ROI %" value="${t.roi || ''}" onblur="updateBitacoraTrade('${t._id}', 'roi', this.value)" class="w-full bg-gray-800 text-[10px] text-white p-1.5 rounded mb-2 border border-gray-700 text-center">
                <textarea placeholder="Reflexión..." onblur="updateBitacoraTrade('${t._id}', 'reflexion', this.value)" class="w-full bg-gray-800 text-[10px] text-gray-300 p-1.5 rounded border border-gray-700 h-24 resize-y">${t.reflexion || ''}</textarea>
            </td>
            <td class="py-4 px-4 text-center">
                <div class="text-3xl ${confColor}">${conf}%</div>
                <div class="text-[9px] text-gray-500 uppercase mt-1">Confianza</div>
            </td>
        </tr>
        `;
    }).join('');
}

async function syncMexcTrades() {
    const btn = document.getElementById('btn-sync-mexc');
    const icon = document.getElementById('sync-icon');
    if (icon) icon.classList.add('animate-spin');
    if (btn) btn.disabled = true;
    
    try {
        const res = await fetch('/api/bitacora/sync', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            customAlert(`✅ Sincronización exitosa. ${data.count} operaciones nuevas.`);
            loadBitacoraTrades();
        } else {
            customAlert(`❌ Error: ${data.message}`);
        }
    } catch (e) {
        customAlert("❌ Error de conexión al sincronizar.");
    } finally {
        if (icon) icon.classList.remove('animate-spin');
        if (btn) btn.disabled = false;
    }
}

function openTipModal(src) {
    const modal = document.getElementById('modal-tip');
    const img = document.getElementById('modal-tip-img');
    img.src = src;
    modal.showModal();
    // Fade in
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        img.classList.remove('scale-95');
        img.classList.add('scale-100');
    }, 10);
    createParticles();
}

function closeTipModal() {
    const modal = document.getElementById('modal-tip');
    const img = document.getElementById('modal-tip-img');
    modal.classList.add('opacity-0');
    img.classList.remove('scale-100');
    img.classList.add('scale-95');
    setTimeout(() => {
        modal.close();
        document.getElementById('particles-container').innerHTML = ''; // clear particles
    }, 500);
}

function createParticles() {
    const container = document.getElementById('particles-container');
    container.innerHTML = '';
    for(let i=0; i<30; i++) {
        const p = document.createElement('div');
        p.className = 'particle shadow-[0_0_10px_white]';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.width = Math.random() * 4 + 2 + 'px';
        p.style.height = p.style.width;
        p.style.animationDuration = Math.random() * 3 + 2 + 's';
        p.style.animationDelay = Math.random() * 2 + 's';
        container.appendChild(p);
    }
}

async function updateBitacoraTrade(tradeId, field, value) {
    try {
        await fetch('/api/bitacora/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradeId, updates: { [field]: value } })
        });
        loadBitacoraTrades(); 
    } catch (e) {
        console.error("Error updating trade", e);
    }
}

// --- BROADCAST GROUPS LOGIC ---
function loadGroupsForBroadcast() {
    fetch('/admin/groups')
        .then(r => r.json())
        .then(groups => {
            const container = document.getElementById('groups-list-container');
            if (groups.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No hay grupos configurados.</p>';
                return;
            }
            container.innerHTML = groups.map(g => `
                <div class="flex items-center justify-between p-3 rounded-xl border border-gray-700/50 hover:border-purple-500/40 hover:bg-purple-900/10 transition-all">
                    <label class="flex-grow flex items-center gap-2 cursor-pointer">
                        <div class="relative inline-flex items-center">
                            <input type="checkbox" class="broadcast-group-chk sr-only peer" value="${g.groupId}">
                            <div class="w-8 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-purple-600"></div>
                        </div>
                        <span class="text-sm font-bold text-gray-300 ml-2">${g.name}</span>
                    </label>
                    <div class="flex gap-2">
                        <button onclick="editGroup('${g.id}', '${g.groupId}', '${g.name}')" class="text-xs text-blue-400 hover:text-blue-300 p-1">✏️</button>
                        <button onclick="deleteGroup('${g.id}')" class="text-xs text-red-400 hover:text-red-300 p-1">🗑️</button>
                    </div>
                </div>
            `).join('');
        });
}

function addGroup() {
    customPrompt("ID del Grupo (@nombre o -100xxx):", (groupId) => {
        if (!groupId) return;
        customPrompt("Nombre del Grupo:", (name) => {
            if (!name) return;
            fetch('/admin/groups', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: ADMIN_PWD, groupId, name })
            }).then(r=>r.json()).then(d=>{
                if(d.success) loadGroupsForBroadcast();
                else alert("Error: " + d.message);
            });
        });
    });
}

function editGroup(id, oldGroupId, oldName) {
    customPrompt("Nuevo ID del Grupo ("+oldGroupId+"):", (groupId) => {
        if (!groupId) groupId = oldGroupId;
        customPrompt("Nuevo Nombre del Grupo ("+oldName+"):", (name) => {
            if (!name) name = oldName;
            fetch('/admin/groups/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: ADMIN_PWD, groupId, name })
            }).then(r=>r.json()).then(d=>{
                if(d.success) loadGroupsForBroadcast();
                else alert("Error: " + d.message);
            });
        });
    });
}

function deleteGroup(id) {
    if(!confirm("¿Eliminar grupo?")) return;
    fetch('/admin/groups/' + id, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PWD })
    }).then(r=>r.json()).then(d=>{
        if(d.success) loadGroupsForBroadcast();
        else alert("Error: " + d.message);
    });
}

function toggleAllGroups() {
    const checkboxes = document.querySelectorAll('.broadcast-group-chk');
    const anyUnchecked = Array.from(checkboxes).some(c => !c.checked);
    checkboxes.forEach(c => c.checked = anyUnchecked);
}

function sendGroupBroadcast() {
    const message = document.getElementById('broadcast-message-text').value;
    const imgPreviewSrc = document.getElementById('broadcast-image-preview').src;
    const checkboxes = document.querySelectorAll('.broadcast-group-chk:checked');
    const selectedGroups = Array.from(checkboxes).map(c => c.value);

    if (selectedGroups.length === 0) {
        return alert("❌ Debes seleccionar al menos un grupo.");
    }
    if (!message.trim() && (!imgPreviewSrc || imgPreviewSrc.endsWith(location.pathname))) {
        return alert("❌ Debes escribir un mensaje o seleccionar una imagen.");
    }

    const btn = document.getElementById('btn-send-broadcast-groups');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span>⏳</span> Enviando...';
    btn.disabled = true;

    const imageBase64 = imgPreviewSrc.startsWith('data:image') ? imgPreviewSrc : null;

    fetch('/admin/broadcast-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            password: ADMIN_PWD,
            message: message,
            imageBase64: imageBase64,
            selectedGroups: selectedGroups
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            const failures = data.results ? data.results.filter(r => !r.success) : [];
            if (failures.length > 0) {
                const errorMsgs = failures.map(f => `- Grupo/Canal ${f.group}: ${f.error}`).join('\n');
                alert(`⚠️ Algunos mensajes no se enviaron:\n\n${errorMsgs}`);
            } else {
                alert(`✅ Mensaje enviado con éxito a ${selectedGroups.length} grupos.`);
            }
            document.getElementById('broadcast-message-text').value = '';
            const previewContainer = document.getElementById('image-preview-container');
            const previewImg = document.getElementById('broadcast-image-preview');
            const fileInput = document.getElementById('broadcast-image');
            
            previewImg.src = '';
            previewContainer.classList.add('hidden');
            if (fileInput) fileInput.value = '';
            checkboxes.forEach(c => c.checked = false);
        } else {
            alert("❌ Error al enviar: " + data.message);
        }
    })
    .catch(err => {
        alert("❌ Error de red: " + err.message);
    })
    .finally(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
    });
}

// --- PASTE (CTRL+V) LOGIC ---
window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    for (const item of items) {
        if (item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = function(evt) {
                const previewContainer = document.getElementById('image-preview-container');
                const previewImg = document.getElementById('broadcast-image-preview');
                const fileInput = document.getElementById('broadcast-image');
                
                if (previewImg && previewContainer) {
                    previewImg.src = evt.target.result;
                    previewContainer.classList.remove('hidden');
                    // Clear file input if it had something
                    if (fileInput) fileInput.value = '';
                    
                    // Visual feedback
                    console.log("Imagen pegada desde el portapapeles");
                }
            };
            reader.readAsDataURL(blob);
        }
    }
});

const broadcastFileInput = document.getElementById('broadcast-image');
if (broadcastFileInput) {
    broadcastFileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        const previewContainer = document.getElementById('image-preview-container');
        const previewImg = document.getElementById('broadcast-image-preview');
        if (file) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                previewImg.src = evt.target.result;
                previewContainer.classList.remove('hidden');
            }
            reader.readAsDataURL(file);
        } else {
            previewImg.src = '';
            previewContainer.classList.add('hidden');
        }
    });
}

// --- YOUTUBE CHANNELS LOGIC ---
function loadYoutubeChannels() {
    fetch('/admin/youtube-channels')
        .then(r => r.json())
        .then(channels => {
            const container = document.getElementById('youtube-list-container');
            if (!container) return;
            if (channels.length === 0) {
                container.innerHTML = '<p class="text-gray-500 text-sm text-center py-4">No hay canales configurados.</p>';
                return;
            }
            container.innerHTML = channels.map(c => `
                <div class="flex items-center justify-between p-3 rounded-xl border border-gray-700/50 hover:border-red-500/40 hover:bg-red-900/10 transition-all">
                    <div class="flex items-center gap-3">
                        <img src="${c.logoUrl || 'https://via.placeholder.com/40'}" alt="logo" class="w-10 h-10 rounded-full border border-gray-600">
                        <div>
                            <span class="text-sm font-bold text-gray-300 block">${c.nombre}</span>
                            <span class="text-xs text-gray-500">${c.channelId}</span>
                        </div>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="editYoutubeChannel('${c.id}', '${c.channelId}', '${c.nombre}')" class="text-xs text-blue-400 hover:text-blue-300 p-1">✏️</button>
                        <button onclick="deleteYoutubeChannel('${c.id}')" class="text-xs text-red-400 hover:text-red-300 p-1">🗑️</button>
                    </div>
                </div>
            `).join('');
        });
}

function addYoutubeChannel() {
    customPrompt("ID del Canal de YouTube (Ej. UChYI1ptK3fy06LzLnwsm8pA):", (channelId) => {
        if (!channelId) return;
        customPrompt("Nombre del Canal:", (nombre) => {
            if (!nombre) return;
            fetch('/admin/youtube-channels', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: ADMIN_PWD, channelId, nombre })
            }).then(r=>r.json()).then(d=>{
                if(d.success) loadYoutubeChannels();
                else alert("Error: " + d.message);
            });
        });
    });
}

function editYoutubeChannel(id, oldChannelId, oldNombre) {
    customPrompt("Nuevo ID del Canal ("+oldChannelId+"):", (channelId) => {
        if (!channelId) channelId = oldChannelId;
        customPrompt("Nuevo Nombre del Canal ("+oldNombre+"):", (nombre) => {
            if (!nombre) nombre = oldNombre;
            fetch('/admin/youtube-channels/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: ADMIN_PWD, channelId, nombre })
            }).then(r=>r.json()).then(d=>{
                if(d.success) loadYoutubeChannels();
                else alert("Error: " + d.message);
            });
        });
    });
}

function deleteYoutubeChannel(id) {
    if(!confirm("¿Eliminar canal de YouTube?")) return;
    fetch('/admin/youtube-channels/' + id, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: ADMIN_PWD })
    }).then(r=>r.json()).then(d=>{
        if(d.success) loadYoutubeChannels();
        else alert("Error: " + d.message);
    });
}

// --- CAROUSEL LOGIC ---
const carouselQuotes = [
    { text: "El mercado es un dispositivo para transferir dinero del impaciente al paciente.", author: "Warren Buffett" },
    { text: "No tienes que ser un experto para ganar dinero, pero tienes que controlar tus emociones.", author: "Mark Douglas" },
    { text: "Tu objetivo como trader no es tener siempre la razón, sino hacer dinero cuando la tienes y perder poco cuando te equivocas.", author: "George Soros" },
    { text: "Un plan de trading es inútil si no tienes la disciplina para seguirlo.", author: "Jesse Livermore" },
    { text: "Los mercados pueden mantener su irracionalidad más tiempo del que tú puedes mantener tu solvencia.", author: "John Maynard Keynes" },
    { text: "Corta tus pérdidas rápido, deja correr tus ganancias.", author: "Proverbio de Wall Street" }
];

let currentSlide = 0;
const totalSlides = 6;
let carouselInterval;

function initCarousel() {
    const dotsContainer = document.getElementById('carousel-dots');
    if (!dotsContainer) return;

    // Create dots
    dotsContainer.innerHTML = Array.from({length: totalSlides}).map((_, i) => 
        `<button onclick="goToSlide(${i})" class="carousel-dot w-3 h-3 rounded-full transition-all duration-300 ${i === 0 ? 'bg-blue-500 w-8 shadow-[0_0_10px_rgba(59,130,246,0.6)]' : 'bg-gray-600 hover:bg-gray-400'}"></button>`
    ).join('');

    updateQuote();
    startCarouselAutoPlay();

    // Pause on hover
    const viewport = document.getElementById('carousel-viewport');
    if (viewport) {
        viewport.addEventListener('mouseenter', () => clearInterval(carouselInterval));
        viewport.addEventListener('mouseleave', startCarouselAutoPlay);
    }
}

function updateCarouselUI() {
    const track = document.getElementById('carousel-track');
    if (!track) return;
    track.style.transform = `translateX(-${currentSlide * 100}%)`;

    // Update dots
    document.querySelectorAll('.carousel-dot').forEach((dot, index) => {
        if (index === currentSlide) {
            dot.className = 'carousel-dot w-8 h-3 rounded-full transition-all duration-300 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]';
        } else {
            dot.className = 'carousel-dot w-3 h-3 rounded-full transition-all duration-300 bg-gray-600 hover:bg-gray-400 shadow-none';
        }
    });

    updateQuote();
}

function updateQuote() {
    const quoteEl = document.getElementById('carousel-quote');
    const authorEl = document.getElementById('carousel-author');
    if (!quoteEl || !authorEl) return;

    // Fade out
    quoteEl.style.opacity = '0';
    authorEl.style.opacity = '0';

    setTimeout(() => {
        quoteEl.textContent = `"${carouselQuotes[currentSlide].text}"`;
        authorEl.textContent = `- ${carouselQuotes[currentSlide].author}`;
        // Fade in
        quoteEl.style.opacity = '1';
        authorEl.style.opacity = '1';
    }, 300);
}

function moveCarousel(dir) {
    currentSlide = (currentSlide + dir + totalSlides) % totalSlides;
    updateCarouselUI();
}

function goToSlide(index) {
    currentSlide = index;
    updateCarouselUI();
}

function startCarouselAutoPlay() {
    clearInterval(carouselInterval);
    carouselInterval = setInterval(() => {
        moveCarousel(1);
    }, 5000); // 5 seconds per slide
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initCarousel);

// =====================================================================
// --- TRADERS MODULE ---
// =====================================================================

const TRADER_PASSWORD = ADMIN_PWD;

/** Aura level badges con colores y etiquetas */
const AURA_STYLES = {
    'AAA': { bg: 'bg-emerald-900/40', border: 'border-emerald-500/60', text: 'text-emerald-400', glow: 'shadow-[0_0_15px_rgba(52,211,153,0.25)]', badge: 'bg-emerald-500' },
    'AA':  { bg: 'bg-blue-900/40',    border: 'border-blue-500/60',    text: 'text-blue-400',    glow: 'shadow-[0_0_12px_rgba(96,165,250,0.2)]',  badge: 'bg-blue-500' },
    'A':   { bg: 'bg-amber-900/40',   border: 'border-amber-500/60',   text: 'text-amber-400',   glow: 'shadow-[0_0_10px_rgba(251,191,36,0.2)]',  badge: 'bg-amber-500' },
    'B':   { bg: 'bg-gray-800/40',    border: 'border-gray-600/40',    text: 'text-gray-400',    glow: '',                                         badge: 'bg-gray-500' }
};

function stateDisplay(state) {
    if (state === 'alcista')  return { emoji: '🟢', label: 'Alcista',  cls: 'bg-emerald-900/50 text-emerald-400 border-emerald-500/30' };
    if (state === 'bajista')  return { emoji: '🔴', label: 'Bajista',  cls: 'bg-red-900/50 text-red-400 border-red-500/30' };
    return { emoji: '⚪', label: 'Durmiendo', cls: 'bg-gray-800/50 text-gray-400 border-gray-600/30' };
}

function renderTraderCard(t) {
    const aura  = AURA_STYLES[t.auraLevel] || AURA_STYLES['B'];
    const st    = stateDisplay(t.state);
    const hist  = (t.recentHistory && t.recentHistory.length > 0) ? t.recentHistory.join('') : '—';
    const total = t.hits + t.misses;

    return `
    <div id="trader-card-${t.id}" class="group relative rounded-2xl p-5 border ${aura.border} ${aura.bg} ${aura.glow} transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl flex flex-col gap-3">
        <!-- Header -->
        <div class="flex items-start justify-between">
            <div>
                <span class="inline-block ${aura.badge} text-white text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-widest mb-1">
                    Aura ${t.auraLevel}
                </span>
                <h3 class="text-lg font-bold text-white leading-tight">${t.name}</h3>
            </div>
            <button onclick="deleteTrader('${t.id}')" title="Eliminar" class="text-gray-600 hover:text-red-400 transition-colors text-sm opacity-0 group-hover:opacity-100">🗑️</button>
        </div>

        <!-- Win Rate / Stats -->
        <div class="flex items-center gap-3">
            <div class="text-3xl font-black ${aura.text}">${t.winRate}%</div>
            <div class="text-xs text-gray-500 leading-tight">
                <div>✅ <span class="text-gray-300">${t.hits}</span> aciertos</div>
                <div>❌ <span class="text-gray-300">${t.misses}</span> fallos</div>
                <div class="text-gray-600">${total} totales</div>
            </div>
        </div>

        <!-- Win Rate Bar -->
        <div class="w-full bg-gray-700/50 rounded-full h-1.5 overflow-hidden">
            <div class="${aura.badge} h-1.5 rounded-full transition-all duration-700" style="width:${Math.min(t.winRate, 100)}%"></div>
        </div>

        <!-- Estado -->
        <div class="flex items-center gap-2">
            <span class="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full border ${st.cls}">
                ${st.emoji} ${st.label}
            </span>
        </div>

        <!-- Historial Reciente -->
        <div class="text-xs text-gray-500">
            <span class="font-bold text-gray-400">🔥 Historial:</span>
            <span class="ml-1 tracking-wider text-base">${hist}</span>
        </div>

        <!-- Idea Principal -->
        <div class="text-xs text-gray-400 bg-gray-800/50 p-2 rounded-lg relative group/idea">
            <div class="flex justify-between items-center mb-1">
                <span class="font-bold text-gray-300">💡 Idea Principal:</span>
                <button onclick="editTraderIdea('${t.id}', '${(t.mainIdea || '').replace(/'/g, "\\'")}')" class="text-blue-400 hover:text-blue-300 text-[10px] opacity-0 group-hover/idea:opacity-100 transition-opacity flex items-center gap-1">
                    ✏️ Editar
                </button>
            </div>
            <div class="italic break-words ${!t.mainIdea ? 'text-gray-600' : ''}">
                ${t.mainIdea || 'Sin idea registrada.'}
            </div>
        </div>

        <!-- Controles de Estado -->
        <div class="flex gap-2 mt-1">
            <button onclick="setTraderState('${t.id}', 'alcista')" 
                class="flex-1 bg-emerald-900/40 hover:bg-emerald-600/60 border border-emerald-700/40 hover:border-emerald-500 text-emerald-400 hover:text-white text-xs font-bold py-2 rounded-xl transition-all active:scale-95">
                🟢 Alcista
            </button>
            <button onclick="setTraderState('${t.id}', 'bajista')" 
                class="flex-1 bg-red-900/40 hover:bg-red-600/60 border border-red-700/40 hover:border-red-500 text-red-400 hover:text-white text-xs font-bold py-2 rounded-xl transition-all active:scale-95">
                🔴 Bajista
            </button>
        </div>

        <!-- Botones Resolver -->
        <div class="flex gap-2">
            <button onclick="resolveTrader('${t.id}', 'hit')" title="Acierto"
                class="flex-1 bg-gray-800 hover:bg-emerald-900/50 border border-gray-700 hover:border-emerald-500/50 text-lg py-2 rounded-xl transition-all active:scale-95 font-black text-emerald-400">
                +
            </button>
            <button onclick="resolveTrader('${t.id}', 'miss')" title="Desacierto"
                class="flex-1 bg-gray-800 hover:bg-red-900/50 border border-gray-700 hover:border-red-500/50 text-lg py-2 rounded-xl transition-all active:scale-95 font-black text-red-400">
                −
            </button>
        </div>
    </div>`;
}

async function loadTraders() {
    try {
        const res  = await fetch('/admin/traders');
        const data = await res.json();
        const grid = document.getElementById('traders-grid');
        if (!grid) return;

        if (!Array.isArray(data) || data.length === 0) {
            grid.innerHTML = '<p class="text-gray-500 text-sm text-center py-8 col-span-full">No hay traders registrados. Haz clic en "Agregar Trader" para comenzar.</p>';
            return;
        }
        grid.innerHTML = data.map(renderTraderCard).join('');
    } catch (e) {
        console.error('Error cargando traders:', e);
    }
}

function addTrader() {
    customPrompt('🧠 Nombre del Trader (ej: R.Linda, CryptoBruja):', (name) => {
        if (!name || !name.trim()) return;
        fetch('/admin/traders', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: TRADER_PASSWORD, name: name.trim() })
        })
        .then(r => r.json())
        .then(d => {
            if (d.success) {
                loadTraders();
            } else {
                alert('❌ Error: ' + d.message);
            }
        })
        .catch(e => alert('❌ Error de red: ' + e.message));
    });
}

function setTraderState(id, state) {
    fetch(`/admin/traders/${id}/state`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: TRADER_PASSWORD, state })
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            loadTraders();
        } else {
            alert('❌ Error: ' + d.message);
        }
    })
    .catch(e => console.error('Error cambiando estado:', e));
}

function editTraderIdea(id, currentIdea) {
    customPrompt('💡 Escribe la idea principal (vacío para borrar):', (newIdea) => {
        fetch(`/admin/traders/${id}/idea`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: TRADER_PASSWORD, mainIdea: newIdea.trim() })
        })
        .then(r => r.json())
        .then(d => {
            if (d.success) loadTraders();
            else alert('Error: ' + d.message);
        })
        .catch(e => console.error('Error actualizando idea:', e));
    }, currentIdea);
}

function resolveTrader(id, result) {
    // result: 'hit' | 'miss'
    fetch(`/admin/traders/${id}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: TRADER_PASSWORD, result })
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) {
            loadTraders();
        } else {
            alert('❌ Error: ' + d.message);
        }
    })
    .catch(e => console.error('Error resolviendo trader:', e));
}

function deleteTrader(id) {
    if (!confirm('¿Eliminar este trader? Esta acción no se puede deshacer.')) return;
    fetch(`/admin/traders/${id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: TRADER_PASSWORD })
    })
    .then(r => r.json())
    .then(d => {
        if (d.success) loadTraders();
        else alert('❌ Error: ' + d.message);
    })
    .catch(e => console.error('Error eliminando trader:', e));
}

// ==========================================
// IDEAS DITOX LOGIC
// ==========================================

let currentIdeaData = null;
let currentPhaseView = 1;
let lastIdeaJSON = '';

async function loadDitoxIdea(forceRender = false) {
    try {
        const res = await fetch('/api/ideas/active');
        const data = await res.json();
        
        const adminMode = localStorage.getItem('ditoxMode') === 'true';
        
        // Ensure all admin controls are correctly shown/hidden based on ditoxMode
        document.querySelectorAll('.ditox-admin').forEach(el => {
            if (adminMode) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        });

        const ideaJSON = JSON.stringify(data);
        const dataChanged = ideaJSON !== lastIdeaJSON;
        lastIdeaJSON = ideaJSON;
        
        if (data.empty || !data.phases) {
            currentIdeaData = null;
            document.getElementById('idea-empty').classList.remove('hidden');
            document.getElementById('idea-active').classList.add('hidden');
            document.getElementById('idea-indicators').classList.add('hidden');
        } else {
            currentIdeaData = data;
            document.getElementById('idea-empty').classList.add('hidden');
            document.getElementById('idea-active').classList.remove('hidden');
            document.getElementById('idea-indicators').classList.remove('hidden');
            
            // Update Indicators
            document.getElementById('idea-dir').textContent = data.direction;
            document.getElementById('idea-dir').className = data.direction === 'Long' ? 'text-2xl font-black text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]' : 'text-2xl font-black text-red-400 drop-shadow-[0_0_10px_rgba(248,113,113,0.5)]';
            document.getElementById('idea-tf').textContent = data.timeframe;
            
            const dirSelect = document.getElementById('edit-idea-dir');
            const tfSelect = document.getElementById('edit-idea-tf');
            if (adminMode && document.activeElement !== dirSelect && document.activeElement !== tfSelect) {
                if (dirSelect) dirSelect.value = data.direction || 'Long';
                if (tfSelect) tfSelect.value = data.timeframe || '4h';
            }

            // Update Spheres
            data.phases.forEach(p => {
                const sphere = document.getElementById(`sphere-${p.phaseNumber}`);
                if (!sphere) return;
                
                // Opacity logic: public sees Phase 1 always, and others only if updated. Admin sees all 4 spheres active.
                if (!adminMode && !p.lastUpdated && p.phaseNumber > 1) {
                    sphere.classList.add('opacity-30');
                    sphere.style.pointerEvents = 'none';
                } else {
                    sphere.classList.remove('opacity-30');
                    sphere.style.pointerEvents = 'auto';
                }
            });
            
            // Check if admin is currently typing or has pasted an image
            const descInput = document.getElementById('edit-phase-desc');
            const pasteArea = document.getElementById('paste-area');
            const isUserEditing = adminMode && (
                document.activeElement === descInput ||
                document.activeElement === pasteArea ||
                Boolean(window.pendingPhaseImage)
            );

            // Re-render phase UI only if forced (e.g. manual click/save) or if data changed AND user is not editing
            if (forceRender || (dataChanged && !isUserEditing)) {
                showPhase(currentPhaseView, forceRender);
            }
        }
        
        // Load History
        const histRes = await fetch('/api/ideas/history');
        const histData = await histRes.json();
        if (histData && histData.length > 0) {
            document.getElementById('ideas-history-section').classList.remove('hidden');
            const tbody = document.getElementById('ideas-history-body');
            if (tbody) {
                tbody.innerHTML = histData.map(h => `
                    <tr class="border-b border-gray-700/50 hover:bg-white/5 transition-colors">
                        <td class="py-3 px-4 text-xs font-mono text-gray-400">${new Date(h.archivedAt).toLocaleDateString()}</td>
                        <td class="py-3 px-4 font-bold text-blue-300">${h.cycleName}</td>
                        <td class="py-3 px-4 text-xs font-bold ${h.direction === 'Long' ? 'text-green-400' : 'text-red-400'}">${h.direction}</td>
                        <td class="py-3 px-4 text-sm text-gray-300">${(h.phases && h.phases[h.phases.length-1] && h.phases[h.phases.length-1].description) ? h.phases[h.phases.length-1].description : 'Sin descripción'}</td>
                    </tr>
                `).join('');
            }
        }
        
    } catch(e) { console.error("Error loading ideas:", e); }
}

function showPhase(num, animate = true) {
    currentPhaseView = num;
    if (!currentIdeaData || !currentIdeaData.phases) return;
    
    // Highlight selected sphere
    for(let i=1; i<=4; i++) {
        const sp = document.getElementById(`sphere-${i}`);
        if (sp) {
            if(i === num) sp.classList.add('scale-110', 'brightness-125', 'ring-4', 'ring-blue-500/50');
            else sp.classList.remove('scale-110', 'brightness-125', 'ring-4', 'ring-blue-500/50');
        }
    }
    
    const phase = currentIdeaData.phases.find(p => p.phaseNumber === num);
    if (!phase) return;
    
    const adminMode = localStorage.getItem('ditoxMode') === 'true';
    
    const imgEl = document.getElementById('phase-image');
    const descEl = document.getElementById('phase-desc');
    const timeEl = document.getElementById('phase-last-updated');
    const container = document.getElementById('phase-content-container');
    
    const updateDOM = () => {
        if (phase.image) {
            imgEl.src = phase.image;
            imgEl.classList.remove('hidden');
        } else {
            imgEl.classList.add('hidden');
        }

        if (phase.description) {
            descEl.innerHTML = phase.description.replace(/\n/g, '<br>');
        } else {
            descEl.innerHTML = '<span class="text-gray-500 italic">No hay información cargada para esta fase.</span>';
        }
        
        if (phase.lastUpdated) {
            timeEl.textContent = 'Última Actualización: ' + new Date(phase.lastUpdated).toLocaleString();
        } else {
            timeEl.textContent = 'Fase sin actualizar';
        }
        
        if (adminMode) {
            const descInput = document.getElementById('edit-phase-desc');
            descInput.value = phase.description || '';
            
            // Adjust placeholder for phase 4 to clarify that it edits the loader text
            if (num === 4) {
                descInput.placeholder = "Texto de carga (Ej: Generando, Calculando...)";
            } else {
                descInput.placeholder = "Descripción de la fase (soporta HTML básico: <b>negritas</b>, <i>cursivas</i> y emojis)";
            }
            
            const pasteArea = document.getElementById('paste-area');
            if (pasteArea) {
                pasteArea.innerHTML = phase.image 
                    ? '<span class="text-green-400 font-bold">✅ Imagen actual cargada. Presiona Ctrl+V para reemplazar.</span>' 
                    : '<span class="text-lg text-gray-400">Haz clic aquí y presiona <b>Ctrl + V</b> para pegar la captura</span>';
            }
            window.pendingPhaseImage = null; 
        }

        // Inject phase-specific animations
        let animContainer = document.getElementById('phase-animation-container');
        if (!animContainer) {
            animContainer = document.createElement('div');
            animContainer.id = 'phase-animation-container';
            animContainer.className = 'absolute inset-0 pointer-events-none z-0 overflow-hidden rounded-3xl';
            container.insertBefore(animContainer, container.firstChild);
        }
        
        animContainer.innerHTML = ''; // Clear previous animation
        
        if (num === 1) { // Sospecha - Ghost
            animContainer.innerHTML = `
<div id="ghost" style="position: absolute; bottom: 0px; right: 20px; transform: scale(0.7); opacity: 0.9;">
  <div id="red">
    <div id="pupil"></div><div id="pupil1"></div><div id="eye"></div><div id="eye1"></div>
    <div id="top0"></div><div id="top1"></div><div id="top2"></div><div id="top3"></div><div id="top4"></div>
    <div id="st0"></div><div id="st1"></div><div id="st2"></div><div id="st3"></div><div id="st4"></div><div id="st5"></div>
    <div id="an1"></div><div id="an2"></div><div id="an3"></div><div id="an4"></div><div id="an5"></div><div id="an6"></div>
    <div id="an7"></div><div id="an8"></div><div id="an9"></div><div id="an10"></div><div id="an11"></div><div id="an12"></div>
    <div id="an13"></div><div id="an14"></div><div id="an15"></div><div id="an16"></div><div id="an17"></div><div id="an18"></div>
  </div>
  <div id="shadow"></div>
</div>`;
        } else if (num === 2) { // Idea - Astronaut
            animContainer.innerHTML = `
<div class="box-of-star1"><div class="star star-position1"></div><div class="star star-position2"></div><div class="star star-position3"></div><div class="star star-position4"></div><div class="star star-position5"></div><div class="star star-position6"></div><div class="star star-position7"></div></div>
<div class="box-of-star2"><div class="star star-position1"></div><div class="star star-position2"></div><div class="star star-position3"></div><div class="star star-position4"></div><div class="star star-position5"></div><div class="star star-position6"></div><div class="star star-position7"></div></div>
<div class="box-of-star3"><div class="star star-position1"></div><div class="star star-position2"></div><div class="star star-position3"></div><div class="star star-position4"></div><div class="star star-position5"></div><div class="star star-position6"></div><div class="star star-position7"></div></div>
<div class="box-of-star4"><div class="star star-position1"></div><div class="star star-position2"></div><div class="star star-position3"></div><div class="star star-position4"></div><div class="star star-position5"></div><div class="star star-position6"></div><div class="star star-position7"></div></div>
<div data-js="astro" class="astronaut" style="transform: scale(0.6); top: 5%; right: 10%; opacity: 0.9;">
    <div class="head"></div><div class="arm arm-left"></div><div class="arm arm-right"></div>
    <div class="body"><div class="panel"></div></div><div class="leg leg-left"></div><div class="leg leg-right"></div><div class="schoolbag"></div>
</div>`;
        } else if (num === 4) { // Resultado - Loader with text
            let descText = phase.description ? phase.description.trim() : "Generating";
            if (!descText) descText = "Generating";
            
            // Generate animated letters
            let letters = descText.split('').map((char, index) => {
                let delay = 0.1 + (index * 0.1);
                return `<span class="loader-letter" style="animation-delay: ${delay}s">${char === ' ' ? '&nbsp;' : char}</span>`;
            }).join('');
            
            descEl.innerHTML = `
<div class="loader-wrapper mx-auto my-8">
  ${letters}
  <div class="loader"></div>
</div>`;
        }
    };

    if (animate) {
        container.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
        container.style.transform = 'translateY(15px)';
        container.style.opacity = '0';
        
        setTimeout(() => {
            updateDOM();
            container.style.transform = 'translateX(-20px)';
            // Force reflow to apply the reset instantly before animating again
            void container.offsetWidth;
            container.style.transform = 'translateY(0) translateX(0)';
            container.style.opacity = '1';
        }, 300);
    } else {
        updateDOM();
    }
}

// Admin Methods (Silent & Non-intrusive UI)
async function createNewIdea() {
    try {
        const res = await fetch('/api/ideas', { method: 'POST' });
        const d = await res.json();
        if (d.success) {
            currentPhaseView = 1;
            await loadDitoxIdea(true);
        }
    } catch(e) { console.error("Error al crear idea:", e); }
}

function archiveIdea() {
    if (typeof customPrompt === 'function') {
        customPrompt("Ingrese el nombre del ciclo para guardarlo en el historial:", async (name) => {
            if (!name || !name.trim()) return;
            try {
                const res = await fetch('/api/ideas/archive', { 
                    method: 'POST', 
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ cycleName: name.trim() })
                });
                const d = await res.json();
                if (d.success) {
                    await loadDitoxIdea(true);
                }
            } catch(e) { console.error("Error al archivar ciclo:", e); }
        });
    } else {
        const name = prompt("Ingrese el nombre del ciclo:");
        if (!name || !name.trim()) return;
        fetch('/api/ideas/archive', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ cycleName: name.trim() })
        }).then(() => loadDitoxIdea(true));
    }
}

async function deleteIdea() {
    try {
        await fetch('/api/ideas', { method: 'DELETE' });
        await loadDitoxIdea(true);
    } catch(e) { console.error("Error eliminando idea:", e); }
}

async function updateIdeaIndicators() {
    const dir = document.getElementById('edit-idea-dir').value;
    const tf = document.getElementById('edit-idea-tf').value;
    try {
        await fetch(`/api/ideas/phase/1`, { 
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ direction: dir, timeframe: tf })
        });
        await loadDitoxIdea(true);
    } catch(e) { console.error("Error actualizando indicadores:", e); }
}

async function saveCurrentPhase() {
    const desc = document.getElementById('edit-phase-desc').value;
    const saveBtn = document.querySelector('button[onclick="saveCurrentPhase()"]');
    const originalText = saveBtn ? saveBtn.innerHTML : 'Guardar Fase';

    const payload = { description: desc };
    if (window.pendingPhaseImage) payload.image = window.pendingPhaseImage;
    
    try {
        if (saveBtn) saveBtn.innerHTML = '⏳ Guardando...';
        const res = await fetch(`/api/ideas/phase/${currentPhaseView}`, {
            method: 'PUT',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        const d = await res.json();
        if(d.success) {
            window.pendingPhaseImage = null;
            await loadDitoxIdea(true);
            if (saveBtn) {
                saveBtn.innerHTML = `✅ ¡Fase ${currentPhaseView} Guardada!`;
                saveBtn.classList.remove('from-green-500', 'to-emerald-600');
                saveBtn.classList.add('from-emerald-400', 'to-teal-500');
                setTimeout(() => {
                    saveBtn.innerHTML = originalText;
                    saveBtn.classList.remove('from-emerald-400', 'to-teal-500');
                    saveBtn.classList.add('from-green-500', 'to-emerald-600');
                }, 2000);
            }
        } else {
            if (saveBtn) saveBtn.innerHTML = originalText;
        }
    } catch(e) { 
        console.error("Error al guardar fase:", e); 
        if (saveBtn) saveBtn.innerHTML = originalText;
    }
}

// Global Image Paste Handler for Admin
document.addEventListener('paste', e => {
    const adminMode = localStorage.getItem('ditoxMode') === 'true';
    if (!adminMode) return;

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    for (let index in items) {
        const item = items[index];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = function(event) {
                window.pendingPhaseImage = event.target.result;
                const pasteArea = document.getElementById('paste-area');
                if (pasteArea) {
                    pasteArea.innerHTML = '<span class="text-green-400 font-bold text-lg">✅ Captura pegada correctamente (Haz clic en "Guardar Fase")</span>';
                }
            };
            reader.readAsDataURL(blob);
        }
    }
});

document.addEventListener('DOMContentLoaded', () => {
    // Load ideas on startup
    loadDitoxIdea(true);
    
    // Periodic silent refresh (only updates if user is not editing)
    setInterval(() => loadDitoxIdea(false), 12000); 
});
