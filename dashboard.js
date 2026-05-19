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

function customPrompt(title, callback) {
    const modal = document.getElementById('modal-prompt');
    if (!modal) return alert("Error: Modal prompt not found via ID");

    document.getElementById('prompt-title').textContent = title;
    document.getElementById('prompt-input').value = '';
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
customPrompt = function (title, callback) {
    document.getElementById('prompt-input').classList.remove('hidden');
    originalCustomPrompt(title, callback);
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
            body: JSON.stringify({ password: 'awd ', active: true })
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
            body: JSON.stringify({ password: 'awd ', active: false })
        }).catch(console.error);
    }
}

function showSection(sectionId) {
    // Hide all sections
    ['dashboard', 'history', 'users', 'bitacora', 'broadcast'].forEach(s => {
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
        const password = 'awd ';
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
        // Relaxed check: allow 'awd' without space or with extra spaces
        if (password && password.trim() === 'awd') {
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
}

function updateSignal(signalId) {
    const select = document.getElementById(`obs-select-${signalId}`);
    const obs = select.value;
    if (!obs) return customAlert("⚠ Selecciona una observación primero");

    const password = 'awd '; // Soft Auth

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
    const password = 'awd ';

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
        const password = 'awd ';
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
    const password = 'awd ';
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
    const password = 'awd ';
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
                body: JSON.stringify({ password: 'awd ', groupId, name })
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
                body: JSON.stringify({ password: 'awd ', groupId, name })
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
        body: JSON.stringify({ password: 'awd ' })
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
            password: 'awd ',
            message: message,
            imageBase64: imageBase64,
            selectedGroups: selectedGroups
        })
    })
    .then(r => r.json())
    .then(data => {
        if (data.success) {
            alert(`✅ Mensaje enviado con éxito a ${selectedGroups.length} grupos.`);
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
