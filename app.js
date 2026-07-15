/* ==========================================================================
   VITTHAL OIL MILL MANAGEMENT OS - APPLICATION LOGIC
   ========================================================================== */

// Auto-clear old local storage cache to ensure clean state
if (typeof localStorage !== 'undefined') {
    localStorage.removeItem('vitthal_mill_state');
}


// --- STATIC CONFIGURATIONS ---
const PRODUCTS = [
    { id: 'cs-ms', name: 'Cotton Seed (MS)', category: 'Seed' },
    { id: 'cs-oms', name: 'Cotton Seed (OMS)', category: 'Seed' },
    { id: 'ch-ms', name: 'Cotton Hulls (MS)', category: 'Seed' },
    { id: 'ch-oms', name: 'Cotton Hulls (OMS)', category: 'Seed' },
    { id: 'kandi', name: 'Kandi', category: 'Seed' },
    { id: 'khal-mm', name: 'Khal MM', category: 'Khal' },
    { id: 'khal-km', name: 'Khal KM', category: 'Khal' },
    { id: 'oil-crude', name: 'Crud Oil', category: 'Oil' },
    { id: 'oil-wash', name: 'Wash Oil', category: 'Oil' },
    { id: 'oil-gaad', name: 'Gaad', category: 'Oil' },
    { id: 'oil-acid', name: 'Acid Oil', category: 'Oil' },
    { id: 'sarki-bardan', name: 'Sarki Bardan', category: 'Bardan' },
    { id: 'gm-pp-hdr', name: 'Gauri Malai PP', category: 'Bardan' }, // Header/Direct row in screenshot
    { id: 'gm-pp-50', name: '50kg PP Bag', category: 'Bardan' },
    { id: 'gm-pp-60', name: '60kg PP Bag', category: 'Bardan' },
    { id: 'gm-pp-70', name: '70kg PP Bag', category: 'Bardan' },
    { id: 'gm-pp-km', name: 'KM PP', category: 'Bardan' },
    { id: 'gm-pp-mm', name: 'MM PP', category: 'Bardan' },
    { id: 'gm-pp-gm', name: 'GM PP', category: 'Bardan' },
    { id: 'gm-pp-kg', name: 'KG PP', category: 'Bardan' },
    { id: 'gm-pp-murgi', name: 'Murgi', category: 'Bardan' },
    { id: 'jute-bag', name: 'Old Gunny Bags (Jute bag)', category: 'Bardan' }
];

// Initial Opening Stocks for June 2026 (matching Excel sheet starting values)
const INITIAL_OPENING_STOCKS = {
    'cs-ms': 0.00,
    'cs-oms': 0.00,
    'ch-ms': 0.00,
    'ch-oms': 0.00,
    'kandi': 0.00,
    'khal-mm': 0.00,
    'khal-km': 0.00,
    'oil-crude': 0.00,
    'oil-wash': 0.00,
    'oil-gaad': 0.00,
    'oil-acid': 0.00,
    'sarki-bardan': 0.00,
    'gm-pp-hdr': 0.00,
    'gm-pp-50': 0.00,
    'gm-pp-60': 0.00,
    'gm-pp-70': 0.00,
    'gm-pp-km': 0.00,
    'gm-pp-mm': 0.00,
    'gm-pp-gm': 0.00,
    'gm-pp-kg': 0.00,
    'gm-pp-murgi': 0.00,
    'jute-bag': 0.00
};

// --- SYSTEM STATE ---
let state = {
    unloads: [],
    sales: [],
    customers: [],
    salesInvoices: [],
    stockDaily: {},
    spareParts: [],
    maintenanceLogs: []
};

// --- Concurrency sync tracking ---
// Collections merged by record id on the server; used to compute deletions to send.
const SYNC_COLLECTIONS = [
    'unloads', 'sales', 'customers', 'salesInvoices', 'suppliers', 'productionLogs',
    'refiningLogs', 'machines', 'activeCrushing', 'payments', 'spareParts',
    'maintenanceLogs', 'transportLogs'
];
let currentRev = 0;          // last revision seen from the server
let lastSyncedState = null;  // deep snapshot at last load/save, to diff deletions

function snapshotSynced() {
    try { lastSyncedState = JSON.parse(JSON.stringify(state)); } catch (e) { lastSyncedState = null; }
}

function computeDeletes() {
    const deletes = {};
    if (!lastSyncedState) return deletes;
    SYNC_COLLECTIONS.forEach(col => {
        const before = Array.isArray(lastSyncedState[col]) ? lastSyncedState[col] : [];
        const after = Array.isArray(state[col]) ? state[col] : [];
        const afterIds = new Set(after.map(r => r && r.id).filter(Boolean));
        const removed = before.map(r => r && r.id).filter(id => id && !afterIds.has(id));
        if (removed.length) deletes[col] = removed;
    });
    return deletes;
}

// Temporary in-memory list of consumed spares during modal edit
let modalConsumedSpares = [];

// Charts instances
let productionChartInstance = null;
let repairChartInstance = null;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    initClock();
    setupEventListeners();
    initStockMonthSelector();

    // Wait for the state to load (async from the host DB) before gating access,
    // otherwise the async load overwrites the security config we just applied.
    await loadState();

    // Apply role-based access (may show the login gate before revealing the app)
    initSecurity();

    // Switch to default active tab (Dashboard)
    switchTab('dashboard');
});

// ===================== ROLE-BASED ACCESS CONTROL =====================
// UI-level gating only: it organises which staff see/do what. It is NOT data
// security — the database file is still plain JSON readable outside the app.
const ROLE_ACCESS = {
    admin:       { label: 'Anand (Owner)', icon: '🛡️', desc: 'Full access & deletes', tabs: '*', canDelete: true },
    weighbridge: { label: 'Weighbridge Operator', icon: '⚖️', desc: 'Unloads & Sales', tabs: ['dashboard', 'unloads', 'sales', 'gate-passes', 'manual'], canDelete: false },
    supervisor:  { label: 'Plant Supervisor', icon: '🏭', desc: 'Production, Refining, Spares, Maintenance', tabs: ['dashboard', 'production', 'refining', 'stock', 'spares', 'repairs', 'gate-passes', 'manual'], canDelete: false },
    accountant:  { label: 'Accountant', icon: '📒', desc: 'Ledger & Invoices', tabs: ['dashboard', 'party-accounts', 'invoices', 'analytics', 'gate-passes', 'manual'], canDelete: false },
};
const DEFAULT_PINS = { admin: '4321', weighbridge: '1111', supervisor: '2222', accountant: '3333' };
let currentRole = 'admin';
let pendingLoginRole = null;

function ensureSecurityDefaults() {
    if (!state.security || typeof state.security !== 'object') {
        state.security = { enabled: false, pins: { ...DEFAULT_PINS } };
    }
    if (!state.security.pins || typeof state.security.pins !== 'object') {
        state.security.pins = { ...DEFAULT_PINS };
    }
    Object.keys(DEFAULT_PINS).forEach(r => {
        if (!state.security.pins[r]) state.security.pins[r] = DEFAULT_PINS[r];
    });
}

function roleAllows(role, tabId) {
    const acc = ROLE_ACCESS[role];
    if (!acc) return false;
    return acc.tabs === '*' || acc.tabs.includes(tabId);
}

function initSecurity() {
    ensureSecurityDefaults();
    loadSecurityConfigUI();
    if (!state.security.enabled) {
        currentRole = 'admin';
        applyRoleAccess('admin');
        return;
    }
    const saved = sessionStorage.getItem('vom_role');
    if (saved && ROLE_ACCESS[saved]) {
        currentRole = saved;
        applyRoleAccess(saved);
    } else {
        showLoginGate();
    }
}

function showLoginGate() {
    const gate = document.getElementById('login-gate');
    const rolesWrap = document.getElementById('login-roles');
    if (!gate || !rolesWrap) return;
    rolesWrap.innerHTML = '';
    Object.keys(ROLE_ACCESS).forEach(role => {
        const acc = ROLE_ACCESS[role];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'login-role-btn';
        btn.onclick = () => selectLoginRole(role);
        btn.innerHTML = `<span class="lr-icon">${acc.icon}</span><span>${acc.label}</span><small>${acc.desc}</small>`;
        rolesWrap.appendChild(btn);
    });
    rolesWrap.style.display = 'grid';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-pin').value = '';
    pendingLoginRole = null;
    gate.style.display = 'flex';
}

function selectLoginRole(role) {
    pendingLoginRole = role;
    document.getElementById('login-roles').style.display = 'none';
    const form = document.getElementById('login-form');
    form.style.display = 'block';
    document.getElementById('login-selected-role').textContent = `${ROLE_ACCESS[role].icon} ${ROLE_ACCESS[role].label}`;
    const pin = document.getElementById('login-pin');
    pin.value = '';
    document.getElementById('login-error').textContent = '';
    setTimeout(() => pin.focus(), 50);
}

function cancelLoginRole() {
    pendingLoginRole = null;
    document.getElementById('login-roles').style.display = 'grid';
    document.getElementById('login-form').style.display = 'none';
}

function attemptLogin(e) {
    if (e) e.preventDefault();
    if (!pendingLoginRole) return;
    const entered = document.getElementById('login-pin').value.trim();
    if (entered === String(state.security.pins[pendingLoginRole])) {
        currentRole = pendingLoginRole;
        sessionStorage.setItem('vom_role', currentRole);
        document.getElementById('login-gate').style.display = 'none';
        applyRoleAccess(currentRole);
        const firstTab = ROLE_ACCESS[currentRole].tabs === '*' ? 'dashboard' : ROLE_ACCESS[currentRole].tabs[0];
        switchTab(firstTab);
    } else {
        document.getElementById('login-error').textContent = 'Incorrect PIN. Please try again.';
        document.getElementById('login-pin').value = '';
    }
}

function applyRoleAccess(role) {
    currentRole = role;
    const acc = ROLE_ACCESS[role] || ROLE_ACCESS.admin;

    // Nav visibility
    document.querySelectorAll('.nav-item').forEach(btn => {
        const tab = btn.getAttribute('data-tab');
        btn.classList.toggle('role-hidden', !(acc.tabs === '*' || acc.tabs.includes(tab)));
    });

    // Delete gating
    document.body.classList.toggle('role-no-delete', !acc.canDelete);

    // Role badge / logout (only meaningful when security is on)
    const badge = document.getElementById('active-role-badge');
    const label = document.getElementById('active-role-label');
    if (badge) badge.style.display = state.security.enabled ? 'flex' : 'none';
    if (label) label.textContent = acc.label;

    // If currently on a disallowed tab, bounce to the first allowed one
    const active = document.querySelector('.tab-pane.active');
    if (active && !(acc.tabs === '*' || acc.tabs.includes(active.id))) {
        switchTab(acc.tabs === '*' ? 'dashboard' : acc.tabs[0]);
    }
}

function logoutRole() {
    sessionStorage.removeItem('vom_role');
    currentRole = null;
    showLoginGate();
}

// --- Security config (Database tab, admin only) ---
function loadSecurityConfigUI() {
    const en = document.getElementById('sec-enabled');
    if (!en) return;
    en.checked = !!state.security.enabled;
    ['admin', 'weighbridge', 'supervisor', 'accountant'].forEach(r => {
        const el = document.getElementById('sec-pin-' + r);
        if (el) el.value = state.security.pins[r] || '';
    });
}

function toggleSecurityEnabled(checked) {
    // Visual only; persisted on Save. Warn about the admin PIN when enabling.
    if (checked) {
        const adminPin = document.getElementById('sec-pin-admin');
        if (adminPin && !adminPin.value.trim()) adminPin.value = DEFAULT_PINS.admin;
    }
}

function saveSecurityConfig() {
    const enabled = document.getElementById('sec-enabled').checked;
    const pins = {};
    ['admin', 'weighbridge', 'supervisor', 'accountant'].forEach(r => {
        const v = document.getElementById('sec-pin-' + r).value.trim();
        pins[r] = v || DEFAULT_PINS[r];
    });
    if (enabled && !pins.admin) {
        alert('The Anand (Owner) PIN cannot be empty when access control is enabled.');
        return;
    }
    state.security = { enabled, pins };
    saveState();

    // The admin is the one configuring, so keep them signed in as admin.
    currentRole = 'admin';
    if (enabled) sessionStorage.setItem('vom_role', 'admin');
    else sessionStorage.removeItem('vom_role');
    document.getElementById('login-gate').style.display = 'none';
    applyRoleAccess('admin');
    alert(enabled
        ? 'Access control enabled. Staff will be asked to pick a role and enter a PIN on this device.'
        : 'Access control disabled. The app is open to everyone on this device.');
}

// --- AUTOMATIC SERVER BACKUPS (Database tab) ---
async function renderBackupsList() {
    const tbody = document.getElementById('backups-tbody');
    const status = document.getElementById('auto-backup-status');
    if (!tbody) return;

    if (!window.location.protocol.startsWith('http')) {
        if (status) status.textContent = 'Automatic backups run on the host server — not available in offline file mode.';
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Open the dashboard via the host server (http://…:4567) to see automatic backups.</td></tr>';
        return;
    }

    try {
        const res = await fetch('/api/backups');
        const data = await res.json();
        const recent = data.recent || [];
        const daily = data.daily || [];
        const all = [
            ...recent.map(b => ({ ...b, typeLabel: 'Per-save', color: '#3b82f6' })),
            ...daily.map(b => ({ ...b, typeLabel: 'Daily', color: '#10b981' }))
        ];

        if (status) {
            const last = recent[0] || daily[0];
            status.innerHTML = last
                ? `<span style="color:#10b981;font-weight:600;">● Active</span> · last snapshot ${new Date(last.modified).toLocaleString('en-IN')} · ${recent.length} per-save, ${daily.length} daily retained`
                : 'Active — no snapshots yet (they appear after the first save).';
        }

        if (all.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No backups yet.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        all.forEach(b => {
            const kb = (b.size / 1024).toFixed(1);
            const when = new Date(b.modified).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><span style="padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;background:${b.color}22;color:${b.color};border:1px solid ${b.color}66;">${b.typeLabel}</span></td>
                <td style="font-family:monospace;">${when}</td>
                <td class="text-end" style="font-family:monospace;">${kb} KB</td>
                <td class="text-center"><button class="btn btn-secondary btn-sm" onclick="restoreBackup('${b.bucket}','${b.name}')" title="Restore this snapshot"><i class="fa-solid fa-clock-rotate-left"></i> Restore</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        if (status) status.textContent = 'Could not reach the backup service on the host server.';
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Backup service unavailable.</td></tr>';
    }
}

async function restoreBackup(bucket, name) {
    if (!confirm(`Restore this ${bucket === 'daily' ? 'daily' : 'per-save'} snapshot?\n\nYour current data will be snapshotted first, so this is reversible. The app will reload with the restored records.`)) return;
    try {
        const res = await fetch('/api/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bucket, name })
        });
        const result = await res.json();
        if (result.status === 'success') {
            await loadState();       // pull the restored DB and re-render everything
            renderBackupsList();
            alert('Backup restored successfully. All records now reflect the selected snapshot.');
        } else {
            alert('Restore failed: ' + (result.message || 'unknown error'));
        }
    } catch (e) {
        alert('Restore failed: ' + e.message);
    }
}

// Load state from local storage or set defaults
window.sessionFallbackStorage = {};

function getStorageItem(key) {
    try {
        return localStorage.getItem(key);
    } catch (e) {
        console.warn("localStorage is blocked or disabled in offline file:// mode. Using session memory.");
        return window.sessionFallbackStorage[key] || null;
    }
}

function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn("localStorage write blocked. Storing in session memory.");
        window.sessionFallbackStorage[key] = value;
    }
}

function updateSyncStatus(status, message) {
    const el = document.getElementById('sync-status-badge');
    if (el) {
        el.className = `badge badge-${status}`;
        el.innerHTML = `<i class="fa-solid fa-cloud"></i> ${message}`;
        if (status === 'success') {
            el.style.backgroundColor = 'rgba(16, 185, 129, 0.15)';
            el.style.color = '#10b981';
        } else if (status === 'warning') {
            el.style.backgroundColor = 'rgba(245, 158, 11, 0.15)';
            el.style.color = '#f59e0b';
        } else if (status === 'danger') {
            el.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
            el.style.color = '#ef4444';
        }
    }
}

function sanitizeStateArrays() {
    if (!Array.isArray(state.sales)) state.sales = [];
    if (!Array.isArray(state.customers)) state.customers = [];
    if (!Array.isArray(state.salesInvoices)) state.salesInvoices = [];
    if (!Array.isArray(state.unloads)) state.unloads = [];
    if (!Array.isArray(state.spareParts)) state.spareParts = [];
    if (!Array.isArray(state.maintenanceLogs)) state.maintenanceLogs = [];
    if (!Array.isArray(state.suppliers)) state.suppliers = [];
    if (!Array.isArray(state.productionLogs)) state.productionLogs = [];
    if (!Array.isArray(state.refiningLogs)) state.refiningLogs = [];
    if (!Array.isArray(state.machines)) state.machines = [];
    if (!Array.isArray(state.activeCrushing)) state.activeCrushing = [];
    if (!Array.isArray(state.payments)) state.payments = [];
    if (!Array.isArray(state.transportLogs)) state.transportLogs = [];
    if (!Array.isArray(state.gatePasses)) state.gatePasses = [];
    if (!state.stockDaily || typeof state.stockDaily !== 'object') state.stockDaily = {};
    if (!state.security || typeof state.security !== 'object') {
        state.security = { enabled: false, pins: { admin: '4321', weighbridge: '1111', supervisor: '2222', accountant: '3333' } };
    }
    if (!Array.isArray(state.activeCrushing)) state.activeCrushing = [];

    // Self-clean old empty stock overrides to unfreeze ledger
    if (state.stockDaily && typeof state.stockDaily === 'object') {
        let cleaned = false;
        for (const m in state.stockDaily) {
            if (!state.stockDaily[m] || typeof state.stockDaily[m] !== 'object') continue;
            for (const p in state.stockDaily[m]) {
                if (!state.stockDaily[m][p] || typeof state.stockDaily[m][p] !== 'object') continue;
                for (const d in state.stockDaily[m][p]) {
                    const val = state.stockDaily[m][p][d];
                    if (val && parseFloat(val.receipt) === 0 && parseFloat(val.issue) === 0) {
                        delete state.stockDaily[m][p][d];
                        cleaned = true;
                    }
                }
                if (Object.keys(state.stockDaily[m][p]).length === 0) {
                    delete state.stockDaily[m][p];
                }
            }
            if (Object.keys(state.stockDaily[m]).length === 0) {
                delete state.stockDaily[m];
            }
        }
        if (cleaned) {
            console.log("Self-cleaned empty stock overrides");
            setTimeout(() => { saveState(); }, 500);
        }
    }
}

function loadStateFromLocal() {
    const saved = getStorageItem('vitthal_mill_state');
    if (saved) {
        try {
            state = JSON.parse(saved);
            sanitizeStateArrays();
        } catch (e) {
            console.error("Error parsing state, resetting...", e);
            resetStateToDefault();
        }
    } else {
        resetStateToDefault();
    }
    snapshotSynced();
}

async function checkFirebaseStatus() {
    if (window.location.protocol.startsWith('http')) {
        try {
            const res = await fetch('/api/status');
            if (res.ok) {
                const status = await res.json();
                if (status.firebase_active) {
                    updateSyncStatus('success', 'Sync Active (Cloud Cloud)');
                    return true;
                } else if (status.firebase_error) {
                    console.warn("Firebase configuration error:", status.firebase_error);
                }
            }
        } catch (e) {
            console.warn("Could not fetch Firebase status", e);
        }
    }
    return false;
}

async function loadState() {
    // Try loading from database API if served via http
    if (window.location.protocol.startsWith('http')) {
        try {
            updateSyncStatus('warning', 'Syncing...');
            const res = await fetch('/api/load');
            if (res.ok) {
                const data = await res.json();
                if (data && data.unloads) {
                    state = data;
                    sanitizeStateArrays();
                    currentRev = data._rev || 0;
                    snapshotSynced();
                    const cloudActive = await checkFirebaseStatus();
                    if (!cloudActive) {
                        updateSyncStatus('success', 'Sync Active (Host DB)');
                    }
                    renderAllViews();
                    return;
                } else {
                    // Host DB is empty - Bootstrap with defaults
                    resetStateToDefault();
                    const cloudActive = await checkFirebaseStatus();
                    if (!cloudActive) {
                        updateSyncStatus('success', 'Sync Active (Host DB)');
                    }
                    renderAllViews();
                    return;
                }
            }
        } catch (err) {
            console.warn("API load failed, falling back to local storage", err);
        }
    }
    loadStateFromLocal();
    updateSyncStatus('warning', 'Local Storage Mode');
    renderAllViews();
}

async function saveState() {
    sanitizeStateArrays();
    setStorageItem('vitthal_mill_state', JSON.stringify(state));
    
    if (window.location.protocol.startsWith('http')) {
        try {
            const deletes = computeDeletes();
            const res = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ payload: state, baseRev: currentRev, deletes })
            });
            if (res.ok) {
                const result = await res.json();
                if (result && result.data) {
                    // Adopt the server's authoritative merged state so any records another
                    // user saved concurrently are pulled in rather than lost.
                    const prevSig = syncSignature(state);
                    state = result.data;
                    currentRev = result.rev || currentRev;
                    sanitizeStateArrays();
                    snapshotSynced();
                    // Only repaint if the merge actually changed our data and the user
                    // isn't mid-edit in a modal (avoids disrupting an open form).
                    if (syncSignature(state) !== prevSig && !document.querySelector('.modal.active')) {
                        renderAllViews();
                    }
                }
                const cloudActive = await checkFirebaseStatus();
                if (!cloudActive) {
                    updateSyncStatus('success', 'Sync Active (Host DB)');
                }
                return;
            }
        } catch (err) {
            console.error("API save failed", err);
            updateSyncStatus('danger', 'Sync Offline!');
        }
    }
}

// Cheap fingerprint of collection sizes + revision to detect merged-in changes.
function syncSignature(s) {
    return SYNC_COLLECTIONS.map(c => (Array.isArray(s[c]) ? s[c].length : 0)).join(',');
}

function resetStateToDefault() {
    state = {
        unloads: [],
        sales: [],
        customers: [],
        salesInvoices: [],
        suppliers: [],
        productionLogs: [],
        refiningLogs: [],
        machines: [],
        activeCrushing: [],
        security: { enabled: false, pins: { admin: '4321', weighbridge: '1111', supervisor: '2222', accountant: '3333' } },
        payments: [],
        stockDaily: {
            '2026-06': {},
            '2026-07': {}
        },
        spareParts: [],
        maintenanceLogs: [],
        transportLogs: [],
        gatePasses: []
    };
    saveState();
}

// --- CLOCK & TIMERS ---
function initClock() {
    const clockEl = document.getElementById('live-clock');
    const updateTime = () => {
        const now = new Date();
        let hours = now.getHours();
        let minutes = now.getMinutes();
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12; // 0 should be 12
        minutes = minutes < 10 ? '0'+minutes : minutes;
        clockEl.textContent = `${hours}:${minutes} ${ampm}`;
    };
    updateTime();
    setInterval(updateTime, 60000);
}

function initStockMonthSelector() {
    const stockMonthSel = document.getElementById('stock-month-selector');
    if (!stockMonthSel) return;
    
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const currentMonthKey = `${year}-${month}`;
    
    // Check if current month option already exists
    let exists = false;
    for (let i = 0; i < stockMonthSel.options.length; i++) {
        if (stockMonthSel.options[i].value === currentMonthKey) {
            exists = true;
            break;
        }
    }
    
    // Dynamically add option if missing
    if (!exists) {
        const opt = document.createElement('option');
        opt.value = currentMonthKey;
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        opt.textContent = `${monthNames[now.getMonth()]} ${year}`;
        stockMonthSel.appendChild(opt);
    }
    
    // Auto-select current month
    stockMonthSel.value = currentMonthKey;
}

// --- EVENT LISTENERS setup ---
function setupEventListeners() {
    // Navigation items
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.getAttribute('data-tab'));
        });
    });

    // Theme toggle
    const themeToggleBtn = document.getElementById('theme-toggle');
    themeToggleBtn.addEventListener('click', () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', newTheme);
        themeToggleBtn.querySelector('span').textContent = newTheme === 'light' ? 'Light Mode' : 'Dark Mode';
        themeToggleBtn.querySelector('i').className = newTheme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
    });

    // User Manual inner anchors smooth scroll
    document.querySelectorAll('.m-nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = link.getAttribute('href').substring(1);
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                document.querySelectorAll('.m-nav-link').forEach(l => {
                    l.classList.remove('active');
                    l.style.background = 'none';
                    l.style.color = 'var(--text-secondary)';
                });
                link.classList.add('active');
                link.style.background = 'var(--bg-card-hover)';
                link.style.color = 'var(--text-primary)';
            }
        });
    });

    // Mock Data Buttons
    document.getElementById('seed-mock-btn').addEventListener('click', seedMockData);
    document.getElementById('seed-mock-btn-2').addEventListener('click', seedMockData);
    document.getElementById('clear-db-btn').addEventListener('click', () => {
        if (confirm("Are you sure you want to delete ALL local data? This action cannot be undone.")) {
            resetStateToDefault();
            renderAllViews();
            alert("Database cleared.");
        }
    });

    // Global Search Bar
    document.getElementById('global-search').addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        if (!query) {
            renderUnloadTable();
            renderSparesTable();
            return;
        }
        // Filter unloads by supplier, place, lorryNo
        renderUnloadTable(query);
        // Filter spares
        renderSparesTable(query);
    });

    // Quick Action menu toggled inline from HTML template button


    // Filter changes for Unloads
    document.getElementById('filter-unload-supplier').addEventListener('change', () => renderUnloadTable());
    document.getElementById('filter-unload-place').addEventListener('input', () => renderUnloadTable());
    document.getElementById('filter-unload-lorry').addEventListener('input', () => renderUnloadTable());
    document.getElementById('clear-unload-filters').addEventListener('click', () => {
        document.getElementById('filter-unload-supplier').value = "";
        document.getElementById('filter-unload-place').value = "";
        document.getElementById('filter-unload-lorry').value = "";
        renderUnloadTable();
    });

    // Select all unloads checkbox
    document.getElementById('select-all-unloads').addEventListener('change', (e) => {
        const checked = e.target.checked;
        document.querySelectorAll('.unload-row-checkbox').forEach(cb => {
            cb.checked = checked;
        });
        updateSelectedLorriesCount();
    });

    // Bulk Billing button trigger
    document.getElementById('bulk-bill-btn').addEventListener('click', () => {
        const selectedIds = Array.from(document.querySelectorAll('.unload-row-checkbox:checked'))
                                 .map(cb => cb.getAttribute('data-id'));
        if (selectedIds.length === 0) return;
        
        // Find the supplier of the first selected item
        const firstUnload = state.unloads.find(u => u.id === selectedIds[0]);
        if (!firstUnload) return;

        // Switch to Invoices view
        switchTab('invoices');
        
        // Select supplier and checkboxes automatically
        document.getElementById('bill-supplier-select').value = firstUnload.supplier;
        loadSupplierUnbilledLorries(firstUnload.supplier, selectedIds);
    });

    // Stock Month selector
    document.getElementById('stock-month-selector').addEventListener('change', () => {
        renderStockStatement();
    });

    // Spares filters
    document.getElementById('search-spare').addEventListener('input', () => renderSparesTable());
    document.getElementById('filter-spare-machine').addEventListener('change', () => renderSparesTable());
    document.getElementById('filter-spare-status').addEventListener('change', () => renderSparesTable());

    // Repairs filters
    document.getElementById('filter-repair-machine').addEventListener('change', () => renderRepairsTable());
    document.getElementById('filter-repair-type').addEventListener('change', () => renderRepairsTable());
    document.getElementById('filter-repair-status').addEventListener('change', () => renderRepairsTable());

    // Outward Sales filters
    const fSalesCust = document.getElementById('filter-sales-customer');
    if (fSalesCust) fSalesCust.addEventListener('change', () => renderSalesTable());
    
    const fSalesProd = document.getElementById('filter-sales-product');
    if (fSalesProd) fSalesProd.addEventListener('change', () => renderSalesTable());
    
    const fSalesStat = document.getElementById('filter-sales-status');
    if (fSalesStat) fSalesStat.addEventListener('change', () => renderSalesTable());

    // Select all sales
    const selAllSales = document.getElementById('select-all-sales');
    if (selAllSales) {
        selAllSales.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.sales-row-checkbox').forEach(cb => {
                cb.checked = checked;
            });
            updateSelectedSalesCount();
        });
    }

    // Outward bulk billing
    const salesInvBtn = document.getElementById('sales-invoice-btn');
    if (salesInvBtn) {
        salesInvBtn.addEventListener('click', () => {
            const selectedIds = Array.from(document.querySelectorAll('.sales-row-checkbox:checked'))
                                     .map(cb => cb.getAttribute('data-id'));
            if (selectedIds.length === 0) return;
            const firstSale = state.sales.find(s => s.id === selectedIds[0]);
            if (!firstSale) return;

            switchTab('invoices');
            document.getElementById('bill-mode-select').value = 'outward';
            handleBillModeChange();
            document.getElementById('bill-supplier-select').value = firstSale.customer;
            loadSupplierUnbilledItems(firstSale.customer, selectedIds);
        });
    }

    // Form Submissions
    document.getElementById('unload-form').addEventListener('submit', handleUnloadSubmit);
    
    // Auto-select supplier location (place) on supplier selection
    const handleUnloadSupplierChange = (e) => {
        const name = e.target.value.trim();
        const supp = state.suppliers.find(s => s.name.trim().toLowerCase() === name.toLowerCase());
        if (supp && supp.address) {
            const place = supp.address.split(',')[0].trim();
            document.getElementById('unload-place').value = place;
        }
    };
    const unloadSupplierInput = document.getElementById('unload-supplier');
    if (unloadSupplierInput) {
        unloadSupplierInput.addEventListener('input', handleUnloadSupplierChange);
        unloadSupplierInput.addEventListener('change', handleUnloadSupplierChange);
    }

    document.getElementById('sales-form').addEventListener('submit', handleSalesSubmit);
    document.getElementById('customer-form').addEventListener('submit', handleCustomerSubmit);
    document.getElementById('supplier-form').addEventListener('submit', handleSupplierSubmit);
    document.getElementById('quick-stock-form').addEventListener('submit', handleQuickStockSubmit);
    document.getElementById('spare-form').addEventListener('submit', handleSpareSubmit);
    document.getElementById('repair-form').addEventListener('submit', handleRepairSubmit);
    document.getElementById('production-form').addEventListener('submit', handleProductionSubmit);
    const refiningForm = document.getElementById('refining-form');
    if (refiningForm) refiningForm.addEventListener('submit', handleRefiningSubmit);
    const machineForm = document.getElementById('machine-form');
    if (machineForm) machineForm.addEventListener('submit', handleMachineSubmit);
    const loginForm = document.getElementById('login-form');
    if (loginForm) loginForm.addEventListener('submit', attemptLogin);
    const activeCrushingForm = document.getElementById('active-crushing-form');
    if (activeCrushingForm) activeCrushingForm.addEventListener('submit', handleActiveCrushingSubmit);
    const ledgerPayForm = document.getElementById('ledger-payment-form');
    if (ledgerPayForm) ledgerPayForm.addEventListener('submit', handlePaymentSubmit);

    // Modal Add consumed spare button
    document.getElementById('add-consumed-spare-btn').addEventListener('click', () => {
        const select = document.getElementById('repair-spare-select');
        const qtyInput = document.getElementById('repair-spare-qty');
        
        const partId = select.value;
        const qty = parseInt(qtyInput.value);
        
        if (!partId || qty <= 0) return;
        
        const part = state.spareParts.find(p => p.id === partId);
        if (!part) return;

        if (part.stock < qty) {
            alert(`Insufficient stock! Current stock for ${part.name} is ${part.stock}.`);
            return;
        }

        // Add to modal listing
        const existing = modalConsumedSpares.find(s => s.partId === partId);
        if (existing) {
            existing.qty += qty;
        } else {
            modalConsumedSpares.push({
                partId: part.id,
                qty: qty,
                name: part.name,
                cost: part.cost
            });
        }
        
        qtyInput.value = 1;
        select.value = "";
        renderModalConsumedSparesList();
    });

    // Billing Generator events
    const billModeSel = document.getElementById('bill-mode-select');
    if (billModeSel) billModeSel.addEventListener('change', handleBillModeChange);
    
    document.getElementById('bill-supplier-select').addEventListener('change', (e) => {
        loadSupplierUnbilledItems(e.target.value);
    });
    
    document.getElementById('generate-invoice-btn').addEventListener('click', compileInvoiceBill);
    
    document.getElementById('save-invoice-log-btn').addEventListener('click', recordBillPayout);

    // Database Actions
    document.getElementById('export-db-btn').addEventListener('click', exportDatabase);
    document.getElementById('import-db-file').addEventListener('change', importDatabase);

    // Transport Fleet Events
    const transForm = document.getElementById('transport-form');
    if (transForm) transForm.addEventListener('submit', handleTransportSubmit);
    
    const fTransVeh = document.getElementById('filter-transport-vehicle');
    if (fTransVeh) fTransVeh.addEventListener('change', () => renderTransportTable());
    
    const fTransTyp = document.getElementById('filter-transport-type');
    if (fTransTyp) fTransTyp.addEventListener('change', () => renderTransportTable());
    
    const fTransMth = document.getElementById('filter-transport-month');
    if (fTransMth) fTransMth.addEventListener('change', () => renderTransportTable());
}

// --- TAB NAVIGATOR ---
function switchTab(tabId) {
    // Block navigation to tabs the current role may not access.
    if (state.security && state.security.enabled && currentRole && !roleAllows(currentRole, tabId)) {
        return;
    }
    document.querySelectorAll('.nav-item').forEach(btn => {
        if (btn.getAttribute('data-tab') === tabId) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    document.querySelectorAll('.tab-pane').forEach(pane => {
        if (pane.getAttribute('id') === tabId) {
            pane.classList.add('active');
        } else {
            pane.classList.remove('active');
        }
    });

    // Custom view actions upon loading specific tabs
    if (tabId === 'dashboard') {
        renderCharts();
    } else if (tabId === 'stock') {
        renderStockStatement();
    } else if (tabId === 'invoices') {
        handleBillModeChange();
        renderGSTSummary();
    } else if (tabId === 'sales') {
        switchSalesSubtab('sales-register');
    } else if (tabId === 'unloads') {
        switchUnloadsSubtab('unloads-register');
    } else if (tabId === 'production') {
        renderProductionTable();
    } else if (tabId === 'refining') {
        renderRefiningTable();
    } else if (tabId === 'party-accounts') {
        populateLedgerPartyDropdown();
        renderPartyAccounts();
    } else if (tabId === 'analytics') {
        renderAnalyticsTab();
    } else if (tabId === 'data-mgmt') {
        renderBackupsList();
    } else if (tabId === 'gate-passes') {
        renderGatePassTable();
    }
}

// --- MODAL UTILITIES ---
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    modal.classList.add('active');
    
    // Clear forms if clean load
    if (modalId === 'unload-modal') {
        populateSupplierDropdowns();
        if (!document.getElementById('unload-id').value) {
            document.getElementById('unload-form').reset();
            document.getElementById('unload-id').value = "";
            document.getElementById('unload-modal-title').textContent = "Log Raw Material Load";
        }
    } else if (modalId === 'sales-modal' && !document.getElementById('sales-id').value) {
        document.getElementById('sales-form').reset();
        document.getElementById('sales-id').value = "";
        document.getElementById('sales-modal-title').textContent = "Record Outbound Sales dispatch";
        populateSalesCustomersDropdown();
        document.getElementById('sales-items-tbody').innerHTML = '';
        addSalesItemRow();
        const addBtn = document.getElementById('sales-add-row-btn');
        if (addBtn) addBtn.style.display = 'inline-block';
    } else if (modalId === 'customer-modal' && !document.getElementById('cust-id').value) {
        document.getElementById('customer-form').reset();
        document.getElementById('cust-id').value = "";
        document.getElementById('customer-modal-title').textContent = "Register Client Details";
    } else if (modalId === 'supplier-modal' && !document.getElementById('supp-id').value) {
        document.getElementById('supplier-form').reset();
        document.getElementById('supp-id').value = "";
        document.getElementById('supplier-modal-title').textContent = "Register Supplier Details";
    } else if (modalId === 'production-modal' && !document.getElementById('prod-log-id').value) {
        document.getElementById('production-form').reset();
        document.getElementById('prod-log-id').value = "";
        document.getElementById('production-modal-title').textContent = "Log Seed Crushing / Issue to Production";
        populateProductionLorryDropdown();
        handleProductionLotChange();
    } else if (modalId === 'active-crushing-modal') {
        document.getElementById('active-crushing-form').reset();
        populateActiveCrushingLots();
    } else if (modalId === 'refining-modal' && !document.getElementById('refining-id').value) {
        document.getElementById('refining-form').reset();
        document.getElementById('refining-id').value = "";
        document.getElementById('refining-modal-title').textContent = "Log Oil Refining Tanker Run";
        document.getElementById('refining-batches-tbody').innerHTML = '';
        addRefiningBatchRow(new Date().toISOString().split('T')[0]);
        recalculateRefiningSummary();
    } else if (modalId === 'machine-modal' && !document.getElementById('machine-id').value) {
        document.getElementById('machine-form').reset();
        document.getElementById('machine-id').value = "";
        document.getElementById('machine-modal-title').textContent = "Register Machine";
        document.getElementById('machine-interval').value = 500;
    } else if (modalId === 'spare-modal' && !document.getElementById('spare-id').value) {
        document.getElementById('spare-form').reset();
        document.getElementById('spare-id').value = "";
        document.getElementById('spare-modal-title').textContent = "Register Spare Part";
    } else if (modalId === 'repair-modal' && !document.getElementById('repair-id').value) {
        document.getElementById('repair-form').reset();
        document.getElementById('repair-id').value = "";
        document.getElementById('repair-modal-title').textContent = "Record Machinery Repair Job";
        modalConsumedSpares = [];
        renderModalConsumedSparesList();
        populateRepairSpareDropdown();
    } else if (modalId === 'quick-stock-modal') {
        populateQuickStockDropdown();
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    // Clear editing references
    if (modalId === 'unload-modal') document.getElementById('unload-id').value = "";
    if (modalId === 'sales-modal') document.getElementById('sales-id').value = "";
    if (modalId === 'customer-modal') document.getElementById('cust-id').value = "";
    if (modalId === 'supplier-modal') document.getElementById('supp-id').value = "";
    if (modalId === 'production-modal') document.getElementById('prod-log-id').value = "";
    if (modalId === 'spare-modal') document.getElementById('spare-id').value = "";
    if (modalId === 'repair-modal') document.getElementById('repair-id').value = "";
}

function populateMachineFilters() {
    const repairFilter = document.getElementById('filter-repair-machine');
    if (!repairFilter) return;
    const currentVal = repairFilter.value;
    
    const machines = new Set();
    state.maintenanceLogs.forEach(log => {
        if (log.machine) machines.add(log.machine.trim());
    });
    
    repairFilter.innerHTML = '<option value="">All Machinery</option>';
    Array.from(machines).sort().forEach(mac => {
        const opt = document.createElement('option');
        opt.value = mac;
        opt.textContent = mac;
        repairFilter.appendChild(opt);
    });
    
    if (machines.has(currentVal)) {
        repairFilter.value = currentVal;
    }
}

function renderMaintenanceKPIs() {
    if (!document.getElementById('maintenance-kpis')) return;

    // 1. Total Machinery Tracked
    const machines = new Set();
    state.maintenanceLogs.forEach(log => {
        if (log.machine) machines.add(log.machine.trim());
    });
    state.spareParts.forEach(part => {
        if (part.machine) machines.add(part.machine.trim());
    });
    const totalMachines = machines.size;
    document.getElementById('maint-kpi-total-machines').textContent = totalMachines;

    // 2. Active Breakdowns
    const activeBreakdowns = state.maintenanceLogs.filter(log => log.status === 'Pending' || log.status === 'In-progress').length;
    document.getElementById('maint-kpi-active-breakdowns').textContent = activeBreakdowns;
    
    const activeMeta = document.getElementById('maint-kpi-active-breakdowns-meta');
    if (activeMeta) {
        activeMeta.textContent = activeBreakdowns === 0 ? "All machines running" : "Needs immediate repair";
    }

    // 3. Low Spares Alert
    const lowSparesCount = state.spareParts.filter(p => p.stock <= p.minLevel).length;
    document.getElementById('maint-kpi-low-spares').textContent = lowSparesCount;

    // 4. Maintenance Cost YTD
    const totalCost = state.maintenanceLogs.reduce((sum, log) => sum + (parseFloat(log.totalCost) || 0), 0);
    document.getElementById('maint-kpi-total-cost').textContent = `₹${totalCost.toLocaleString('en-IN')}`;
}

// --- RENDERING VIEWS ---
function renderAllViews() {
    populateMachineFilters();
    renderDashboardKPIs();
    renderUnloadTable();
    renderSalesTable();
    renderCustomersTable();
    renderSuppliersTable();
    renderProductionTable();
    renderRefiningTable();
    renderPartyAccounts();
    renderStockStatement();
    renderSparesTable();
    renderRepairsTable();
    renderMaintenanceKPIs();
    renderMachineSchedule();
    renderTransportTable();
    renderTransportKPIs();
    populateSupplierSelects();
    renderInvoicesArchive();
    renderGSTSummary();
    populateSupplierDropdowns();
    populateSalesCustomersDropdown();
    populateLedgerPartyDropdown();
    populateAutocompleteDatalists();

    // Re-draw charts in real-time if on the dashboard tab
    const dashboardTab = document.getElementById('dashboard');
    if (dashboardTab && dashboardTab.classList.contains('active')) {
        renderCharts();
    }
}

// --- 1. DASHBOARD CONTROLLER ---
function renderDashboardKPIs() {
    // KPI 1: Sales Revenue (Monthly)
    const totalSalesRev = state.sales.reduce((sum, item) => sum + (parseFloat(item.weight || 0) * parseFloat(item.rate || 0)), 0);
    const totalSalesVolume = state.sales.reduce((sum, item) => sum + parseFloat(item.weight || 0), 0);
    
    const elRev = document.getElementById('kpi-sales-revenue');
    if (elRev) elRev.textContent = `₹${totalSalesRev.toLocaleString('en-IN', {maximumFractionDigits: 0})}`;
    const elVol = document.getElementById('kpi-sales-volume');
    if (elVol) elVol.textContent = `${totalSalesVolume.toFixed(2)} Qtl Sold`;
    
    // KPI 2: Oil Stock Status
    const monthKey = '2026-06';
    const crudeCalculated = getProductClosingStock('oil-crude', monthKey);
    const gaadCalculated = getProductClosingStock('oil-gaad', monthKey);
    const washCalculated = getProductClosingStock('oil-wash', monthKey);
    
    const elCrude = document.getElementById('kpi-oil-stock');
    if (elCrude) elCrude.textContent = `${crudeCalculated.toFixed(2)} Qtl`;
    const elGaad = document.getElementById('kpi-gaad-stock');
    if (elGaad) elGaad.textContent = gaadCalculated.toFixed(2);
    const elWash = document.getElementById('kpi-wash-stock');
    if (elWash) elWash.textContent = washCalculated.toFixed(2);

    // KPI 3: Low stock spares
    const lowSpares = state.spareParts.filter(p => p.stock <= p.minLevel).length;
    const elLow = document.getElementById('kpi-low-spares');
    if (elLow) elLow.textContent = lowSpares;
    
    // KPI 4: Pending repairs
    const pendingRepairs = state.maintenanceLogs.filter(r => r.status !== 'Completed').length;
    const elPend = document.getElementById('kpi-pending-repairs');
    if (elPend) elPend.textContent = pendingRepairs;

    // Load recent unloads (last 5)
    const recentUnloadsTbody = document.getElementById('recent-unloads-tbody');
    if (recentUnloadsTbody) {
        recentUnloadsTbody.innerHTML = '';
        const sorted = [...state.unloads].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        
        if (sorted.length === 0) {
            recentUnloadsTbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No unloads logged yet.</td></tr>`;
        } else {
            sorted.forEach(item => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${formatDateString(item.date)}</td>
                    <td><strong class="font-bold">${item.supplier}</strong></td>
                    <td><code>${item.lorryNo}</code></td>
                    <td>${parseFloat(item.weight).toFixed(2)} Qtl</td>
                    <td>₹${parseFloat(item.forRate).toLocaleString('en-IN')}</td>
                `;
                recentUnloadsTbody.appendChild(tr);
            });
        }
    }

    // Load urgent spare parts
    const urgentSparesTbody = document.getElementById('urgent-spares-tbody');
    if (urgentSparesTbody) {
        urgentSparesTbody.innerHTML = '';
        const urgent = state.spareParts.filter(p => p.stock <= p.minLevel);
        
        if (urgent.length === 0) {
            urgentSparesTbody.innerHTML = `<tr><td colspan="5" class="text-center text-success font-bold"><i class="fa-solid fa-circle-check"></i> All spare levels healthy.</td></tr>`;
        } else {
            urgent.slice(0, 5).forEach(part => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${part.name}</strong></td>
                    <td>${part.machine}</td>
                    <td><span class="text-danger font-bold">${part.stock} ${part.unit}</span></td>
                    <td>${part.minLevel} ${part.unit}</td>
                    <td><button class="btn btn-secondary btn-sm" onclick="switchTab('spares'); document.getElementById('search-spare').value='${part.name}'; renderSparesTable();">Procure</button></td>
                `;
                urgentSparesTbody.appendChild(tr);
            });
        }
    }
}

// --- 2. RAW MATERIAL UNLOADS CONTROLLER ---
function renderUnloadTable(searchQuery = '') {
    const tbody = document.getElementById('unload-tbody');
    tbody.innerHTML = '';
    
    const supplierFilter = document.getElementById('filter-unload-supplier').value;
    const placeFilter = document.getElementById('filter-unload-place').value.toLowerCase();
    const lorryFilter = document.getElementById('filter-unload-lorry').value.toLowerCase();
    
    // Filter data
    const filtered = state.unloads.filter(item => {
        const matchesSearch = !searchQuery || 
                              item.supplier.toLowerCase().includes(searchQuery) ||
                              item.place.toLowerCase().includes(searchQuery) ||
                              item.lorryNo.toLowerCase().includes(searchQuery) ||
                              (item.remark && item.remark.toLowerCase().includes(searchQuery));
        
        const matchesSupplier = !supplierFilter || item.supplier === supplierFilter;
        const matchesPlace = !placeFilter || item.place.toLowerCase().includes(placeFilter);
        const matchesLorry = !lorryFilter || item.lorryNo.toLowerCase().includes(lorryFilter);
        
        return matchesSearch && matchesSupplier && matchesPlace && matchesLorry;
    });

    // Populate supplier dropdown option
    updateSupplierFilters();

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="16" class="text-center text-muted py-4">No matching raw material unloads found.</td></tr>`;
        return;
    }

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = item.billed ? 'bg-billed-subtle text-muted' : '';
        
        const invWeight = item.invoiceWeight !== undefined ? item.invoiceWeight : item.weight;
        const shortage = item.shortage !== undefined ? item.shortage : 0;
        const discount = item.discount || 0;
        const gstRate = item.gstRate !== undefined ? item.gstRate : 5;
        const qualityText = item.quality ? `<span class="badge badge-secondary text-xs" style="margin-right: 4px; padding: 2px 6px; border-radius: 4px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); font-size: 0.72rem;">${escapeHtml(item.quality)}</span>` : '';
        
        let statusBadge = '';
        if (item.status === 'Rejected') {
            statusBadge = `<span class="badge badge-danger" style="margin-left: 6px; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);">Rejected</span>`;
        } else if (item.status === 'Returned') {
            statusBadge = `<span class="badge badge-warning" style="margin-left: 6px; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">Returned</span>`;
        }
        
        tr.innerHTML = `
            <td>
                <input type="checkbox" class="unload-row-checkbox" data-id="${item.id}" onchange="updateSelectedLorriesCount()" ${item.billed ? 'disabled' : ''}>
            </td>
            <td style="font-family: monospace; color: var(--text-secondary); text-align: center; font-weight: bold;">${index + 1}</td>
            <td>${formatDateString(item.date)}</td>
            <td><strong>${item.supplier}</strong>${statusBadge}</td>
            <td>${item.place}</td>
            <td><code>${item.lorryNo}</code></td>
            <td style="font-size: 0.88rem; font-family: monospace;">${parseFloat(invWeight).toFixed(2)} / <strong class="text-primary">${parseFloat(item.weight).toFixed(2)}</strong></td>
            <td class="${shortage > 0 ? 'text-danger font-bold' : ''}" style="font-family: monospace;">${shortage > 0 ? shortage.toFixed(2) : '-'}</td>
            <td>₹${parseFloat(item.rate).toLocaleString('en-IN')}</td>
            <td>₹${parseFloat(item.freight).toLocaleString('en-IN')}</td>
            <td>${discount > 0 ? '₹' + discount : '-'}</td>
            <td>${gstRate}%</td>
            <td><strong class="text-success">₹${parseFloat(item.forRate).toLocaleString('en-IN')}</strong></td>
            <td>${item.location || '-'}</td>
            <td><small class="text-muted" style="display: flex; align-items: center; gap: 4px; flex-wrap: wrap;">${qualityText}${escapeHtml(item.remark || '-')}</small></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editUnload('${item.id}')" title="Edit Entry"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteUnload('${item.id}')" title="Delete Entry"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function updateSupplierFilters() {
    const select = document.getElementById('filter-unload-supplier');
    const currentVal = select.value;
    
    // Get unique suppliers
    const suppliers = [...new Set(state.unloads.map(u => u.supplier))].sort();
    
    select.innerHTML = '<option value="">All Suppliers</option>';
    suppliers.forEach(sup => {
        const option = document.createElement('option');
        option.value = sup;
        option.textContent = sup;
        select.appendChild(option);
    });
    
    select.value = currentVal;
}

function updateSelectedLorriesCount() {
    const selected = document.querySelectorAll('.unload-row-checkbox:checked').length;
    document.getElementById('selected-lorries-count').textContent = `${selected} items selected`;
    
    const bulkBtn = document.getElementById('bulk-bill-btn');
    if (selected > 0) {
        bulkBtn.removeAttribute('disabled');
    } else {
        bulkBtn.setAttribute('disabled', 'true');
    }
}

function handleUnloadSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('unload-id').value;
    const date = document.getElementById('unload-date').value;
    const supplier = document.getElementById('unload-supplier').value;
    const place = document.getElementById('unload-place').value;
    const lorryNo = document.getElementById('unload-lorry').value;
    
    const invoiceWeight = parseFloat(document.getElementById('unload-invoice-weight').value) || 0;
    const weight = parseFloat(document.getElementById('unload-weight').value) || 0; // receivedWeight
    const shortage = parseFloat((invoiceWeight - weight).toFixed(2));
    
    const rate = parseFloat(document.getElementById('unload-rate').value);
    const freight = parseFloat(document.getElementById('unload-freight').value);
    
    let forRate = parseFloat(document.getElementById('unload-for').value);
    if (isNaN(forRate) || !forRate) {
        forRate = rate + freight;
    }
    
    const discount = parseFloat(document.getElementById('unload-discount').value) || 0;
    const gstRate = parseFloat(document.getElementById('unload-gst-rate').value) || 0;
    
    const location = document.getElementById('unload-location').value;
    const seedType = document.getElementById('unload-seed-type').value;
    const status = document.getElementById('unload-status').value;
    const quality = document.getElementById('unload-quality').value.trim();
    const remark = document.getElementById('unload-remark').value;
    
    const bagType = document.getElementById('unload-bag-select').value;
    const bagQty = parseInt(document.getElementById('unload-bag-qty').value) || 0;
    const bagRate = parseFloat(document.getElementById('unload-bag-rate').value) || 0;

    const data = { 
        date, supplier, place, lorryNo, 
        invoiceWeight, weight, shortage, 
        rate, freight, forRate, discount, gstRate, 
        location, seedType, status, quality, remark, 
        bagType, bagQty, bagRate 
    };

    if (id) {
        // Edit mode
        const index = state.unloads.findIndex(u => u.id === id);
        if (index !== -1) {
            removeUnloadFromStockLedger(state.unloads[index]);
            state.unloads[index] = { ...state.unloads[index], ...data };
            addUnloadToStockLedger(state.unloads[index]);
        }
    } else {
        // New mode
        data.id = 'unl-' + Date.now();
        data.billed = false;
        state.unloads.push(data);
        addUnloadToStockLedger(data);
    }

    saveState();
    closeModal('unload-modal');
    // Clear filters to ensure visibility
    const fUnlSup = document.getElementById('filter-unload-supplier');
    if (fUnlSup) fUnlSup.value = "";
    const fUnlPlc = document.getElementById('filter-unload-place');
    if (fUnlPlc) fUnlPlc.value = "";
    const fUnlLry = document.getElementById('filter-unload-lorry');
    if (fUnlLry) fUnlLry.value = "";
    
    renderAllViews();
    alert("Purchase load entry saved!");
}

function editUnload(id) {
    const item = state.unloads.find(u => u.id === id);
    if (!item) return;

    populateSupplierDropdowns();

    document.getElementById('unload-id').value = item.id;
    document.getElementById('unload-date').value = item.date;
    document.getElementById('unload-supplier').value = item.supplier;
    document.getElementById('unload-place').value = item.place;
    document.getElementById('unload-lorry').value = item.lorryNo;
    
    document.getElementById('unload-invoice-weight').value = item.invoiceWeight !== undefined ? item.invoiceWeight : item.weight;
    document.getElementById('unload-weight').value = item.weight;
    document.getElementById('unload-rate').value = item.rate;
    document.getElementById('unload-freight').value = item.freight;
    document.getElementById('unload-for').value = item.forRate;
    
    document.getElementById('unload-discount').value = item.discount || 0;
    document.getElementById('unload-gst-rate').value = item.gstRate !== undefined ? item.gstRate : 5;
    
    document.getElementById('unload-location').value = item.location || '';
    document.getElementById('unload-seed-type').value = item.seedType || 'OMS';
    document.getElementById('unload-status').value = item.status || 'Standard';
    document.getElementById('unload-quality').value = item.quality || '';
    
    document.getElementById('unload-bag-select').value = item.bagType || '';
    document.getElementById('unload-bag-qty').value = item.bagQty || '';
    document.getElementById('unload-bag-rate').value = item.bagRate || '';
    document.getElementById('unload-remark').value = item.remark || '';

    document.getElementById('unload-modal-title').textContent = "Edit Lorry Load Entry";
    openModal('unload-modal');
}

function deleteUnload(id) {
    if (confirm("Are you sure you want to delete this unload entry?")) {
        const unloadToDelete = state.unloads.find(u => u.id === id);
        
        // Remove from Stock Statement if it contributed to receipt totals
        if (unloadToDelete) {
            removeUnloadFromStockLedger(unloadToDelete);
        }

        state.unloads = state.unloads.filter(u => u.id !== id);
        saveState();
        renderAllViews();
    }
}

// Add Weight as Receipt into Stock Ledger automatically on new load
function addUnloadToStockLedger(unload) {
    if (unload.status === 'Rejected' || unload.status === 'Returned') return;
    const dateObj = new Date(unload.date);
    if (isNaN(dateObj.getTime())) return;
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = dateObj.getDate();
    
    const monthKey = `${year}-${month}`;
    
    // Auto switch month selector
    const stockMonthSel = document.getElementById('stock-month-selector');
    if (stockMonthSel) {
        let exists = false;
        for (let i = 0; i < stockMonthSel.options.length; i++) {
            if (stockMonthSel.options[i].value === monthKey) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = monthKey;
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            opt.textContent = `${monthNames[dateObj.getMonth()]} ${year}`;
            stockMonthSel.appendChild(opt);
        }
        stockMonthSel.value = monthKey;
    }

    // Determine Seed Type OMS vs MS
    let productKey = 'cs-oms';
    if (unload.seedType) {
        productKey = unload.seedType === 'MS' ? 'cs-ms' : 'cs-oms';
    } else {
        if (unload.supplier.toLowerCase().includes('(ms)') || unload.remark.toLowerCase().includes('ms')) {
            productKey = 'cs-ms';
        }
    }

    if (!state.stockDaily[monthKey]) state.stockDaily[monthKey] = {};

    // Raw seed receipts are dynamically calculated in getDayLog.
    // Only track Inbound Bardan packaging bag receipt in stockDaily:
    if (unload.bagType && unload.bagQty > 0) {
        const bagKey = unload.bagType;
        if (!state.stockDaily[monthKey][bagKey]) state.stockDaily[monthKey][bagKey] = {};
        if (!state.stockDaily[monthKey][bagKey][day]) {
            state.stockDaily[monthKey][bagKey][day] = { receipt: 0, issue: 0 };
        }
        state.stockDaily[monthKey][bagKey][day].receipt += parseInt(unload.bagQty) || 0;
    }
}

function removeUnloadFromStockLedger(unload) {
    if (unload.status === 'Rejected' || unload.status === 'Returned') return;
    const dateObj = new Date(unload.date);
    if (isNaN(dateObj.getTime())) return;
    const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    const day = dateObj.getDate();
    
    let productKey = 'cs-oms';
    if (unload.seedType) {
        productKey = unload.seedType === 'MS' ? 'cs-ms' : 'cs-oms';
    } else {
        if (unload.supplier.toLowerCase().includes('(ms)') || unload.remark.toLowerCase().includes('ms')) {
            productKey = 'cs-ms';
        }
    }

    if (state.stockDaily[monthKey]) {
        // Raw seed receipts are dynamic, only reverse Bardan packaging bag receipt:
        if (unload.bagType && unload.bagQty > 0) {
            const bagKey = unload.bagType;
            if (state.stockDaily[monthKey][bagKey] && state.stockDaily[monthKey][bagKey][day]) {
                state.stockDaily[monthKey][bagKey][day].receipt -= parseInt(unload.bagQty) || 0;
                if (state.stockDaily[monthKey][bagKey][day].receipt < 0) {
                    state.stockDaily[monthKey][bagKey][day].receipt = 0;
                }
            }
        }
    }
}

// --- 3. STOCK STATEMENT CONTROLLER ---
function renderStockStatement() {
    const monthKey = document.getElementById('stock-month-selector').value;
    const daysInMonth = getDaysInMonth(monthKey);
    
    // Render Day Header columns
    const daysHeaderRow = document.getElementById('days-header-row');
    daysHeaderRow.innerHTML = '';
    for (let d = 1; d <= 31; d++) {
        const th = document.createElement('th');
        th.textContent = d;
        if (d > daysInMonth) {
            th.className = 'text-muted bg-dark-subtle';
            th.style.opacity = '0.3';
        }
        daysHeaderRow.appendChild(th);
    }

    // Render Tbody rows
    const tbody = document.getElementById('stock-tbody');
    tbody.innerHTML = '';

    PRODUCTS.forEach((prod, index) => {
        const tr = document.createElement('tr');
        
        // Calculate Opening Stock
        const opStock = getProductOpeningStock(prod.id, monthKey);
        
        // Get dynamic Receipt/Issue totals
        let totalReceipt = 0;
        let totalIssue = 0;
        
        // Generate daily cells
        let dailyCellsHtml = '';
        for (let d = 1; d <= 31; d++) {
            let cellVal = '-';
            let cellClass = 'ledger-qty-cell';
            
            if (d > daysInMonth) {
                cellVal = '';
                cellClass = 'bg-dark-subtle';
            } else {
                const dayLog = getDayLog(prod.id, monthKey, d);
                if (dayLog.receipt > 0 || dayLog.issue > 0) {
                    // Show receipt / issue in compact format, e.g. "R: 120" or "I: 50" or "R:20\nI:10"
                    let parts = [];
                    if (dayLog.receipt > 0) {
                        parts.push(`R:${dayLog.receipt.toFixed(0)}`);
                        totalReceipt += dayLog.receipt;
                    }
                    if (dayLog.issue > 0) {
                        parts.push(`I:${dayLog.issue.toFixed(0)}`);
                        totalIssue += dayLog.issue;
                    }
                    cellVal = parts.join('<br>');
                    cellClass += ' has-val';
                }
            }

            dailyCellsHtml += `<td class="${cellClass}" onclick="editDayStockValue('${prod.id}', ${d})">${cellVal}</td>`;
        }

        const closingStock = opStock + totalReceipt - totalIssue;
        const closingClass = closingStock < 0 ? 'negative-stock total-col' : 'total-col';

        tr.innerHTML = `
            <td class="sticky-col first-col">${index + 1}</td>
            <td class="sticky-col second-col">${prod.name}</td>
            <td class="font-bold">${opStock.toFixed(2)}</td>
            <td class="text-success">${totalReceipt > 0 ? totalReceipt.toFixed(2) : '-'}</td>
            <td class="text-danger">${totalIssue > 0 ? totalIssue.toFixed(2) : '-'}</td>
            <td class="${closingClass}">${closingStock.toFixed(2)}</td>
            ${dailyCellsHtml}
            <td class="total-col">${(totalReceipt + totalIssue).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    // Populate overall total calculations under table footer
    calculateFooterTotals(monthKey);
}

// Calculate Opening Stock based on previous month closing
function getProductOpeningStock(prodId, monthKey) {
    if (!monthKey || typeof monthKey !== 'string' || !monthKey.includes('-')) {
        return INITIAL_OPENING_STOCKS[prodId] || 0.00;
    }
    const parts = monthKey.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    
    if (isNaN(year) || isNaN(month)) {
        return INITIAL_OPENING_STOCKS[prodId] || 0.00;
    }
    
    // Safety check: if before or equal to base month (June 2026), return initial values
    if (year < 2026 || (year === 2026 && month <= 6)) {
        return INITIAL_OPENING_STOCKS[prodId] || 0.00;
    }
    
    // Otherwise, it is the Closing Stock of the previous month
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth === 0) {
        prevMonth = 12;
        prevYear -= 1;
    }
    const prevMonthKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
    
    // Recurse to find previous closing stock
    const prevOp = getProductOpeningStock(prodId, prevMonthKey);
    
    // Sum receipts/issues in prev month
    let receipts = 0;
    let issues = 0;
    const days = getDaysInMonth(prevMonthKey);
    for (let d = 1; d <= days; d++) {
        const dayLog = getDayLog(prodId, prevMonthKey, d);
        receipts += dayLog.receipt;
        issues += dayLog.issue;
    }
    
    return prevOp + receipts - issues;
}

function getProductClosingStock(prodId, monthKey) {
    const op = getProductOpeningStock(prodId, monthKey);
    let receipts = 0;
    let issues = 0;
    const days = getDaysInMonth(monthKey);
    for (let d = 1; d <= days; d++) {
        const dayLog = getDayLog(prodId, monthKey, d);
        receipts += dayLog.receipt;
        issues += dayLog.issue;
    }
    return op + receipts - issues;
}

function getDayLog(prodId, monthKey, day) {
    let receipt = 0;
    let issue = 0;

    const dayStr = day < 10 ? '0' + day : '' + day;
    const dateStr = `${monthKey}-${dayStr}`;

    // 1. Raw Cotton Seed / Kandi unloads (Receipts)
    if (prodId === 'cs-oms' || prodId === 'cs-ms' || prodId === 'kandi') {
        let targetType;
        if (prodId === 'cs-ms') targetType = 'MS';
        else if (prodId === 'cs-oms') targetType = 'OMS';
        else targetType = 'Kandi';

        state.unloads.forEach(u => {
            if (u.date === dateStr && u.status !== 'Rejected' && u.status !== 'Returned') {
                const uType = u.seedType || 'OMS';
                if (uType === targetType) {
                    receipt += parseFloat(u.weight) || 0;
                }
            }
        });
    }

    // 2. Production issues & finished goods receipts
    state.productionLogs.forEach(p => {
        if (p.date === dateStr) {
            // Issues: raw cotton seed / Kandi issued to crushing
            if (prodId === 'cs-oms' || prodId === 'cs-ms' || prodId === 'kandi') {
                const parentUnload = state.unloads.find(u => u.id === p.unloadId);
                const uType = parentUnload ? (parentUnload.seedType || 'OMS') : 'OMS';
                let targetType;
                if (prodId === 'cs-ms') targetType = 'MS';
                else if (prodId === 'cs-oms') targetType = 'OMS';
                else targetType = 'Kandi';

                if (uType === targetType) {
                    issue += parseFloat(p.weight) || 0;
                }
            }
            // Receipts: finished goods yielded from production.
            // Crushing the seed yields CRUDE oil (which is later refined into wash oil + gaad).
            if (prodId === 'oil-crude') {
                receipt += parseFloat(p.oilYield) || 0;
            }
            if (prodId === 'khal-mm' || prodId === 'khal-km') {
                const parentUnload = state.unloads.find(u => u.id === p.unloadId);
                const uType = parentUnload ? (parentUnload.seedType || 'OMS') : 'OMS';
                const targetType = prodId === 'khal-mm' ? 'MS' : 'OMS';
                if (uType === targetType) {
                    receipt += parseFloat(p.cakeYield) || 0;
                }
            }
            if (prodId === 'ch-oms' || prodId === 'ch-ms') {
                const parentUnload = state.unloads.find(u => u.id === p.unloadId);
                const uType = parentUnload ? (parentUnload.seedType || 'OMS') : 'OMS';
                const targetType = prodId === 'ch-ms' ? 'MS' : 'OMS';
                if (uType === targetType) {
                    receipt += parseFloat(p.hullsYield) || 0;
                }
            }
        }
    });

    // 2B. Refining runs: crude oil is CONSUMED (issue) and refined into wash oil + acid oil + gaad (receipts)
    state.refiningLogs.forEach(r => {
        if (r.batches && Array.isArray(r.batches)) {
            r.batches.forEach(b => {
                if (b.date === dateStr) {
                    if (prodId === 'oil-crude') issue += parseFloat(b.crudeInput) || 0;
                    if (prodId === 'oil-wash') receipt += parseFloat(b.washYield) || 0;
                    if (prodId === 'oil-gaad') receipt += parseFloat(b.gaadYield) || 0;
                    if (prodId === 'oil-acid') receipt += parseFloat(b.acidYield) || 0;
                }
            });
        } else {
            // Legacy flat structure
            if (r.date === dateStr) {
                if (prodId === 'oil-crude') issue += parseFloat(r.crudeInput) || 0;
                if (prodId === 'oil-wash') receipt += parseFloat(r.washYield) || 0;
                if (prodId === 'oil-gaad') receipt += parseFloat(r.gaadYield) || 0;
                if (prodId === 'oil-acid') receipt += parseFloat(r.acidYield) || 0;
            }
        }
    });

    // 3. Sales dispatches (Issues of finished goods)
    state.sales.forEach(s => {
        if (s.date === dateStr && s.status !== 'Rejected' && s.status !== 'Returned') {
            if (s.product === prodId) {
                issue += parseFloat(s.weight) || 0;
            }
        }
    });

    // 3B. Packaging bags (Bardan) dynamic calculations
    const prodObj = PRODUCTS.find(p => p.id === prodId);
    if (prodObj && prodObj.category === 'Bardan') {
        // Inbound bag receipts from unloads
        state.unloads.forEach(u => {
            if (u.date === dateStr && u.status !== 'Rejected' && u.status !== 'Returned') {
                if (u.bagType === prodId && u.bagQty > 0) {
                    receipt += parseInt(u.bagQty) || 0;
                }
            }
        });
        // Outbound bag issues from sales
        state.sales.forEach(s => {
            if (s.date === dateStr && s.status !== 'Rejected' && s.status !== 'Returned') {
                if (s.bagType === prodId && s.bagQty > 0) {
                    issue += parseInt(s.bagQty) || 0;
                }
            }
        });
    }

    // 4. Manual adjustments (overrides) - if exists, it replaces the dynamic calculations completely
    if (state.stockDaily[monthKey] && 
        state.stockDaily[monthKey][prodId] && 
        state.stockDaily[monthKey][prodId][day] !== undefined) {
        const manual = state.stockDaily[monthKey][prodId][day];
        return {
            receipt: parseFloat(manual.receipt) || 0,
            issue: parseFloat(manual.issue) || 0
        };
    }

    return { receipt, issue };
}

function editDayStockValue(prodId, day) {
    const monthKey = document.getElementById('stock-month-selector').value;
    const dayLog = getDayLog(prodId, monthKey, day);
    
    document.getElementById('qs-product').value = prodId;
    document.getElementById('qs-day').value = day;
    document.getElementById('qs-receipt').value = dayLog.receipt;
    document.getElementById('qs-issue').value = dayLog.issue;

    openModal('quick-stock-modal');
}

function handleQuickStockSubmit(e) {
    e.preventDefault();
    const monthKey = document.getElementById('stock-month-selector').value;
    const prodId = document.getElementById('qs-product').value;
    const day = parseInt(document.getElementById('qs-day').value);
    const receipt = parseFloat(document.getElementById('qs-receipt').value) || 0;
    const issue = parseFloat(document.getElementById('qs-issue').value) || 0;

    if (!state.stockDaily[monthKey]) state.stockDaily[monthKey] = {};
    if (!state.stockDaily[monthKey][prodId]) state.stockDaily[monthKey][prodId] = {};
    
    state.stockDaily[monthKey][prodId][day] = { receipt, issue };
    
    saveState();
    closeModal('quick-stock-modal');
    renderStockStatement();
    renderDashboardKPIs(); // KPIs rely on stock calculations too
}

function populateQuickStockDropdown() {
    const select = document.getElementById('qs-product');
    select.innerHTML = '';
    PRODUCTS.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

function calculateFooterTotals(monthKey) {
    // Cotton Seed receipts total sum
    let totOpSeed = 0;
    let totRecSeed = 0;
    let totIssSeed = 0;
    let totClSeed = 0;

    // Khal receipts total sum
    let totOpKhal = 0;
    let totRecKhal = 0;
    let totIssKhal = 0;
    let totClKhal = 0;

    PRODUCTS.forEach(prod => {
        const op = getProductOpeningStock(prod.id, monthKey);
        let rec = 0;
        let iss = 0;
        for (let d = 1; d <= 31; d++) {
            const l = getDayLog(prod.id, monthKey, d);
            rec += l.receipt;
            iss += l.issue;
        }
        const cl = op + rec - iss;

        if (prod.category === 'Seed') {
            totOpSeed += op;
            totRecSeed += rec;
            totIssSeed += iss;
            totClSeed += cl;
        } else if (prod.category === 'Khal') {
            totOpKhal += op;
            totRecKhal += rec;
            totIssKhal += iss;
            totClKhal += cl;
        }
    });

    document.getElementById('tot-op-seed-rec').textContent = totOpSeed.toFixed(2);
    document.getElementById('tot-rec-seed-rec').textContent = totRecSeed.toFixed(2);
    document.getElementById('tot-iss-seed-rec').textContent = totIssSeed.toFixed(2);
    document.getElementById('tot-cl-seed-rec').textContent = totClSeed.toFixed(2);
    document.getElementById('tot-cl-seed-rec').className = totClSeed < 0 ? 'text-danger font-bold' : 'font-bold';

    document.getElementById('tot-op-khal-rec').textContent = totOpKhal.toFixed(2);
    document.getElementById('tot-rec-khal-rec').textContent = totRecKhal.toFixed(2);
    document.getElementById('tot-iss-khal-rec').textContent = totIssKhal.toFixed(2);
    document.getElementById('tot-cl-khal-rec').textContent = totClKhal.toFixed(2);
    document.getElementById('tot-cl-khal-rec').className = totClKhal < 0 ? 'text-danger font-bold' : 'font-bold';
}

function populateQuickStockDropdown() {
    const select = document.getElementById('qs-product');
    select.innerHTML = '';
    PRODUCTS.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
    });
}

// Helper to check days in a month
function getDaysInMonth(monthKey) {
    const parts = monthKey.split('-');
    const year = parseInt(parts[0]);
    const month = parseInt(parts[1]);
    return new Date(year, month, 0).getDate();
}

// --- 4. SPARE PARTS CONTROLLER ---
function renderSparesTable(searchQuery = '') {
    const tbody = document.getElementById('spares-tbody');
    tbody.innerHTML = '';

    const machineFilter = document.getElementById('filter-spare-machine').value;
    const statusFilter = document.getElementById('filter-spare-status').value;

    const filtered = state.spareParts.filter(part => {
        const matchesSearch = !searchQuery || 
                              part.name.toLowerCase().includes(searchQuery) ||
                              part.code.toLowerCase().includes(searchQuery);
        
        const matchesMachine = !machineFilter || part.machine === machineFilter;
        
        let matchesStatus = true;
        if (statusFilter === 'low') {
            matchesStatus = part.stock <= part.minLevel;
        } else if (statusFilter === 'ok') {
            matchesStatus = part.stock > part.minLevel;
        }

        return matchesSearch && matchesMachine && matchesStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No matching spare parts in inventory.</td></tr>`;
        return;
    }

    filtered.forEach((part, index) => {
        const isLow = part.stock <= part.minLevel;
        const statusBadge = isLow 
            ? `<span class="badge badge-danger">Reorder Alert</span>` 
            : `<span class="badge badge-success">In Stock</span>`;
            
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; color: var(--text-secondary); font-weight: bold; text-align: center;">${index + 1}</td>
            <td><code>${part.code}</code></td>
            <td><strong>${part.name}</strong></td>
            <td>${part.machine}</td>
            <td class="${isLow ? 'text-danger font-bold' : ''}">${part.stock} ${part.unit}</td>
            <td>${part.minLevel} ${part.unit}</td>
            <td>₹${parseFloat(part.cost).toLocaleString('en-IN')}</td>
            <td>₹${(part.stock * part.cost).toLocaleString('en-IN')}</td>
            <td>${statusBadge}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editSpare('${part.id}')" title="Edit Spare"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteSpare('${part.id}')" title="Delete Spare"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleSpareSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('spare-id').value;
    const code = document.getElementById('spare-code').value;
    const name = document.getElementById('spare-name').value;
    const machine = document.getElementById('spare-machine').value;
    const unit = document.getElementById('spare-unit').value;
    const stock = parseInt(document.getElementById('spare-stock').value) || 0;
    const minLevel = parseInt(document.getElementById('spare-min').value) || 0;
    const cost = parseFloat(document.getElementById('spare-cost').value) || 0;

    const data = { code, name, machine, unit, stock, minLevel, cost };

    if (id) {
        const idx = state.spareParts.findIndex(p => p.id === id);
        if (idx !== -1) {
            state.spareParts[idx] = { ...state.spareParts[idx], ...data };
        }
    } else {
        data.id = 'spr-' + Date.now();
        state.spareParts.push(data);
    }

    saveState();
    closeModal('spare-modal');
    renderAllViews();
}

function editSpare(id) {
    const item = state.spareParts.find(p => p.id === id);
    if (!item) return;

    document.getElementById('spare-id').value = item.id;
    document.getElementById('spare-code').value = item.code;
    document.getElementById('spare-name').value = item.name;
    document.getElementById('spare-machine').value = item.machine;
    document.getElementById('spare-unit').value = item.unit;
    document.getElementById('spare-stock').value = item.stock;
    document.getElementById('spare-min').value = item.minLevel;
    document.getElementById('spare-cost').value = item.cost;

    document.getElementById('spare-modal-title').textContent = "Edit Spare Part Details";
    openModal('spare-modal');
}

function deleteSpare(id) {
    if (confirm("Are you sure you want to delete this spare part record?")) {
        state.spareParts = state.spareParts.filter(p => p.id !== id);
        saveState();
        renderAllViews();
    }
}

// --- 5. MAINTENANCE & REPAIR CONTROLLER ---
function renderRepairsTable() {
    const tbody = document.getElementById('repairs-tbody');
    tbody.innerHTML = '';

    const machineFilter = document.getElementById('filter-repair-machine').value;
    const typeFilter = document.getElementById('filter-repair-type').value;
    const statusFilter = document.getElementById('filter-repair-status').value;

    const filtered = state.maintenanceLogs.filter(log => {
        const matchesMachine = !machineFilter || log.machine.includes(machineFilter);
        const matchesType = !typeFilter || log.type === typeFilter;
        const matchesStatus = !statusFilter || log.status === statusFilter;
        return matchesMachine && matchesType && matchesStatus;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No maintenance logs found matching criteria.</td></tr>`;
        return;
    }

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach((log, index) => {
        let statusClass = 'badge-success';
        if (log.status === 'In-progress') statusClass = 'badge-warning';
        if (log.status === 'Pending') statusClass = 'badge-danger';
        
        // Formulate spares text
        let sparesText = '-';
        if (log.sparesUsed && log.sparesUsed.length > 0) {
            sparesText = log.sparesUsed.map(s => `${s.name} (x${s.qty})`).join(', ');
        }

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; color: var(--text-secondary); font-weight: bold; text-align: center;">${index + 1}</td>
            <td>${formatDateString(log.date)}</td>
            <td><strong>${log.machine}</strong></td>
            <td><span class="badge badge-info">${log.type}</span></td>
            <td><small>${log.desc}</small></td>
            <td><span class="text-xs">${sparesText}</span></td>
            <td>${log.engineer}</td>
            <td><strong>₹${parseFloat(log.totalCost).toLocaleString('en-IN')}</strong></td>
            <td><span class="badge ${statusClass}">${log.status}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editRepair('${log.id}')" title="Edit Log"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteRepair('${log.id}')" title="Delete Log"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function populateRepairSpareDropdown() {
    const select = document.getElementById('repair-spare-select');
    select.innerHTML = '<option value="">-- No Spare Part Used --</option>';
    
    // Sort spares in stock first
    const sortedSpares = [...state.spareParts].sort((a,b) => b.stock - a.stock);
    
    sortedSpares.forEach(part => {
        const option = document.createElement('option');
        option.value = part.id;
        option.textContent = `${part.name} (${part.stock} available @ ₹${part.cost})`;
        select.appendChild(option);
    });
}

function renderModalConsumedSparesList() {
    const container = document.getElementById('consumed-parts-list-display');
    container.innerHTML = '';
    
    if (modalConsumedSpares.length === 0) {
        container.innerHTML = '<span class="text-muted text-xs">No spare parts added to this repair.</span>';
        return;
    }

    modalConsumedSpares.forEach((item, index) => {
        const tag = document.createElement('span');
        tag.className = 'consumed-part-tag';
        tag.innerHTML = `
            ${item.name} x${item.qty} (₹${(item.qty * item.cost).toLocaleString('en-IN')})
            <button type="button" onclick="removeConsumedSpareFromModal(${index})">&times;</button>
        `;
        container.appendChild(tag);
    });
}

function removeConsumedSpareFromModal(index) {
    modalConsumedSpares.splice(index, 1);
    renderModalConsumedSparesList();
}

function handleRepairSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('repair-id').value;
    const date = document.getElementById('repair-date').value;
    const machine = document.getElementById('repair-machine').value;
    const type = document.getElementById('repair-type').value;
    const status = document.getElementById('repair-status').value;
    const engineer = document.getElementById('repair-engineer').value;
    const serviceCost = parseFloat(document.getElementById('repair-service-cost').value) || 0;
    const desc = document.getElementById('repair-desc').value;

    // Calculate total cost (service cost + spares value)
    const sparesCost = modalConsumedSpares.reduce((sum, item) => sum + (item.qty * item.cost), 0);
    const totalCost = serviceCost + sparesCost;

    const data = {
        date,
        machine,
        type,
        status,
        engineer,
        serviceCost,
        desc,
        sparesUsed: modalConsumedSpares,
        totalCost
    };

    if (id) {
        // Edit log
        const oldLogIndex = state.maintenanceLogs.findIndex(l => l.id === id);
        if (oldLogIndex !== -1) {
            // Restore inventory of previously consumed spares before saving new edit
            const oldLog = state.maintenanceLogs[oldLogIndex];
            restoreInventorySpares(oldLog.sparesUsed);

            // Deduct new inventory spares
            deductInventorySpares(modalConsumedSpares);

            state.maintenanceLogs[oldLogIndex] = { ...state.maintenanceLogs[oldLogIndex], ...data };
        }
    } else {
        // New log
        data.id = 'rep-' + Date.now();
        
        // Deduct inventory spares
        deductInventorySpares(modalConsumedSpares);
        
        state.maintenanceLogs.push(data);
    }

    saveState();
    closeModal('repair-modal');
    renderAllViews();
}

function deductInventorySpares(sparesArray) {
    sparesArray.forEach(consumed => {
        const part = state.spareParts.find(p => p.id === consumed.partId);
        if (part) {
            part.stock -= consumed.qty;
            if (part.stock < 0) part.stock = 0;
        }
    });
}

function restoreInventorySpares(sparesArray) {
    sparesArray.forEach(consumed => {
        const part = state.spareParts.find(p => p.id === consumed.partId);
        if (part) {
            part.stock += consumed.qty;
        }
    });
}

function editRepair(id) {
    const item = state.maintenanceLogs.find(l => l.id === id);
    if (!item) return;

    document.getElementById('repair-id').value = item.id;
    document.getElementById('repair-date').value = item.date;
    document.getElementById('repair-machine').value = item.machine;
    document.getElementById('repair-type').value = item.type;
    document.getElementById('repair-status').value = item.status;
    document.getElementById('repair-engineer').value = item.engineer;
    document.getElementById('repair-service-cost').value = item.serviceCost;
    document.getElementById('repair-desc').value = item.desc;

    // Load spare parts used
    modalConsumedSpares = JSON.parse(JSON.stringify(item.sparesUsed || []));
    renderModalConsumedSparesList();
    populateRepairSpareDropdown();

    document.getElementById('repair-modal-title').textContent = "Edit Maintenance Job Log";
    openModal('repair-modal');
}

function deleteRepair(id) {
    if (confirm("Are you sure you want to delete this repair log? Replaced spares will be returned to inventory stock.")) {
        const log = state.maintenanceLogs.find(l => l.id === id);
        if (log) {
            // Return spares to stock
            restoreInventorySpares(log.sparesUsed);
        }
        state.maintenanceLogs = state.maintenanceLogs.filter(l => l.id !== id);
        saveState();
        renderAllViews();
    }
}

// --- 5B. TRANSPORT FLEET CONTROLLER ---
function adjustTransportFormFields() {
    const vehicle = document.getElementById('trans-vehicle').value;
    const type = document.getElementById('trans-type').value;
    const usageLabel = document.getElementById('trans-usage-label');
    const usageInput = document.getElementById('trans-usage');
    const dieselCostRow = document.getElementById('trans-diesel-cost-row');
    
    // Label change based on JCB vs Truck
    if (vehicle.includes('JCB')) {
        usageLabel.textContent = "Current Engine Hours (Hrs) *";
        usageInput.placeholder = "e.g. 1245.8";
    } else {
        usageLabel.textContent = "Current Odometer (KM) *";
        usageInput.placeholder = "e.g. 45012.5";
    }

    // Hide or show diesel inputs
    if (type === 'Maintenance') {
        dieselCostRow.style.display = 'flex';
        document.getElementById('trans-litres').value = 0;
        document.getElementById('trans-litres').parentElement.style.display = 'none';
        document.getElementById('trans-cost').placeholder = "e.g. 15000";
        document.getElementById('trans-cost').previousElementSibling.textContent = "Total Service/Repair Cost (₹) *";
    } else if (type === 'Usage') {
        dieselCostRow.style.display = 'none';
        document.getElementById('trans-litres').value = 0;
        document.getElementById('trans-cost').value = 0;
    } else { // Diesel Refuel
        dieselCostRow.style.display = 'flex';
        document.getElementById('trans-litres').parentElement.style.display = 'block';
        document.getElementById('trans-cost').placeholder = "e.g. 8000";
        document.getElementById('trans-cost').previousElementSibling.textContent = "Total Cost (₹)";
    }
}

function renderTransportTable() {
    const tbody = document.getElementById('transport-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const vehicleFilter = document.getElementById('filter-transport-vehicle').value;
    const typeFilter = document.getElementById('filter-transport-type').value;
    const monthFilter = document.getElementById('filter-transport-month').value;

    const filtered = state.transportLogs.filter(log => {
        const matchesVeh = !vehicleFilter || log.vehicle === vehicleFilter;
        const matchesTyp = !typeFilter || log.type === typeFilter;
        let matchesMth = true;
        if (monthFilter) {
            matchesMth = log.date.substring(0, 7) === monthFilter;
        }
        return matchesVeh && matchesTyp && matchesMth;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No transport entries found matching criteria.</td></tr>`;
        return;
    }

    // To compute mileage correctly, we sort ALL logs for each vehicle chronologically
    const logsByVehicle = {};
    state.transportLogs.forEach(log => {
        if (!logsByVehicle[log.vehicle]) logsByVehicle[log.vehicle] = [];
        logsByVehicle[log.vehicle].push(log);
    });
    
    // Sort each vehicle's logs by date and usage
    Object.keys(logsByVehicle).forEach(veh => {
        logsByVehicle[veh].sort((a, b) => new Date(a.date) - new Date(b.date) || a.usage - b.usage);
    });

    // Create a helper map to find calculated mileage of each log ID
    const mileageMap = {};
    Object.keys(logsByVehicle).forEach(veh => {
        const list = logsByVehicle[veh];
        for (let i = 0; i < list.length; i++) {
            const curr = list[i];
            if (curr.type === 'Diesel' && parseFloat(curr.litres) > 0) {
                // Find the nearest previous entry with a usage reading
                let prevUsageEntry = null;
                for (let j = i - 1; j >= 0; j--) {
                    if (list[j].usage > 0) {
                        prevUsageEntry = list[j];
                        break;
                    }
                }
                
                if (prevUsageEntry) {
                    const usageDiff = curr.usage - prevUsageEntry.usage;
                    if (usageDiff > 0) {
                        if (veh.includes('JCB')) {
                            // JCB mileage is Litres per Hour
                            const lph = curr.litres / usageDiff;
                            mileageMap[curr.id] = `${lph.toFixed(2)} L/Hr`;
                        } else {
                            // Truck mileage is KM per Litre
                            const kml = usageDiff / curr.litres;
                            mileageMap[curr.id] = `${kml.toFixed(2)} km/L`;
                        }
                    } else {
                        mileageMap[curr.id] = '—';
                    }
                } else {
                    mileageMap[curr.id] = 'Initial Refuel';
                }
            } else {
                mileageMap[curr.id] = '—';
            }
        }
    });

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach((log, index) => {
        const mileage = mileageMap[log.id] || '—';
        const costText = log.cost > 0 ? `₹${parseFloat(log.cost).toLocaleString('en-IN')}` : '—';
        const litresText = log.litres > 0 ? `${parseFloat(log.litres).toFixed(1)} L` : '—';
        const usageUnit = log.vehicle.includes('JCB') ? ' Hrs' : ' KM';
        
        let typeBadge = 'badge-info';
        if (log.type === 'Diesel') typeBadge = 'badge-success';
        if (log.type === 'Maintenance') typeBadge = 'badge-warning';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; color: var(--text-secondary); font-weight: bold; text-align: center;">${index + 1}</td>
            <td>${formatDateString(log.date)}</td>
            <td><strong>${log.vehicle}</strong></td>
            <td><span class="badge ${typeBadge}">${log.type}</span></td>
            <td>${parseFloat(log.usage).toFixed(1)}${usageUnit}</td>
            <td>${litresText}</td>
            <td><strong>${costText}</strong></td>
            <td><span class="text-xs font-semibold text-primary">${mileage}</span></td>
            <td><small>${log.remark || '—'}</small></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editTransport('${log.id}')" title="Edit Log"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteTransport('${log.id}')" title="Delete Log"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function renderTransportKPIs() {
    if (!document.getElementById('transport-kpis')) return;

    // 1. Diesel YTD Costs
    const dieselLogs = state.transportLogs.filter(log => log.type === 'Diesel');
    const totalDieselCost = dieselLogs.reduce((sum, log) => sum + (parseFloat(log.cost) || 0), 0);
    const totalDieselLitres = dieselLogs.reduce((sum, log) => sum + (parseFloat(log.litres) || 0), 0);

    document.getElementById('trans-kpi-diesel-cost').textContent = `₹${totalDieselCost.toLocaleString('en-IN')}`;
    document.getElementById('trans-kpi-diesel-litres').textContent = `${totalDieselLitres.toFixed(1)} Litres`;

    // 2. Active fleet
    document.getElementById('trans-kpi-active-fleet').textContent = `4 Vehicles`;

    // 3. Maintenance Cost YTD
    const maintLogs = state.transportLogs.filter(log => log.type === 'Maintenance');
    const totalMaintCost = maintLogs.reduce((sum, log) => sum + (parseFloat(log.cost) || 0), 0);
    document.getElementById('trans-kpi-maintenance-cost').textContent = `₹${totalMaintCost.toLocaleString('en-IN')}`;

    // 4. Average Mileage
    const logsByVehicle = {};
    state.transportLogs.forEach(log => {
        if (!logsByVehicle[log.vehicle]) logsByVehicle[log.vehicle] = [];
        logsByVehicle[log.vehicle].push(log);
    });

    let truckAvgSum = 0;
    let truckCount = 0;
    let jcbAvgSum = 0;
    let jcbCount = 0;

    Object.keys(logsByVehicle).forEach(veh => {
        const list = logsByVehicle[veh].sort((a, b) => new Date(a.date) - new Date(b.date) || a.usage - b.usage);
        if (list.length < 2) return;
        
        const first = list[0];
        const last = list[list.length - 1];
        
        const totalLtr = list.slice(1).reduce((sum, log) => sum + (log.type === 'Diesel' ? parseFloat(log.litres) : 0), 0);
        const usageDiff = last.usage - first.usage;

        if (usageDiff > 0 && totalLtr > 0) {
            if (veh.includes('JCB')) {
                jcbAvgSum += (totalLtr / usageDiff);
                jcbCount++;
            } else {
                truckAvgSum += (usageDiff / totalLtr);
                truckCount++;
            }
        }
    });

    const avgTruckMileage = truckCount > 0 ? (truckAvgSum / truckCount).toFixed(2) : '0.00';
    const avgJcbMileage = jcbCount > 0 ? (jcbAvgSum / jcbCount).toFixed(2) : '0.00';

    document.getElementById('trans-kpi-avg-mileage').textContent = `${avgTruckMileage} km/L`;
    document.getElementById('trans-kpi-avg-mileage-meta').textContent = `JCB Avg: ${avgJcbMileage} L/Hr`;
}

function handleTransportSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('transport-id').value;
    const date = document.getElementById('trans-date').value;
    const vehicle = document.getElementById('trans-vehicle').value;
    const type = document.getElementById('trans-type').value;
    const usage = parseFloat(document.getElementById('trans-usage').value) || 0;
    const litres = parseFloat(document.getElementById('trans-litres').value) || 0;
    const cost = parseFloat(document.getElementById('trans-cost').value) || 0;
    const remark = document.getElementById('trans-remark').value;

    const data = {
        date,
        vehicle,
        type,
        usage,
        litres,
        cost,
        remark
    };

    if (id) {
        const idx = state.transportLogs.findIndex(log => log.id === id);
        if (idx !== -1) {
            state.transportLogs[idx] = { ...state.transportLogs[idx], ...data };
        }
    } else {
        data.id = 'tr-' + Date.now();
        state.transportLogs.push(data);
    }

    saveState();
    closeModal('transport-modal');
    renderAllViews();
}

function editTransport(id) {
    const item = state.transportLogs.find(log => log.id === id);
    if (!item) return;

    document.getElementById('transport-id').value = item.id;
    document.getElementById('trans-date').value = item.date;
    document.getElementById('trans-vehicle').value = item.vehicle;
    document.getElementById('trans-type').value = item.type;
    document.getElementById('trans-usage').value = item.usage;
    document.getElementById('trans-litres').value = item.litres;
    document.getElementById('trans-cost').value = item.cost;
    document.getElementById('trans-remark').value = item.remark || '';

    adjustTransportFormFields();
    document.getElementById('transport-modal-title').textContent = "Edit Vehicle Entry Log";
    openModal('transport-modal');
}

function deleteTransport(id) {
    if (confirm("Are you sure you want to delete this transport entry?")) {
        state.transportLogs = state.transportLogs.filter(log => log.id !== id);
        saveState();
        renderAllViews();
    }
}

// --- 6. BILL & INVOICE CALCULATOR CONTROLLER ---
function populateSupplierSelects() {
    const select = document.getElementById('bill-supplier-select');
    const currentVal = select.value;
    
    // Get unique suppliers who have unbilled loads
    const suppliers = [...new Set(state.unloads.filter(u => !u.billed).map(u => u.supplier))].sort();
    
    select.innerHTML = '<option value="">-- Choose Supplier --</option>';
    
    if (suppliers.length === 0) {
        // If all are billed, show all suppliers instead
        const allSuppliers = [...new Set(state.unloads.map(u => u.supplier))].sort();
        allSuppliers.forEach(sup => {
            const opt = document.createElement('option');
            opt.value = sup;
            opt.textContent = `${sup} (All Lorries Billed)`;
            select.appendChild(opt);
        });
    } else {
        suppliers.forEach(sup => {
            const opt = document.createElement('option');
            opt.value = sup;
            opt.textContent = sup;
            select.appendChild(opt);
        });
    }

    if (currentVal) select.value = currentVal;
}

// Switch the invoice builder between inward (purchase/supplier) and outward
// (sales/customer) billing: relabel fields and repopulate the party dropdown.
function handleBillModeChange() {
    const modeSel = document.getElementById('bill-mode-select');
    const select = document.getElementById('bill-supplier-select');
    if (!modeSel || !select) return;
    const mode = modeSel.value;
    const partyLabel = document.getElementById('bill-party-label');
    const rateLabel = document.getElementById('rate-override-label');
    const currentVal = select.value;

    let parties, placeholder;
    if (mode === 'inward') {
        if (partyLabel) partyLabel.textContent = 'Select Supplier';
        if (rateLabel) rateLabel.textContent = 'Custom FOR Rate (₹/Qtl)';
        placeholder = '-- Choose Supplier --';
        parties = [...new Set(state.unloads.filter(u => !u.billed).map(u => u.supplier))].sort();
        if (parties.length === 0) parties = [...new Set(state.unloads.map(u => u.supplier))].sort();
    } else {
        if (partyLabel) partyLabel.textContent = 'Select Customer';
        if (rateLabel) rateLabel.textContent = 'Custom Sale Rate (₹/Qtl)';
        placeholder = '-- Choose Customer --';
        parties = [...new Set(state.sales.filter(s => !s.billed).map(s => s.customer))].sort();
        if (parties.length === 0) parties = [...new Set(state.sales.map(s => s.customer))].sort();
    }

    select.innerHTML = `<option value="">${placeholder}</option>`;
    parties.forEach(p => {
        const o = document.createElement('option');
        o.value = p; o.textContent = p;
        select.appendChild(o);
    });
    if (currentVal && [...select.options].some(o => o.value === currentVal)) select.value = currentVal;

    loadSupplierUnbilledItems(select.value);
}

function loadSupplierUnbilledLorries(supplierName, selectIds = []) {
    const container = document.getElementById('bill-lorries-list');
    container.innerHTML = '';
    
    if (!supplierName) {
        container.innerHTML = '<span class="text-muted small">Select a supplier to load pending lorries.</span>';
        return;
    }

    // Filter loads for supplier
    const pending = state.unloads.filter(u => u.supplier === supplierName);
    
    if (pending.length === 0) {
        container.innerHTML = '<span class="text-danger small">No lorry unloads logged for this supplier.</span>';
        return;
    }

    pending.forEach(lorry => {
        const wrapper = document.createElement('div');
        wrapper.className = 'lorry-checkbox-item';
        
        const isBilledTag = lorry.billed ? ' <span class="badge badge-success text-xs">Billed</span>' : '';
        const checkedStr = selectIds.includes(lorry.id) || !lorry.billed ? 'checked' : '';
        const disabledStr = lorry.billed ? 'disabled' : '';

        wrapper.innerHTML = `
            <input type="checkbox" class="bill-lorry-item-cb" data-id="${lorry.id}" ${checkedStr} ${disabledStr}>
            <span>
                <strong>${formatDateString(lorry.date)}</strong> - Lorry: <code>${lorry.lorryNo}</code> - Weight: <strong>${lorry.weight.toFixed(2)} Qtl</strong> @ ₹${lorry.forRate.toFixed(0)} FOR ${isBilledTag}
            </span>
        `;
        container.appendChild(wrapper);
    });
}

function compileInvoiceBill() {
    const mode = document.getElementById('bill-mode-select').value;
    const party = document.getElementById('bill-supplier-select').value;
    const cRateOverride = parseFloat(document.getElementById('bill-custom-rate').value);
    const dateVal = document.getElementById('bill-date').value || new Date().toISOString().split('T')[0];
    const adjustment = parseFloat(document.getElementById('bill-adjustments').value) || 0;
    const taxPercent = parseFloat(document.getElementById('bill-tax-percent').value) || 0;

    if (!party) {
        alert("Please select a party first.");
        return;
    }

    const cbs = document.querySelectorAll('.bill-item-cb:checked');
    const selectedIds = Array.from(cbs).map(cb => cb.getAttribute('data-id'));

    if (selectedIds.length === 0) {
        alert("Please select at least one item.");
        return;
    }

    document.getElementById('invoice-empty-msg').style.display = 'none';
    document.getElementById('invoice-ledger-content').style.display = 'block';
    document.getElementById('preview-actions-bar').style.display = 'flex';

    const invoiceNo = mode === 'inward' 
        ? `#VOM-PURCH-${Date.now().toString().slice(-5)}`
        : `#VOM-SALES-${Date.now().toString().slice(-5)}`;

    document.getElementById('preview-receipt-id').textContent = invoiceNo;
    document.getElementById('preview-bill-date').textContent = formatDateString(dateVal);
    document.getElementById('preview-supplier-name').textContent = party;
    document.getElementById('preview-party-type-label').textContent = mode === 'inward' ? 'Supplier' : 'Customer';
    document.getElementById('preview-invoice-subtitle').textContent = mode === 'inward'
        ? "Supplier Purchase Tax Invoice & calculations"
        : "Finished Goods Outward Tax Invoice (Manufacturer)";

    const partyGSTIN = document.getElementById('preview-party-gstin-row');
    const partyAddress = document.getElementById('preview-party-address-row');

    let partyObj = null;
    if (mode === 'outward') {
        partyObj = state.customers.find(c => c.name === party);
    } else {
        partyObj = state.suppliers.find(s => s.name === party);
    }

    if (partyObj) {
        partyGSTIN.style.display = 'block';
        partyAddress.style.display = 'block';
        document.getElementById('preview-party-gstin').textContent = partyObj.gstin || '-';
        document.getElementById('preview-party-address').textContent = partyObj.address || '-';
    } else {
        partyGSTIN.style.display = 'none';
        partyAddress.style.display = 'none';
    }

    const items = mode === 'inward' 
        ? state.unloads.filter(u => selectedIds.includes(u.id))
        : state.sales.filter(s => selectedIds.includes(s.id));

    const dates = items.map(i => new Date(i.date));
    const minDate = new Date(Math.min.apply(null, dates));
    const maxDate = new Date(Math.max.apply(null, dates));
    const periodStr = minDate.getTime() === maxDate.getTime()
        ? formatDateString(minDate.toISOString().split('T')[0])
        : `${formatDateString(minDate.toISOString().split('T')[0])} to ${formatDateString(maxDate.toISOString().split('T')[0])}`;
    document.getElementById('preview-bill-period').textContent = periodStr;

    const tableHeader = document.getElementById('preview-table-hdr');
    tableHeader.innerHTML = mode === 'inward'
        ? `<th>Item / Lorry</th><th>Date</th><th>Description</th><th>Quantity</th><th>Rate (₹)</th><th class="text-right">Line Total (₹)</th>`
        : `<th>Invoice / Lorry</th><th>Date</th><th>Product</th><th>Quantity</th><th>Rate (₹)</th><th class="text-right">Line Total (₹)</th>`;

    const itemTbody = document.getElementById('preview-items-tbody');
    itemTbody.innerHTML = '';
    
    let totalQty = 0;
    let subtotalAmount = 0;
    const rateGroups = {};

    items.forEach(item => {
        const discountVal = mode === 'inward' ? (parseFloat(item.discount) || 0) : 0;
        const itemRate = !isNaN(cRateOverride) && cRateOverride > 0 ? cRateOverride : (mode === 'inward' ? (item.forRate - discountVal) : item.rate);
        const lineTotal = item.weight * itemRate;
        totalQty += item.weight;
        subtotalAmount += lineTotal;

        const tr = document.createElement('tr');
        if (mode === 'inward') {
            const seedLabel = item.seedType === 'MS' ? 'Cotton Seed (MS)' : 'Cotton Seed (OMS)';
            const rateDetail = discountVal > 0 
                ? `₹${item.forRate.toFixed(2)} - ₹${discountVal.toFixed(2)} (Disc)`
                : `₹${itemRate.toFixed(2)}`;
            tr.innerHTML = `
                <td><code>${item.lorryNo}</code></td>
                <td>${formatDateString(item.date)}</td>
                <td>${seedLabel}</td>
                <td>${item.weight.toFixed(2)} Qtl</td>
                <td>${rateDetail}</td>
                <td class="text-right font-bold">₹${lineTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</td>
            `;
            itemTbody.appendChild(tr);

            // Add separate row for Gunnies/Bags if received
            if (item.bagQty > 0) {
                const bagTr = document.createElement('tr');
                const bagTotal = item.bagQty * (item.bagRate || 0);
                subtotalAmount += bagTotal;
                
                const bagObj = PRODUCTS.find(p => p.id === item.bagType);
                const bagName = bagObj ? bagObj.name : 'Gunnies';
                
                bagTr.innerHTML = `
                    <td><code>${item.lorryNo}</code></td>
                    <td>${formatDateString(item.date)}</td>
                    <td>${bagName} (Packaging)</td>
                    <td>${item.bagQty} Bags</td>
                    <td>₹${(item.bagRate || 0).toFixed(2)}</td>
                    <td class="text-right font-bold">₹${bagTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</td>
                `;
                itemTbody.appendChild(bagTr);
            }
        } else {
            const prodObj = PRODUCTS.find(p => p.id === item.product);
            const prodName = prodObj ? prodObj.name : item.product;
            tr.innerHTML = `
                <td><code>${item.lorryNo}</code></td>
                <td>${formatDateString(item.date)}</td>
                <td>${prodName}</td>
                <td>${item.weight.toFixed(2)}</td>
                <td>₹${itemRate.toFixed(2)}</td>
                <td class="text-right font-bold">₹${lineTotal.toLocaleString('en-IN', {maximumFractionDigits: 2})}</td>
            `;
            itemTbody.appendChild(tr);
        }

        const rateKey = itemRate.toString();
        if (!rateGroups[rateKey]) rateGroups[rateKey] = [];
        rateGroups[rateKey].push(item);
    });

    let notebookHtml = '';
    let groupIndex = 1;
    for (const rateKey in rateGroups) {
        const rateVal = parseFloat(rateKey);
        const grp = rateGroups[rateKey];
        notebookHtml += `<div class="mb-2"><strong>Group ${groupIndex}: Rate ₹${rateVal}/-</strong>`;
        
        let sumVal = 0;
        grp.forEach((itm, i) => {
            const dateStr = getDayMonthStr(itm.date);
            const label = mode === 'inward' ? `${itm.supplier} (Lorry ${itm.lorryNo})` : `Outward Lorry ${itm.lorryNo}`;
            notebookHtml += `<div class="notebook-math-line">
                <span>&nbsp;&nbsp;${i + 1}) ${label} [${dateStr}]</span>
                <span>${itm.weight.toFixed(2)} Units</span>
            </div>`;
            sumVal += itm.weight;
        });
        
        notebookHtml += `<div class="notebook-sum-line">
            <span>&nbsp;&nbsp;Sum Total Quantity:</span>
            <span>${sumVal.toFixed(2)} Units x ₹${rateVal}</span>
        </div>`;
        notebookHtml += `<div class="text-right font-bold text-success">
            Sub-Payable: ₹${(sumVal * rateVal).toLocaleString('en-IN', {maximumFractionDigits: 0})}/-
        </div></div>`;
        groupIndex++;
    }
    document.getElementById('preview-notebook-math').innerHTML = notebookHtml;

    let taxBaseAmount = 0;
    if (mode === 'inward') {
        items.forEach(item => {
            const discountVal = parseFloat(item.discount) || 0;
            const baseRate = !isNaN(cRateOverride) && cRateOverride > 0 ? cRateOverride : (item.rate - discountVal);
            const bagTotal = item.bagQty * (item.bagRate || 0);
            taxBaseAmount += (item.weight * baseRate) + bagTotal;
        });
    } else {
        taxBaseAmount = subtotalAmount;
    }
    const taxAmount = (taxBaseAmount * taxPercent) / 100;
    const grandTotal = subtotalAmount + taxAmount + adjustment;

    document.getElementById('preview-total-weight').textContent = `${totalQty.toFixed(2)} units`;
    document.getElementById('preview-subtotal').textContent = `₹${subtotalAmount.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;

    const cgstRow = document.getElementById('cgst-row');
    const sgstRow = document.getElementById('sgst-row');
    const igstRow = document.getElementById('igst-row');
    cgstRow.style.display = 'none'; sgstRow.style.display = 'none'; igstRow.style.display = 'none';

    if (taxAmount > 0) {
        const isMaharashtra = partyObj && partyObj.address && partyObj.address.toLowerCase().includes('maharashtra');
        if (isMaharashtra) {
            cgstRow.style.display = 'table-row';
            sgstRow.style.display = 'table-row';
            document.getElementById('preview-cgst-amount').textContent = `₹${(taxAmount / 2).toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('preview-sgst-amount').textContent = `₹${(taxAmount / 2).toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('cgst-label').textContent = `CGST (${(taxPercent / 2)}%):`;
            document.getElementById('sgst-label').textContent = `SGST (${(taxPercent / 2)}%):`;
        } else {
            igstRow.style.display = 'table-row';
            document.getElementById('preview-igst-amount').textContent = `₹${taxAmount.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('igst-label').textContent = `IGST (${taxPercent}%):`;
        }
    }

    document.getElementById('preview-adjustments').textContent = `₹${adjustment.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
    document.getElementById('preview-grand-total').textContent = `₹${grandTotal.toLocaleString('en-IN', {maximumFractionDigits: 0})}/-`;

    const totalWords = numberToWords(Math.round(grandTotal));
    document.getElementById('preview-words-amount').textContent = totalWords;

    document.getElementById('save-invoice-log-btn').setAttribute('data-target-ids', JSON.stringify(selectedIds));
    document.getElementById('save-invoice-log-btn').setAttribute('data-bill-mode', mode);
}

function recordBillPayout() {
    const idsString = document.getElementById('save-invoice-log-btn').getAttribute('data-target-ids');
    const mode = document.getElementById('save-invoice-log-btn').getAttribute('data-bill-mode');
    if (!idsString || idsString === '[]') return;

    const idsToBill = JSON.parse(idsString);
    if (confirm(`Do you want to finalize calculations and archive this invoice bill?`)) {
        
        const invoiceNo = document.getElementById('preview-receipt-id').textContent;
        const dateVal = document.getElementById('bill-date').value || new Date().toISOString().split('T')[0];
        const party = document.getElementById('preview-supplier-name').textContent;
        const period = document.getElementById('preview-bill-period').textContent;
        const notebookMath = document.getElementById('preview-notebook-math').innerHTML;
        const totalQty = parseFloat(document.getElementById('preview-total-weight').textContent);
        const subtotal = parseFloat(document.getElementById('preview-subtotal').textContent.replace(/[₹,]/g, ''));
        const adjustments = parseFloat(document.getElementById('preview-adjustments').textContent.replace(/[₹,]/g, ''));
        const grandTotal = parseFloat(document.getElementById('preview-grand-total').textContent.replace(/[₹,/-]/g, ''));
        const wordsAmount = document.getElementById('preview-words-amount').textContent;
        const taxPercent = parseFloat(document.getElementById('bill-tax-percent').value) || 0;
        const taxAmount = (subtotal * taxPercent) / 100;

        const itemsList = [];
        if (mode === 'inward') {
            state.unloads.forEach(u => {
                if (idsToBill.includes(u.id)) {
                    u.billed = true;
                    itemsList.push({
                        date: u.date,
                        lorryNo: u.lorryNo,
                        location: u.location,
                        weight: u.weight,
                        rate: u.forRate,
                        total: u.weight * u.forRate
                    });
                }
            });
        } else {
            state.sales.forEach(s => {
                if (idsToBill.includes(s.id)) {
                    s.billed = true;
                    s.status = 'Paid';
                    const prodObj = PRODUCTS.find(p => p.id === s.product);
                    itemsList.push({
                        date: s.date,
                        lorryNo: s.lorryNo,
                        productName: prodObj ? prodObj.name : s.product,
                        weight: s.weight,
                        rate: s.rate,
                        total: s.weight * s.rate
                    });
                }
            });
        }

        const client = state.customers.find(c => c.name === party);

        state.salesInvoices.push({
            id: 'inv-' + Date.now(),
            invoiceNo,
            date: dateVal,
            partyName: party,
            type: mode,
            period,
            totalQty,
            subtotal,
            taxPercent,
            taxAmount,
            adjustments,
            grandTotal,
            wordsAmount,
            notebookMath,
            itemsList,
            itemCount: itemsList.length,
            customerProfile: client ? { address: client.address, gstin: client.gstin } : null
        });

        saveState();
        alert("Invoice recorded and calculation sheet archived successfully!");
        
        switchTab(mode === 'inward' ? 'unloads' : 'sales');
        renderAllViews();
        
        document.getElementById('invoice-empty-msg').style.display = 'flex';
        document.getElementById('invoice-ledger-content').style.display = 'none';
        document.getElementById('preview-actions-bar').style.display = 'none';
    }
}

// --- 7. DATABASE BACKUP AND RESTORE CONTROLLER ---
function exportDatabase() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `vitthal_mill_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
}

function importDatabase(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed.unloads && parsed.stockDaily && parsed.spareParts && parsed.maintenanceLogs) {
                state = parsed;
                saveState();
                renderAllViews();
                alert("Database backup successfully restored.");
            } else {
                alert("Invalid backup file format. Missing core datasets.");
            }
        } catch (err) {
            alert("Error parsing JSON backup file: " + err.message);
        }
    };
    reader.readAsText(file);
}

// --- CHARTS & GRAPHS DRAWING (Chart.js) ---
function renderCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js is not loaded or offline. Skipping charts rendering.");
        return;
    }

    const canvasProd = document.getElementById('productionChart');
    const canvasRep = document.getElementById('repairChart');
    if (!canvasProd || !canvasRep) return;

    const ctxProd = canvasProd.getContext('2d');
    const ctxRep = canvasRep.getContext('2d');

    // Destroy existing instances to prevent overlay redraw glitches
    if (productionChartInstance) productionChartInstance.destroy();
    if (repairChartInstance) repairChartInstance.destroy();

    // 1. Calculate Production Trends (OMS + MS Cotton Seed received vs Crude & Wash Oil Stocks)
    // We summarize for June and July 2026
    const months = ['2026-06', '2026-07'];
    const seedUnloadsWeights = months.map(m => {
        return state.unloads
            .filter(u => {
                const dObj = new Date(u.date);
                if (isNaN(dObj.getTime())) return false;
                const mKey = `${dObj.getFullYear()}-${String(dObj.getMonth()+1).padStart(2,'0')}`;
                return mKey === m;
            })
            .reduce((sum, item) => sum + parseFloat(item.weight), 0);
    });

    const oilProduction = months.map(m => {
        // Calculate ONLY actual oil production logged in crushing runs
        return state.productionLogs
            .filter(p => {
                if (!p.date) return false;
                return p.date.substring(0, 7) === m;
            })
            .reduce((sum, p) => sum + (parseFloat(p.oilYield) || 0), 0);
    });

    const totalPurchases = seedUnloadsWeights.reduce((sum, val) => sum + val, 0);
    const totalOilProd = oilProduction.reduce((sum, val) => sum + val, 0);
    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? '#24304f' : '#e2e8f0';
    const textLabelColor = isDark ? '#94a3b8' : '#475569';

    // Show placeholder if no purchase or production data exists
    const prodContainer = canvasProd.parentElement;
    if (totalPurchases === 0 && totalOilProd === 0) {
        canvasProd.style.display = 'none';
        let placeholder = document.getElementById('production-chart-placeholder');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'production-chart-placeholder';
            placeholder.style.cssText = 'height:220px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:0.9rem; font-style:italic; opacity:0.6;';
            placeholder.innerHTML = 'No purchase or production logs found for June/July';
            prodContainer.appendChild(placeholder);
        } else {
            placeholder.style.display = 'flex';
        }
    } else {
        canvasProd.style.display = 'block';
        const placeholder = document.getElementById('production-chart-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        productionChartInstance = new Chart(ctxProd, {
            type: 'bar',
            data: {
                labels: ['June 2026', 'July 2026'],
                datasets: [
                    {
                        label: 'Cotton Seed Unloaded (Qtl)',
                        data: seedUnloadsWeights,
                        backgroundColor: 'rgba(14, 165, 233, 0.65)',
                        borderColor: '#0ea5e9',
                        borderWidth: 1
                    },
                    {
                        label: 'Oil Production Receipt (Qtl)',
                        data: oilProduction,
                        backgroundColor: 'rgba(16, 185, 129, 0.65)',
                        borderColor: '#10b981',
                        borderWidth: 1
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        ticks: { color: textLabelColor, font: { family: 'Inter' } }
                    },
                    y: {
                        grid: { color: gridColor },
                        ticks: { color: textLabelColor, font: { family: 'Inter' } }
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: textLabelColor, font: { family: 'Outfit', weight: '500' } }
                    }
                }
            }
        });
    }

    // 2. Maintenance costs by machine category
    const categories = ['Expander', 'Filter Press', 'Boiler', 'Decanter', 'Electrical'];
    const costsByCategory = categories.map(cat => {
        return state.maintenanceLogs
            .filter(log => {
                const part = state.spareParts.find(p => p.machine === cat);
                return log.machine.toLowerCase().includes(cat.toLowerCase()) || (part && log.sparesUsed.some(su => su.partId === part.id));
            })
            .reduce((sum, item) => sum + parseFloat(item.totalCost), 0);
    });

    const totalRepairCost = costsByCategory.reduce((sum, val) => sum + val, 0);
    const repContainer = canvasRep.parentElement;

    // Show placeholder if no maintenance expenses exist
    if (totalRepairCost === 0) {
        canvasRep.style.display = 'none';
        let placeholder = document.getElementById('repair-chart-placeholder');
        if (!placeholder) {
            placeholder = document.createElement('div');
            placeholder.id = 'repair-chart-placeholder';
            placeholder.style.cssText = 'height:220px; display:flex; align-items:center; justify-content:center; color:var(--text-secondary); font-size:0.9rem; font-style:italic; opacity:0.6;';
            placeholder.innerHTML = 'No maintenance logs found';
            repContainer.appendChild(placeholder);
        } else {
            placeholder.style.display = 'flex';
        }
    } else {
        canvasRep.style.display = 'block';
        const placeholder = document.getElementById('repair-chart-placeholder');
        if (placeholder) placeholder.style.display = 'none';

        repairChartInstance = new Chart(ctxRep, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: costsByCategory,
                    backgroundColor: [
                        'rgba(99, 102, 241, 0.7)',
                        'rgba(14, 165, 233, 0.7)',
                        'rgba(245, 158, 11, 0.7)',
                        'rgba(239, 68, 68, 0.7)',
                        'rgba(16, 185, 129, 0.7)'
                    ],
                    borderColor: isDark ? '#141c2f' : '#ffffff',
                    borderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textLabelColor, font: { family: 'Inter', size: 11 } }
                    }
                }
            }
        });
    }
}

// --- UTILITY FORMATTING FUNCTIONS ---
function formatDateString(dateStr) {
    if (!dateStr) return '-';
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj.getTime())) return dateStr;
    const day = String(dateObj.getDate()).padStart(2, '0');
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const year = dateObj.getFullYear();
    return `${day}/${month}/${year}`;
}

function getDayMonthStr(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    const day = parseInt(parts[2]);
    const month = parseInt(parts[1]);
    return `${day}/${month}`;
}

// --- SEED MOCK DATA FUNCTION ---
// Seed exact datasets matching excel, notebook and unload logs screenshots
function seedMockData() {
    // 1. Add Raw material unloads (matching Image 3 & Image 2 calculations)
    state.unloads = [
        { id: 'unl-mock-1', date: '2026-07-01', supplier: 'Satyan Agco', place: 'Goegeoi', lorryNo: 'MH-23AQ-486', weight: 114.50, rate: 4650, freight: 68.55, forRate: 4850, location: 'Deior', remark: 'Premium Seed', billed: true },
        { id: 'unl-mock-2', date: '2026-07-01', supplier: 'Sundaram Indus', place: 'Pachod', lorryNo: 'MH-16CC-9758', weight: 109.85, rate: 4600, freight: 68, forRate: 4900, location: 'Silo-1', remark: '', billed: true },
        { id: 'unl-mock-3', date: '2026-07-01', supplier: 'Kunal Cotton', place: 'Majalgaon', lorryNo: 'MH-16CC-9758', weight: 117.50, rate: 4591, freight: 100, forRate: 4920, location: 'Deior', remark: '', billed: false },
        { id: 'unl-mock-4', date: '2026-07-03', supplier: 'Satyan Agco', place: 'Gevrai', lorryNo: 'MH-05BL-4343', weight: 102.05, rate: 4650, freight: 55, forRate: 4960, location: 'Silo-2', remark: 'Moisture ok', billed: false },
        { id: 'unl-mock-5', date: '2026-07-03', supplier: 'Rajendra Agco', place: 'Pachod', lorryNo: 'TN-15Y-9682', weight: 242.18, rate: 4500, freight: 165, forRate: 4910, location: 'Silo-3', remark: '', billed: false },
        { id: 'unl-mock-6', date: '2026-07-05', supplier: 'Kunal Cotton', place: 'Majalgaon', lorryNo: 'MH-16CC-9758', weight: 102.85, rate: 4591, freight: 100, forRate: 4920, location: 'Deior', remark: 'Notebook P.1 Calc', billed: false },
        { id: 'unl-mock-7', date: '2026-07-06', supplier: 'Kunal Cotton', place: 'Majalgaon', lorryNo: 'MH-16CC-9758', weight: 101.35, rate: 4591, freight: 100, forRate: 4920, location: 'Deior', remark: 'Notebook P.1 Calc', billed: false },
        { id: 'unl-mock-8', date: '2026-07-07', supplier: 'Sundaram Indus', place: 'Pachod', lorryNo: 'MH-16CC-9758', weight: 106.95, rate: 4600, freight: 68, forRate: 4920, location: 'Silo-1', remark: 'Notebook P.1 Calc 2', billed: false },
        { id: 'unl-mock-9', date: '2026-07-07', supplier: 'Sundaram Indus', place: 'Pachod', lorryNo: 'MH-16CC-9758', weight: 310.65, rate: 4600, freight: 68, forRate: 4913, location: 'Silo-1', remark: 'Notebook P.1 Calc 3', billed: false },
        { id: 'unl-mock-10', date: '2026-07-08', supplier: 'Kunal Cotton', place: 'Majalgaon', lorryNo: 'MH-16CC-9758', weight: 105.25, rate: 4591, freight: 100, forRate: 4920, location: 'Deior', remark: 'Notebook P.2 Calc 1', billed: false },
        { id: 'unl-mock-11', date: '2026-07-08', supplier: 'Padmavati', place: 'Pachod', lorryNo: 'MH-16BC-9758', weight: 250.55, rate: 4610, freight: 300, forRate: 4910, location: 'Silo-3', remark: 'Notebook P.2 Calc 2', billed: false },
        { id: 'unl-mock-12', date: '2026-07-07', supplier: 'Harita Cotton', place: 'Gevrai', lorryNo: 'MH-18AA-1597', weight: 35.30, rate: 4530, freight: 200, forRate: 4730, location: 'Silo-2', remark: 'Notebook P.2 Calc 3', billed: false }
    ];

    // 2. Add Spare parts (boiler, filter, expanders)
    state.spareParts = [
        { id: 'spr-1', code: 'SHA-EX-101', name: 'Expander Main Shaft', machine: 'Expander', unit: 'Pcs', stock: 1, minLevel: 3, cost: 45000 },
        { id: 'spr-2', code: 'CAGE-EX-205', name: 'Bullet Cage Bar Set', machine: 'Expander', unit: 'Sets', stock: 12, minLevel: 8, cost: 4800 },
        { id: 'spr-3', code: 'CON-EX-311', name: 'Chamber Bullet Cone', machine: 'Expander', unit: 'Pcs', stock: 1, minLevel: 2, cost: 18000 },
        { id: 'spr-4', code: 'CLOTH-FP-01', name: 'Polypropylene Filter Cloth', machine: 'Filter Press', unit: 'Meters', stock: 120, minLevel: 50, cost: 320 },
        { id: 'spr-5', code: 'SEAL-FP-08', name: 'Filter Plate Gasket Rubber', machine: 'Filter Press', unit: 'Pcs', stock: 4, minLevel: 10, cost: 650 },
        { id: 'spr-6', code: 'VALVE-BL-45', name: 'Boiler Blowdown Check Valve', machine: 'Boiler', unit: 'Pcs', stock: 3, minLevel: 1, cost: 12500 },
        { id: 'spr-7', code: 'MOTOR-EL-05', name: '15HP Siemens Slip-ring Motor', machine: 'Electrical', unit: 'Pcs', stock: 3, minLevel: 2, cost: 35000 },
        { id: 'spr-8', code: 'BELT-V-90', name: 'Industrial V-Belt B-90', machine: 'Electrical', unit: 'Pcs', stock: 16, minLevel: 8, cost: 450 }
    ];

    // 3. Add repair history log
    state.maintenanceLogs = [
        {
            id: 'rep-mock-1',
            date: '2026-06-15',
            machine: 'Expander #1',
            type: 'Breakdown',
            desc: 'Extreme vibrations in crushing gear. Replaced worn main shaft and fitted fresh cage bars.',
            sparesUsed: [
                { partId: 'spr-1', qty: 1, name: 'Expander Main Shaft', cost: 45000 },
                { partId: 'spr-2', qty: 2, name: 'Bullet Cage Bar Set', cost: 4800 }
            ],
            engineer: 'Shree Ganesh Engineering',
            serviceCost: 6500,
            totalCost: 61100, // 45000 + 9600 + 6500
            status: 'Completed'
        },
        {
            id: 'rep-mock-2',
            date: '2026-06-25',
            machine: 'Filter Press #2',
            type: 'Routine',
            desc: 'Standard maintenance. Replaced 15 meters of torn filter press cloths due to gaad buildup.',
            sparesUsed: [
                { partId: 'spr-4', qty: 15, name: 'Polypropylene Filter Cloth', cost: 320 }
            ],
            engineer: 'In-house staff',
            serviceCost: 800,
            totalCost: 5600, // (15 * 320) + 800
            status: 'Completed'
        },
        {
            id: 'rep-mock-3',
            date: '2026-07-04',
            machine: 'Boiler feed water pump',
            type: 'Preventive',
            desc: 'Installed fresh V-belts and lubricated drive bearing housing.',
            sparesUsed: [
                { partId: 'spr-8', qty: 4, name: 'Industrial V-Belt B-90', cost: 450 }
            ],
            engineer: 'Maruti Services',
            serviceCost: 1500,
            totalCost: 3300,
            status: 'Completed'
        },
        {
            id: 'rep-mock-4',
            date: '2026-07-08',
            machine: 'Expander #2',
            type: 'Breakdown',
            desc: 'Expander Cone failure during heavy OMS seed crush. Spare cone requested from fabricator.',
            sparesUsed: [],
            engineer: 'Shree Ganesh Engineering',
            serviceCost: 0,
            totalCost: 0,
            status: 'Pending'
        }
    ];

    state.transportLogs = [
        // Truck #1
        { id: 'tr-mock-1', date: '2026-07-01', vehicle: 'Truck #1', type: 'Usage', usage: 45000.0, litres: 0, cost: 0, remark: 'Month start odometer reading' },
        { id: 'tr-mock-2', date: '2026-07-03', vehicle: 'Truck #1', type: 'Diesel', usage: 45450.0, litres: 90.0, cost: 8100, remark: 'Refuel at Shell' }, // mileage: (45450-45000)/90 = 5.0 km/L
        { id: 'tr-mock-3', date: '2026-07-07', vehicle: 'Truck #1', type: 'Diesel', usage: 45950.0, litres: 100.0, cost: 9000, remark: 'Refuel at HP' }, // mileage: (45950-45450)/100 = 5.0 km/L
        { id: 'tr-mock-4', date: '2026-07-09', vehicle: 'Truck #1', type: 'Maintenance', usage: 46100.0, litres: 0, cost: 12500, remark: 'Front brake pads & hub greasing' },
        
        // Truck #2
        { id: 'tr-mock-5', date: '2026-07-01', vehicle: 'Truck #2', type: 'Usage', usage: 38200.0, litres: 0, cost: 0, remark: 'Month start odometer reading' },
        { id: 'tr-mock-6', date: '2026-07-04', vehicle: 'Truck #2', type: 'Diesel', usage: 38680.0, litres: 100.0, cost: 9000, remark: 'Refuel at HP' }, // mileage: (38680-38200)/100 = 4.8 km/L
        { id: 'tr-mock-7', date: '2026-07-08', vehicle: 'Truck #2', type: 'Diesel', usage: 39140.0, litres: 95.0, cost: 8550, remark: 'Refuel at Essar' }, // mileage: (39140-38680)/95 = 4.84 km/L
        
        // JCB #1
        { id: 'tr-mock-8', date: '2026-07-01', vehicle: 'JCB #1', type: 'Usage', usage: 1200.0, litres: 0, cost: 0, remark: 'Month start engine hours check' },
        { id: 'tr-mock-9', date: '2026-07-05', vehicle: 'JCB #1', type: 'Diesel', usage: 1230.0, litres: 180.0, cost: 16200, remark: 'Bulk diesel tank refill' }, // Lph: 180 / (1230 - 1200) = 6.0 L/Hr
        { id: 'tr-mock-10', date: '2026-07-08', vehicle: 'JCB #1', type: 'Maintenance', usage: 1248.0, litres: 0, cost: 8500, remark: 'Hydraulic hose pipe leak repair' },
        
        // JCB #2
        { id: 'tr-mock-11', date: '2026-07-01', vehicle: 'JCB #2', type: 'Usage', usage: 850.0, litres: 0, cost: 0, remark: 'Month start engine hours check' },
        { id: 'tr-mock-12', date: '2026-07-06', vehicle: 'JCB #2', type: 'Diesel', usage: 885.0, litres: 192.5, cost: 17325, remark: 'Bulk refuel' } // Lph: 192.5 / (885 - 850) = 5.5 L/Hr
    ];

    // 4. Populate stock sheet entries for June 2026 (exact cells matching Excel image 1)
    state.stockDaily = {
        '2026-06': {
            'cs-ms': {
                // Receipt total = 399.65
                '15': { receipt: 399.65, issue: 0 },
                // Issue total = 1618.50
                '10': { receipt: 0, issue: 1000.00 },
                '20': { receipt: 0, issue: 618.50 }
            },
            'cs-oms': {
                // Receipt: Day 25: 243.9, Day 27: 241, Day 29: 274.2. (Total in Excel: 4670.15)
                '12': { receipt: 1000.00, issue: 0 },
                '18': { receipt: 1500.00, issue: 0 },
                '22': { receipt: 1411.05, issue: 0 },
                '25': { receipt: 243.90, issue: 0 },
                '27': { receipt: 241.00, issue: 0 },
                '29': { receipt: 274.20, issue: 0 },
                // Issue total: 3892.12
                '10': { receipt: 0, issue: 1200.00 },
                '17': { receipt: 0, issue: 1300.00 },
                '24': { receipt: 0, issue: 1392.12 }
            },
            'ch-ms': {
                // Issue total = 416.50
                '10': { receipt: 0, issue: 416.50 }
            },
            'ch-oms': {
                // Issue total = 1026.00
                '14': { receipt: 0, issue: 1026.00 }
            },
            'kandi': {
                // Issue total = 551.50
                '12': { receipt: 0, issue: 551.50 }
            },
            'khal-mm': {
                // Receipt total = 1002.55
                '15': { receipt: 1002.55, issue: 0 },
                // Issue total = 3606.99
                '18': { receipt: 0, issue: 2000.00 },
                '26': { receipt: 0, issue: 1606.99 }
            },
            'khal-km': {
                // Receipt total = 1901.74
                '10': { receipt: 1901.74, issue: 0 },
                // Issue total = 3133.27
                '15': { receipt: 0, issue: 1500.00 },
                '22': { receipt: 0, issue: 1633.27 }
            },
            'oil-crude': {
                // Receipt total = 468.72 (Day 29: 229.68, Day 15: 239.04)
                '15': { receipt: 239.04, issue: 0 },
                '29': { receipt: 229.68, issue: 0 },
                // Issue total = 411.12
                '18': { receipt: 0, issue: 200.00 },
                '28': { receipt: 0, issue: 211.12 }
            },
            'oil-wash': {
                // Receipt: Day 24: 18.89, Day 27: 39.56, Day 28: 4.72, Day 15: 273.95 (Total = 337.12)
                '15': { receipt: 273.95, issue: 0 },
                '24': { receipt: 18.89, issue: 0 },
                '27': { receipt: 39.56, issue: 0 },
                '28': { receipt: 4.72, issue: 0 },
                // Issue: 295.70
                '18': { receipt: 0, issue: 150.00 },
                '25': { receipt: 0, issue: 145.70 }
            },
            'oil-gaad': {
                // Receipt: Day 24: 5.76, Day 27: 12.06, Day 28: 1.44, Day 15: 83.52 (Total = 102.78)
                '15': { receipt: 83.52, issue: 0 },
                '24': { receipt: 5.76, issue: 0 },
                '27': { receipt: 12.06, issue: 0 },
                '28': { receipt: 1.44, issue: 0 },
                // Issue: 66.70
                '18': { receipt: 0, issue: 30.00 },
                '25': { receipt: 0, issue: 36.70 }
            },
            'gm-pp-50': {
                // Receipt: 2550, Issue: 1298
                '15': { receipt: 2550, issue: 1298 }
            },
            'gm-pp-60': {
                // Receipt: 1100, Issue: 2048 (Closing: -948)
                '15': { receipt: 1100, issue: 1048 },
                '29': { receipt: 0, issue: 200 }, // Day 29 issue: 200
                '30': { receipt: 0, issue: 800 }
            },
            'gm-pp-70': {
                // Receipt: 700, Issue: 682
                '15': { receipt: 700, issue: 682 }
            },
            'gm-pp-km': {
                // Issue: 4054
                '15': { receipt: 0, issue: 4054 }
            },
            'gm-pp-mm': {
                // Issue: 4679
                '15': { receipt: 0, issue: 4679 }
            },
            'gm-pp-gm': {
                // Issue: 111
                '15': { receipt: 0, issue: 111 }
            }
        },
        '2026-07': {
            'cs-oms': {
                // Seed unloads from Image 3 to July stock
                '1': { receipt: 341.85, issue: 0 }, // Satyan 114.5 + Sundaram 109.85 + Kunal 117.5 = 341.85
                '3': { receipt: 344.23, issue: 0 }, // Satyan 102.05 + Rajendra 242.18 = 344.23
                '5': { receipt: 102.85, issue: 0 },
                '6': { receipt: 101.35, issue: 0 },
                '7': { receipt: 452.90, issue: 0 }, // Sundaram 106.95 + 310.65 + Harita 35.3 = 452.9
                '8': { receipt: 355.80, issue: 0 }  // Kunal 105.25 + Padmavati 250.55 = 355.8
            }
        }
    };

    saveState();
    renderAllViews();
    alert("Mock data matching excel, notebook and unload logs successfully seeded!");
}

// ==========================================================================
// OUTBOUND SALES & INVOICING ADDITIONS (MERGED)
// ==========================================================================

function switchSalesSubtab(subtabId) {
    document.querySelectorAll('.inner-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
    });

    document.querySelectorAll('.sales-subpane').forEach(pane => {
        pane.classList.toggle('active', pane.getAttribute('id') === `${subtabId}-subtab`);
    });

    if (subtabId === 'sales-register') {
        renderSalesTable();
    } else if (subtabId === 'client-directory') {
        renderCustomersTable();
    } else if (subtabId === 'invoice-archive') {
        renderInvoicesArchive();
    }
}

function renderSalesTable(searchQuery = '') {
    const tbody = document.getElementById('sales-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const customerFilter = document.getElementById('filter-sales-customer').value;
    const productFilter = document.getElementById('filter-sales-product').value;
    const statusFilter = document.getElementById('filter-sales-status').value;
    
    const filtered = state.sales.filter(item => {
        const matchesSearch = !searchQuery || 
                              item.customer.toLowerCase().includes(searchQuery) ||
                              item.lorryNo.toLowerCase().includes(searchQuery) ||
                              item.destination.toLowerCase().includes(searchQuery);
        
        const matchesCustomer = !customerFilter || item.customer === customerFilter;
        const matchesProduct = !productFilter || item.product === productFilter;
        const matchesStatus = !statusFilter || item.status === statusFilter;
        return matchesSearch && matchesCustomer && matchesProduct && matchesStatus;
    });

    updateCustomerFilters();
    calculateSalesMiniKPIs();

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" class="text-center text-muted py-4">No sales dispatches found.</td></tr>`;
        return;
    }

    filtered.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = item.billed ? 'bg-billed-subtle text-muted' : '';
        const prodObj = PRODUCTS.find(p => p.id === item.product);
        const prodName = prodObj ? prodObj.name : item.product;
        const subTotal = item.weight * item.rate;

        const qualityBadgeColor = {
            'Grade A': 'badge-success',
            'Grade B': 'badge-info',
            'Grade C': 'badge-warning',
            'Mixed': 'badge-secondary',
            'Premium': 'badge-primary'
        }[item.qualityGrade] || 'badge-secondary';
        const juteSummary = (item.juteBagWeight && item.juteBagQty) 
            ? `<br><span class="text-xs text-muted">🌿 ${item.juteBagQty}×${item.juteBagWeight}kg Jute = ${((item.juteBagWeight * item.juteBagQty)/100).toFixed(2)} Qtl</span>` 
            : '';
        const ppSummary = (item.bagType && item.bagQty) 
            ? `<br><span class="text-xs text-muted">📦 ${item.bagQty} PP Bag(s)</span>` 
            : '';
        tr.innerHTML = `
            <td>
                <input type="checkbox" class="sales-row-checkbox" data-id="${item.id}" onchange="updateSelectedSalesCount()" ${item.billed ? 'disabled' : ''}>
            </td>
            <td style="font-family: monospace; color: var(--text-secondary); text-align: center; font-weight: bold;">${index + 1}</td>
            <td>${formatDateString(item.date)}</td>
            <td><code>${item.invoiceNo || '-'}</code></td>
            <td><strong>${item.customer}</strong></td>
            <td>${prodName}<br><span class="badge ${qualityBadgeColor} text-xs">${item.qualityGrade || 'Grade A'}</span>${item.qualityRemark ? `<br><span class="text-xs text-muted">${item.qualityRemark}</span>` : ''}</td>
            <td>${parseFloat(item.weight).toFixed(2)} Qtl${ppSummary}${juteSummary}</td>
            <td>₹${parseFloat(item.rate).toLocaleString('en-IN')}</td>
            <td><strong>₹${subTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong></td>
            <td><code>${item.lorryNo}</code></td>
            <td>${item.destination}</td>
            <td><span class="badge ${item.status === 'Paid' ? 'badge-success' : 'badge-warning'}">${item.status}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editSale('${item.id}')" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteSale('${item.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function calculateSalesMiniKPIs() {
    let total = 0; let paid = 0; let pending = 0;
    state.sales.forEach(s => {
        const amt = s.weight * s.rate;
        total += amt;
        if (s.status === 'Paid') paid += amt;
        else pending += amt;
    });

    const elTot = document.getElementById('sales-kpi-total');
    if (elTot) elTot.textContent = `₹${total.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
    
    const elPaid = document.getElementById('sales-kpi-paid');
    if (elPaid) elPaid.textContent = `₹${paid.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
    
    const elPend = document.getElementById('sales-kpi-pending');
    if (elPend) elPend.textContent = `₹${pending.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
}

function updateSelectedSalesCount() {
    const selected = document.querySelectorAll('.sales-row-checkbox:checked').length;
    const el = document.getElementById('selected-sales-count');
    if (el) el.textContent = `${selected} items selected`;
    
    const btn = document.getElementById('sales-invoice-btn');
    if (btn) btn.toggleAttribute('disabled', selected === 0);
}

function populateSalesCustomersDropdown() {
    const dl = document.getElementById('customers-datalist');
    if (!dl) return;
    const sortedCustomers = [...state.customers].sort((a,b) => a.name.localeCompare(b.name));
    
    dl.innerHTML = '';
    sortedCustomers.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.name;
        dl.appendChild(opt);
    });
}

function populateSalesProductsDropdown() {
    const select = document.getElementById('sales-product');
    if (!select) return;
    select.innerHTML = '<option value="">-- Select Product --</option>';
    PRODUCTS.forEach(p => {
        if (p.category !== 'Seed' && p.id !== 'sarki-bardan' && p.id !== 'gm-pp-hdr') {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name;
            select.appendChild(opt);
        }
    });
}

function handleSalesSubmit(e) {
    e.preventDefault();
    try {
        const id = document.getElementById('sales-id').value;
        const date = document.getElementById('sales-date').value;
        const customer = document.getElementById('sales-customer').value;
        const lorryNo = document.getElementById('sales-lorry').value;
        const destination = document.getElementById('sales-destination').value;
        const status = document.getElementById('sales-status-select').value;
        const dispatchStatus = document.getElementById('sales-dispatch-status').value;
        const remark = document.getElementById('sales-remark').value;
        const qualityGrade = document.getElementById('sales-quality-grade') ? document.getElementById('sales-quality-grade').value : 'Grade A';
        const qualityRemark = document.getElementById('sales-quality-remark') ? document.getElementById('sales-quality-remark').value : '';

        if (!customer) {
            alert("Customer is a required field!");
            return;
        }

        // Collect all items from the table
        const items = [];
        const tbody = document.getElementById('sales-items-tbody');
        if (tbody) {
            Array.from(tbody.children).forEach(tr => {
                const product = tr.querySelector('.sales-item-product').value;
                const weight = parseFloat(tr.querySelector('.sales-item-weight').value) || 0;
                const rate = parseFloat(tr.querySelector('.sales-item-rate').value) || 0;
                const bagType = tr.querySelector('.sales-item-bag-select').value;
                const bagQty = parseInt(tr.querySelector('.sales-item-bag-qty').value) || 0;
                const juteBagWeight = parseInt(tr.querySelector('.sales-item-jute-select').value) || 0;
                const juteBagQty = parseInt(tr.querySelector('.sales-item-jute-qty').value) || 0;

                if (product && weight > 0 && rate > 0) {
                    items.push({ product, weight, rate, bagType, bagQty, juteBagWeight, juteBagQty });
                }
            });
        }

        if (items.length === 0) {
            alert("Please enter at least one product with weight and rate!");
            return;
        }

        if (!Array.isArray(state.sales)) state.sales = [];

        if (id) {
            // Edit Mode - Should only have 1 product row since add row button is disabled/hidden
            const index = state.sales.findIndex(s => s.id === id);
            if (index !== -1) {
                removeSalesFromStockLedger(state.sales[index]);
                const itemData = items[0];
                state.sales[index] = {
                    ...state.sales[index],
                    date,
                    customer,
                    product: itemData.product,
                    lorryNo,
                    weight: itemData.weight,
                    rate: itemData.rate,
                    destination,
                    status,
                    dispatchStatus,
                    remark,
                    bagType: itemData.bagType,
                    bagQty: itemData.bagQty,
                    qualityGrade,
                    qualityRemark,
                    juteBagWeight: itemData.juteBagWeight,
                    juteBagQty: itemData.juteBagQty
                };
                addSalesToStockLedger(state.sales[index]);
            }
        } else {
            // New Mode - Multiple items saved as separate sales records in state.sales
            items.forEach((itemData, idx) => {
                const data = {
                    id: 'sal-' + Date.now() + '-' + idx,
                    invoiceNo: 'INV-' + Date.now().toString().slice(-5) + '-' + idx,
                    billed: false,
                    date,
                    customer,
                    product: itemData.product,
                    lorryNo,
                    weight: itemData.weight,
                    rate: itemData.rate,
                    destination,
                    status,
                    dispatchStatus,
                    remark: idx === 0 ? remark : (remark ? remark + ` (Part of dispatch Lorry ${lorryNo})` : `Part of dispatch Lorry ${lorryNo}`),
                    bagType: itemData.bagType,
                    bagQty: itemData.bagQty,
                    qualityGrade,
                    qualityRemark,
                    juteBagWeight: itemData.juteBagWeight,
                    juteBagQty: itemData.juteBagQty
                };
                state.sales.push(data);
                addSalesToStockLedger(data);
            });
        }

        saveState();
        closeModal('sales-modal');
        // Clear filters to ensure visibility
        const fSalesCust = document.getElementById('filter-sales-customer');
        if (fSalesCust) fSalesCust.value = "";
        const fSalesProd = document.getElementById('filter-sales-product');
        if (fSalesProd) fSalesProd.value = "";
        const fSalesStat = document.getElementById('filter-sales-status');
        if (fSalesStat) fSalesStat.value = "";
        renderAllViews();
        alert("Sales dispatches logged!");
    } catch(err) {
        alert("Error saving sale: " + err.message);
    }
}

function addSalesToStockLedger(item) {
    if (!item || !item.date) return;
    if (item.dispatchStatus === 'Rejected' || item.dispatchStatus === 'Returned') return;
    const dateObj = new Date(item.date);
    if (isNaN(dateObj.getTime())) return;
    
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = dateObj.getDate();
    
    const monthKey = `${year}-${month}`;
    const productKey = item.product;
    
    // Auto switch month selector
    const stockMonthSel = document.getElementById('stock-month-selector');
    if (stockMonthSel) {
        let exists = false;
        for (let i = 0; i < stockMonthSel.options.length; i++) {
            if (stockMonthSel.options[i].value === monthKey) {
                exists = true;
                break;
            }
        }
        if (!exists) {
            const opt = document.createElement('option');
            opt.value = monthKey;
            const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
            opt.textContent = `${monthNames[dateObj.getMonth()]} ${year}`;
            stockMonthSel.appendChild(opt);
        }
        stockMonthSel.value = monthKey;
    }
    
    // Sale issues are dynamically calculated in getDayLog.
    // Only track Outbound Bardan packaging bag issue in stockDaily:
    if (item.bagType && item.bagQty > 0) {
        const bagKey = item.bagType;
        if (!state.stockDaily[monthKey]) state.stockDaily[monthKey] = {};
        if (!state.stockDaily[monthKey][bagKey]) state.stockDaily[monthKey][bagKey] = {};
        if (!state.stockDaily[monthKey][bagKey][day]) state.stockDaily[monthKey][bagKey][day] = { receipt: 0, issue: 0 };
        state.stockDaily[monthKey][bagKey][day].issue += parseInt(item.bagQty) || 0;
    }
}

function removeSalesFromStockLedger(item) {
    if (!item || !item.date) return;
    if (item.dispatchStatus === 'Rejected' || item.dispatchStatus === 'Returned') return;
    const dateObj = new Date(item.date);
    if (isNaN(dateObj.getTime())) return;
    
    const monthKey = `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}`;
    const day = dateObj.getDate();
    const productKey = item.product;
    
    if (state.stockDaily[monthKey]) {
        // Sale issues are dynamic, only reverse Bardan packaging bag issue:
        if (item.bagType && item.bagQty > 0) {
            const bagKey = item.bagType;
            if (state.stockDaily[monthKey][bagKey] && state.stockDaily[monthKey][bagKey][day]) {
                state.stockDaily[monthKey][bagKey][day].issue -= parseInt(item.bagQty) || 0;
                if (state.stockDaily[monthKey][bagKey][day].issue < 0) state.stockDaily[monthKey][bagKey][day].issue = 0;
            }
        }
    }
}

function editSale(id) {
    const item = state.sales.find(s => s.id === id);
    if (!item) return;
    populateSalesCustomersDropdown();
    
    document.getElementById('sales-id').value = item.id;
    document.getElementById('sales-date').value = item.date;
    document.getElementById('sales-customer').value = item.customer;
    document.getElementById('sales-lorry').value = item.lorryNo;
    document.getElementById('sales-destination').value = item.destination;
    document.getElementById('sales-status-select').value = item.status;
    document.getElementById('sales-dispatch-status').value = item.dispatchStatus || 'Standard';
    document.getElementById('sales-remark').value = item.remark || '';
    if (document.getElementById('sales-quality-grade')) document.getElementById('sales-quality-grade').value = item.qualityGrade || 'Grade A';
    if (document.getElementById('sales-quality-remark')) document.getElementById('sales-quality-remark').value = item.qualityRemark || '';

    // Clear and populate exactly one row representing this sale record's product details
    const tbody = document.getElementById('sales-items-tbody');
    if (tbody) {
        tbody.innerHTML = '';
        addSalesItemRow(item.product, item.weight, item.rate, item.bagType, item.bagQty, item.juteBagWeight, item.juteBagQty);
    }
    
    // Hide the add product row button in edit mode because editing a single sale record should remain restricted to 1 product
    const addBtn = document.getElementById('sales-add-row-btn');
    if (addBtn) addBtn.style.display = 'none';

    document.getElementById('sales-modal-title').textContent = "Edit Outward Sales Entry";
    openModal('sales-modal');
}

function deleteSale(id) {
    if (confirm("Are you sure? This will return issued product weights and PP bags back to stock statement.")) {
        const item = state.sales.find(s => s.id === id);
        if (item) removeSalesFromStockLedger(item);
        state.sales = state.sales.filter(s => s.id !== id);
        saveState();
        renderAllViews();
    }
}

function updateCustomerFilters() {
    const select = document.getElementById('filter-sales-customer');
    if (!select) return;
    const currentVal = select.value;
    
    const customers = [...new Set(state.sales.map(s => s.customer))].sort();
    
    select.innerHTML = '<option value="">All Customers</option>';
    customers.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c;
        opt.textContent = c;
        select.appendChild(opt);
    });
    select.value = currentVal;
}

// --- CLIENT DIRECTORY CONTROLLER ---
function renderCustomersTable() {
    const tbody = document.getElementById('customers-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.customers.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">No customers registered in database.</td></tr>`;
        return;
    }

    state.customers.forEach(c => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${c.name}</strong></td>
            <td>${c.contact || '-'}</td>
            <td><code>${c.phone}</code></td>
            <td><code class="text-success">${c.gstin}</code></td>
            <td><small>${c.address}</small></td>
            <td><span class="badge badge-info">${c.terms}</span></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="editCustomer('${c.id}')"><i class="fa-solid fa-pencil"></i></button>
                <button class="btn btn-danger btn-sm" onclick="deleteCustomer('${c.id}')"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleCustomerSubmit(e) {
    e.preventDefault();
    try {
        const id = document.getElementById('cust-id').value;
        const name = document.getElementById('cust-name').value.trim();
        const gstin = document.getElementById('cust-gstin').value.trim();
        const contact = document.getElementById('cust-contact').value.trim();
        const phone = document.getElementById('cust-phone').value.trim();
        const address = document.getElementById('cust-address').value.trim();
        const terms = document.getElementById('cust-terms').value.trim();

        if (!name || !gstin || !phone || !address) {
            alert("Error: Please fill out all required fields marked with * (Company Name, GSTIN, Phone, and Address).");
            return;
        }

        const data = { name, gstin, contact, phone, address, terms };

        if (!Array.isArray(state.customers)) {
            state.customers = [];
        }

        if (id) {
            const idx = state.customers.findIndex(c => c.id === id);
            if (idx !== -1) {
                state.customers[idx] = { ...state.customers[idx], ...data };
            }
        } else {
            data.id = 'cst-' + Date.now();
            state.customers.push(data);
        }

        saveState();
        closeModal('customer-modal');
        renderAllViews();
        alert("Customer saved successfully!");
    } catch (err) {
        alert("Error saving customer: " + err.message);
        console.error(err);
    }
}

function editCustomer(id) {
    const item = state.customers.find(c => c.id === id);
    if (!item) return;

    document.getElementById('cust-id').value = item.id;
    document.getElementById('cust-name').value = item.name;
    document.getElementById('cust-gstin').value = item.gstin;
    document.getElementById('cust-contact').value = item.contact || '';
    document.getElementById('cust-phone').value = item.phone;
    document.getElementById('cust-address').value = item.address;
    document.getElementById('cust-terms').value = item.terms;

    document.getElementById('customer-modal-title').textContent = "Edit Client Details";
    openModal('customer-modal');
}

function deleteCustomer(id) {
    if (confirm("Are you sure? Removing a customer will not delete previous sales records, but will remove their registration profiles.")) {
        state.customers = state.customers.filter(c => c.id !== id);
        saveState();
        renderAllViews();
    }
}

// --- INVOICES ARCHIVE CONTROLLER ---
function renderInvoicesArchive() {
    const tbody = document.getElementById('invoices-archive-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (state.salesInvoices.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted py-4">No archived invoices found.</td></tr>`;
        return;
    }

    state.salesInvoices.sort((a,b) => new Date(b.date) - new Date(a.date)).forEach(inv => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${formatDateString(inv.date)}</td>
            <td><code>${inv.invoiceNo}</code></td>
            <td><strong>${inv.partyName}</strong></td>
            <td><span class="badge ${inv.type === 'inward' ? 'badge-info' : 'badge-success'}">${inv.type === 'inward' ? 'Inward Purchase' : 'Outward Sales'}</span></td>
            <td>${inv.totalQty.toFixed(2)} units</td>
            <td><strong>₹${inv.grandTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}</strong></td>
            <td>₹${inv.taxAmount.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
            <td><small class="text-muted">${inv.itemCount} items</small></td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="reprintArchivedInvoice('${inv.id}')" title="Print/View"><i class="fa-solid fa-print"></i> View</button>
                <button class="btn btn-danger btn-sm" onclick="deleteArchivedInvoice('${inv.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function reprintArchivedInvoice(id) {
    const inv = state.salesInvoices.find(i => i.id === id);
    if (!inv) return;

    switchTab('invoices');
    document.getElementById('invoice-empty-msg').style.display = 'none';
    document.getElementById('invoice-ledger-content').style.display = 'block';
    document.getElementById('preview-actions-bar').style.display = 'flex';

    document.getElementById('preview-receipt-id').textContent = inv.invoiceNo;
    document.getElementById('preview-bill-date').textContent = formatDateString(inv.date);
    document.getElementById('preview-supplier-name').textContent = inv.partyName;
    document.getElementById('preview-party-type-label').textContent = inv.type === 'inward' ? 'Supplier' : 'Customer';
    document.getElementById('preview-invoice-subtitle').textContent = inv.type === 'inward' ? "Seed Unloading & Calculations Receipt Log" : "Finished Goods Outward Tax Invoice";
    document.getElementById('preview-bill-period').textContent = inv.period;

    const partyGSTIN = document.getElementById('preview-party-gstin-row');
    const partyAddress = document.getElementById('preview-party-address-row');
    if (inv.type === 'outward' && inv.customerProfile) {
        partyGSTIN.style.display = 'block';
        partyAddress.style.display = 'block';
        document.getElementById('preview-party-gstin').textContent = inv.customerProfile.gstin;
        document.getElementById('preview-party-address').textContent = inv.customerProfile.address;
    } else {
        partyGSTIN.style.display = 'none';
        partyAddress.style.display = 'none';
    }

    const tableHeader = document.getElementById('preview-table-hdr');
    tableHeader.innerHTML = inv.type === 'inward'
        ? `<th>Lorry No</th><th>Date</th><th>Location</th><th>Weight (Qtl)</th><th>FOR Rate (₹)</th><th class="text-right">Line Total (₹)</th>`
        : `<th>Invoice / Lorry</th><th>Date</th><th>Product</th><th>Quantity</th><th>Rate (₹)</th><th class="text-right">Line Total (₹)</th>`;

    const itemTbody = document.getElementById('preview-items-tbody');
    itemTbody.innerHTML = '';
    inv.itemsList.forEach(item => {
        const tr = document.createElement('tr');
        if (inv.type === 'inward') {
            tr.innerHTML = `
                <td><code>${item.lorryNo}</code></td>
                <td>${formatDateString(item.date)}</td>
                <td>${item.location || '-'}</td>
                <td>${item.weight.toFixed(2)} Qtl</td>
                <td>₹${item.rate.toFixed(2)}</td>
                <td class="text-right font-bold">₹${item.total.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
            `;
        } else {
            tr.innerHTML = `
                <td><code>${item.lorryNo}</code></td>
                <td>${formatDateString(item.date)}</td>
                <td>${item.productName}</td>
                <td>${item.weight.toFixed(2)}</td>
                <td>₹${item.rate.toFixed(2)}</td>
                <td class="text-right font-bold">₹${item.total.toLocaleString('en-IN', {maximumFractionDigits:2})}</td>
            `;
        }
        itemTbody.appendChild(tr);
    });

    document.getElementById('preview-notebook-math').innerHTML = inv.notebookMath || 'Loaded from archived calculation record.';
    document.getElementById('preview-total-weight').textContent = `${inv.totalQty.toFixed(2)} units`;
    document.getElementById('preview-subtotal').textContent = `₹${inv.subtotal.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
    
    const cgstRow = document.getElementById('cgst-row');
    const sgstRow = document.getElementById('sgst-row');
    const igstRow = document.getElementById('igst-row');
    cgstRow.style.display = 'none'; sgstRow.style.display = 'none'; igstRow.style.display = 'none';

    if (inv.taxAmount > 0 && inv.type === 'outward') {
        const isMaharashtra = inv.customerProfile && inv.customerProfile.address.toLowerCase().includes('maharashtra');
        if (isMaharashtra) {
            cgstRow.style.display = 'table-row';
            sgstRow.style.display = 'table-row';
            document.getElementById('preview-cgst-amount').textContent = `₹${(inv.taxAmount / 2).toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('preview-sgst-amount').textContent = `₹${(inv.taxAmount / 2).toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('cgst-label').textContent = `CGST (${(inv.taxPercent / 2)}%):`;
            document.getElementById('sgst-label').textContent = `SGST (${(inv.taxPercent / 2)}%):`;
        } else {
            igstRow.style.display = 'table-row';
            document.getElementById('preview-igst-amount').textContent = `₹${inv.taxAmount.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
            document.getElementById('igst-label').textContent = `IGST (${inv.taxPercent}%):`;
        }
    }

    document.getElementById('preview-adjustments').textContent = `₹${inv.adjustments.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
    document.getElementById('preview-grand-total').textContent = `₹${inv.grandTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}/-`;
    document.getElementById('preview-words-amount').textContent = inv.wordsAmount || numberToWords(inv.grandTotal);

    document.getElementById('save-invoice-log-btn').setAttribute('data-target-ids', '[]');
}

function deleteArchivedInvoice(id) {
    if (confirm("Are you sure you want to delete this archived invoice calculation?")) {
        state.salesInvoices = state.salesInvoices.filter(i => i.id !== id);
        saveState();
        renderInvoicesArchive();
    }
}

// Dual-mode unbilled items loader
function loadSupplierUnbilledItems(partyName, selectIds = []) {
    const container = document.getElementById('bill-lorries-list');
    if (!container) return;
    container.innerHTML = '';
    
    if (!partyName) {
        container.innerHTML = '<span class="text-muted small">Select a party to load pending transactions.</span>';
        return;
    }

    const mode = document.getElementById('bill-mode-select').value;
    
    if (mode === 'inward') {
        const pending = state.unloads.filter(u => u.supplier === partyName);
        if (pending.length === 0) {
            container.innerHTML = '<span class="text-danger small">No lorry unloads logged for this supplier.</span>';
            return;
        }
        pending.forEach(lorry => {
            const wrapper = document.createElement('div');
            wrapper.className = 'lorry-checkbox-item';
            const isBilledTag = lorry.billed ? ' <span class="badge badge-success text-xs">Billed</span>' : '';
            const checkedStr = selectIds.includes(lorry.id) || !lorry.billed ? 'checked' : '';
            const disabledStr = lorry.billed ? 'disabled' : '';
            wrapper.innerHTML = `
                <input type="checkbox" class="bill-item-cb" data-id="${lorry.id}" ${checkedStr} ${disabledStr}>
                <span>
                    <strong>${formatDateString(lorry.date)}</strong> - Lorry: <code>${lorry.lorryNo}</code> - Weight: <strong>${lorry.weight.toFixed(2)} Qtl</strong> @ ₹${lorry.forRate.toFixed(0)} FOR ${isBilledTag}
                </span>
            `;
            container.appendChild(wrapper);
        });
    } else {
        const pending = state.sales.filter(s => s.customer === partyName);
        if (pending.length === 0) {
            container.innerHTML = '<span class="text-danger small">No sales dispatches logged for this customer.</span>';
            return;
        }
        pending.forEach(sale => {
            const wrapper = document.createElement('div');
            wrapper.className = 'lorry-checkbox-item';
            const isBilledTag = sale.billed ? ' <span class="badge badge-success text-xs">Billed</span>' : '';
            const checkedStr = selectIds.includes(sale.id) || !sale.billed ? 'checked' : '';
            const disabledStr = sale.billed ? 'disabled' : '';
            const prodObj = PRODUCTS.find(p => p.id === sale.product);
            const prodName = prodObj ? prodObj.name : sale.product;
            wrapper.innerHTML = `
                <input type="checkbox" class="bill-item-cb" data-id="${sale.id}" ${checkedStr} ${disabledStr}>
                <span>
                    <strong>${formatDateString(sale.date)}</strong> - Product: <strong>${prodName}</strong> - Lorry: <code>${sale.lorryNo}</code> - Weight: <strong>${sale.weight.toFixed(2)} Qtl</strong> @ ₹${sale.rate.toFixed(0)}/Qtl ${isBilledTag}
                </span>
            `;
            container.appendChild(wrapper);
        });
    }
}

// Indian Numbering System Converter
function numberToWords(num) {
    if (num === 0) return 'Rupees Zero Only';
    
    const units = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 
                   'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    
    function convertBelowThousand(n) {
        if (n < 20) return units[n];
        const hundred = Math.floor(n / 100);
        const remainder = n % 100;
        let word = '';
        if (hundred > 0) {
            word += units[hundred] + ' Hundred';
            if (remainder > 0) word += ' and ';
        }
        if (remainder < 20) {
            word += units[remainder];
        } else {
            const ten = Math.floor(remainder / 10);
            const unit = remainder % 10;
            word += tens[ten];
            if (unit > 0) word += '-' + units[unit];
        }
        return word;
    }

    let words = '';
    
    const crores = Math.floor(num / 10000000);
    let remaining = num % 10000000;
    if (crores > 0) {
        words += convertBelowThousand(crores) + ' Crore ';
    }
    
    const lakhs = Math.floor(remaining / 100000);
    remaining = remaining % 100000;
    if (lakhs > 0) {
        words += convertBelowThousand(lakhs) + ' Lakh ';
    }
    
    const thousands = Math.floor(remaining / 1000);
    remaining = remaining % 1000;
    if (thousands > 0) {
        words += convertBelowThousand(thousands) + ' Thousand ';
    }
    
    if (remaining > 0) {
        words += convertBelowThousand(remaining);
    }
    
    return 'Rupees ' + words.trim() + ' Only';
}

// Define mock customers
function seedMockCustomers() {
    state.customers = [
        { id: 'cust-mock-1', name: 'Vardhaman Refinery Ltd', contact: 'Anil Mehta', phone: '+91 98765 43210', address: 'Plot 42, Jalna MIDC, Maharashtra', gstin: '27AAAAA1111A1Z1' },
        { id: 'cust-mock-2', name: 'Kalyan Cattle Feeds', contact: 'Kalyan Shah', phone: '+91 94220 12345', address: 'Near Bus Stand, Beed, Maharashtra', gstin: '27BBBBB2222B2Z2' },
        { id: 'cust-mock-3', name: 'Balaji Oil Trading', contact: 'Venkatesh Rao', phone: '+91 99887 76655', address: 'Secunderabad, Telangana', gstin: '36CCCCC3333C3Z3' },
        { id: 'cust-mock-4', name: 'Girish Agro Trading', contact: 'Girish Patil', phone: '+91 91580 98765', address: 'Latur MIDC, Maharashtra', gstin: '27DDDDD4444D4Z4' }
    ];
}

// Define mock suppliers
function seedMockSuppliers() {
    state.suppliers = [
        { id: 'sup-mock-1', name: 'Satyan Agco', contact: 'Satyanarayan Rao', phone: '+91 94222 11111', address: 'Secunderabad, Telangana', gstin: '36ABCDE1234F1Z0' },
        { id: 'sup-mock-2', name: 'Sundaram Indus', contact: 'Sundaram Chettiar', phone: '+91 94222 22222', address: 'Pachod, Aurangabad, Maharashtra', gstin: '27FGHIJ5678K2Z5' },
        { id: 'sup-mock-3', name: 'Kunal Cotton', contact: 'Kunal Deshmukh', phone: '+91 94222 33333', address: 'Majalgaon, Beed, Maharashtra', gstin: '27KLMNO9012P3Z8' },
        { id: 'sup-mock-4', name: 'Rajendra Agco', contact: 'Rajendra Prasad', phone: '+91 94222 44444', address: 'Hyderabad, Telangana', gstin: '36QRSTU3456V4Z2' },
        { id: 'sup-mock-5', name: 'Padmavati', contact: 'Padmakar Joshi', phone: '+91 94222 55555', address: 'Pachod, Aurangabad, Maharashtra', gstin: '27WXYZ1234A5Z9' },
        { id: 'sup-mock-6', name: 'Harita Cotton', contact: 'Harish Rao', phone: '+91 94222 66666', address: 'Gevrai, Beed, Maharashtra', gstin: '27BCDEF6789G6Z0' }
    ];
}

// Override seedMockData to also seed customer/sales dispatches
const originalSeedMockData = seedMockData;
seedMockData = function() {
    originalSeedMockData();
    seedMockSuppliers();
    seedMockCustomers();
    
    // Enrich raw material unloads with split weights, shortages, discounts, and GST rates
    state.unloads = state.unloads.map((u, i) => {
        const shortage = i % 3 === 0 ? 0.50 : (i % 3 === 1 ? 0.30 : 0);
        const discount = u.id === 'unl-mock-2' ? 10 : (u.id === 'unl-mock-4' ? 15 : 0);
        return {
            ...u,
            invoiceWeight: parseFloat((u.weight + shortage).toFixed(2)),
            shortage: shortage,
            discount: discount,
            gstRate: 5,
            quality: u.remark || 'Moisture: 10%'
        };
    });
    
    // Seed initial production logs
    state.productionLogs = [
        {
            id: 'prd-mock-1',
            date: '2026-07-02',
            unloadId: 'unl-mock-1',
            seedType: 'cs-oms',
            weight: 50.00,
            oilYield: 7.50,
            cakeYield: 40.00,
            hullsYield: 2.00,
            remark: 'Expeller #1 Shift A'
        },
        {
            id: 'prd-mock-2',
            date: '2026-07-04',
            unloadId: 'unl-mock-3',
            seedType: 'cs-oms',
            weight: 60.00,
            oilYield: 9.00,
            cakeYield: 48.50,
            hullsYield: 2.10,
            remark: 'Expeller #2 Shift B'
        },
        {
            id: 'prd-mock-3',
            date: '2026-07-08',
            unloadId: 'unl-mock-2',
            seedType: 'cs-oms',
            weight: 45.00,
            oilYield: 6.80,
            cakeYield: 36.20,
            hullsYield: 1.80,
            remark: 'Expeller #3 Shift C'
        }
    ];
    
    // Apply production logs to the daily stock ledger
    state.productionLogs.forEach(p => {
        addProductionToStockLedger(p);
    });

    // seed initial sales logs
    state.sales = [
        { id: 'sal-mock-1', date: '2026-06-12', invoiceNo: 'INV-10023', customer: 'Vardhaman Refinery Ltd', product: 'oil-crude', lorryNo: 'MH-20-Y-4589', weight: 200.00, rate: 9500, destination: 'Jalna', status: 'Paid', billed: true, bagType: '', bagQty: 0 },
        { id: 'sal-mock-2', date: '2026-06-15', invoiceNo: 'INV-10024', customer: 'Kalyan Cattle Feeds', product: 'khal-mm', lorryNo: 'MH-16-CC-1245', weight: 1500.00, rate: 2850, destination: 'Beed', status: 'Paid', billed: true, bagType: 'gm-pp-50', bagQty: 3000 },
        { id: 'sal-mock-3', date: '2026-06-25', invoiceNo: 'INV-10025', customer: 'Vardhaman Refinery Ltd', product: 'oil-crude', lorryNo: 'MH-23-A-8756', weight: 211.12, rate: 9600, destination: 'Hyderabad', status: 'Paid', billed: true, bagType: '', bagQty: 0 },
        { id: 'sal-mock-4', date: '2026-06-26', invoiceNo: 'INV-10026', customer: 'Kalyan Cattle Feeds', product: 'khal-mm', lorryNo: 'MH-16-CC-9856', weight: 1606.99, rate: 2850, destination: 'Beed', status: 'Pending', billed: false, bagType: 'gm-pp-60', bagQty: 2678 },
        { id: 'sal-mock-5', date: '2026-07-02', invoiceNo: 'INV-10027', customer: 'Balaji Oil Trading', product: 'oil-crude', lorryNo: 'MH-23-T-4581', weight: 180.00, rate: 9650, destination: 'Hyderabad', status: 'Pending', billed: false, bagType: '', bagQty: 0 },
        { id: 'sal-mock-6', date: '2026-07-04', invoiceNo: 'INV-10028', customer: 'Vardhaman Refinery Ltd', product: 'oil-wash', lorryNo: 'MH-20-A-4122', weight: 150.00, rate: 9200, destination: 'Jalna', status: 'Pending', billed: false, bagType: '', bagQty: 0 },
        { id: 'sal-mock-7', date: '2026-07-06', invoiceNo: 'INV-10029', customer: 'Girish Agro Trading', product: 'ch-oms', lorryNo: 'MH-18-M-1478', weight: 250.00, rate: 1200, destination: 'Latur', status: 'Pending', billed: false, bagType: 'gm-pp-km', bagQty: 500 }
    ];
    state.salesInvoices = [
        {
            id: 'inv-mock-1',
            invoiceNo: '#VOM-SALES-10023',
            date: '2026-06-12',
            partyName: 'Vardhaman Refinery Ltd',
            type: 'outward',
            period: '12/06/2026',
            totalQty: 200.00,
            subtotal: 1900000,
            taxPercent: 5,
            taxAmount: 95000,
            adjustments: 0,
            grandTotal: 1995000,
            wordsAmount: 'Rupees Nineteen Lakh Ninety-Five Thousand Only',
            notebookMath: '<div class="mb-2"><strong>Group 1: Rate ₹9500/-</strong><div class="notebook-math-line"><span>&nbsp;&nbsp;1) Outward Lorry MH-20-Y-4589 [12/6]</span><span>200.00 Units</span></div><div class="notebook-sum-line"><span>&nbsp;&nbsp;Sum Total:</span><span>200.00 Units x ₹9500</span></div><div class="text-right font-bold text-success">Subtotal: ₹19,00,000/-</div></div>',
            customerProfile: { address: 'Plot 42, Jalna MIDC, Maharashtra', gstin: '27AAAAA1111A1Z1' },
            itemsList: [{ date: '2026-06-12', lorryNo: 'MH-20-Y-4589', productName: 'Crud Oil', weight: 200.00, rate: 9500, total: 1900000 }],
            itemCount: 1
        }
    ];
    


    // Seed realistic payments for Party Accounts Ledger
    state.payments = [
        // Supplier payments (outward payouts)
        { id: 'pay-mock-1', date: '2026-07-03', partyName: 'Satyan Agco', partyRole: 'supplier', type: 'Paid', amount: 250000, method: 'Bank', remark: 'RTGS - Advance for July cotton seed' },
        { id: 'pay-mock-2', date: '2026-07-05', partyName: 'Kunal Cotton', partyRole: 'supplier', type: 'Paid', amount: 150000, method: 'Cheque', remark: 'Chq No 245617' },
        { id: 'pay-mock-3', date: '2026-07-07', partyName: 'Sundaram Indus', partyRole: 'supplier', type: 'Paid', amount: 300000, method: 'Bank', remark: 'NEFT - Part Payment July' },
        { id: 'pay-mock-4', date: '2026-07-08', partyName: 'Rajendra Agco', partyRole: 'supplier', type: 'Paid', amount: 500000, method: 'Bank', remark: 'RTGS - Full settlement' },
        { id: 'pay-mock-5', date: '2026-07-09', partyName: 'Padmavati', partyRole: 'supplier', type: 'Paid', amount: 200000, method: 'Cash', remark: 'Cash payment at office' },

        // Customer receipts (inward payments)
        { id: 'pay-mock-6', date: '2026-06-18', partyName: 'Vardhaman Refinery Ltd', partyRole: 'customer', type: 'Received', amount: 1000000, method: 'Bank', remark: 'RTGS - Against INV-10023' },
        { id: 'pay-mock-7', date: '2026-06-28', partyName: 'Vardhaman Refinery Ltd', partyRole: 'customer', type: 'Received', amount: 995000, method: 'Bank', remark: 'RTGS - Against INV-10023 balance' },
        { id: 'pay-mock-8', date: '2026-06-20', partyName: 'Kalyan Cattle Feeds', partyRole: 'customer', type: 'Received', amount: 2000000, method: 'Bank', remark: 'NEFT - Against INV-10024 part' },
        { id: 'pay-mock-9', date: '2026-07-05', partyName: 'Balaji Oil Trading', partyRole: 'customer', type: 'Received', amount: 800000, method: 'Bank', remark: 'RTGS - Advance for July delivery' },
        { id: 'pay-mock-10', date: '2026-07-08', partyName: 'Girish Agro Trading', partyRole: 'customer', type: 'Received', amount: 150000, method: 'Cheque', remark: 'Chq No 789456' }
    ];
    
    saveState();
    renderAllViews();
    alert("Mock database seeded successfully! Suppliers, customers, raw material unloads, production runs, sales dispatches, payments, transport logs, and stock logs have been fully populated.");
};


// ==========================================
// --- NEW ERP FEATURES IMPLEMENTATIONS ---
// ==========================================

function escapeHtml(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
}

// --- SUB-TAB NAVIGATOR FOR UNLOADS ---
function switchUnloadsSubtab(subtabId) {
    document.querySelectorAll('#unloads .inner-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
    });

    document.querySelectorAll('.unloads-subpane').forEach(pane => {
        pane.classList.toggle('active', pane.getAttribute('id') === `${subtabId}-subtab`);
    });

    if (subtabId === 'unloads-register') {
        renderUnloadTable();
    } else if (subtabId === 'supplier-directory') {
        renderSuppliersTable();
    }
}

// --- SUPPLIER DIRECTORY LOGIC ---
function renderSuppliersTable() {
    const tbody = document.getElementById('suppliers-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (!state.suppliers || state.suppliers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No suppliers registered. Click "+ New Supplier" to register.</td></tr>';
        return;
    }
    
    state.suppliers.forEach(sup => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="font-bold">${escapeHtml(sup.name)}</td>
            <td>${escapeHtml(sup.contact || '-')}</td>
            <td>${escapeHtml(sup.phone || '-')}</td>
            <td><code>${escapeHtml(sup.gstin || '-')}</code></td>
            <td>${escapeHtml(sup.address || '-')}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-outline-primary" onclick="editSupplier('${sup.id}')"><i class="fa-solid fa-pen"></i></button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteSupplier('${sup.id}')"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleSupplierSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('supp-id').value;
    const name = document.getElementById('supp-name').value.trim();
    const gstin = document.getElementById('supp-gstin').value.trim().toUpperCase();
    const contact = document.getElementById('supp-contact').value.trim();
    const phone = document.getElementById('supp-phone').value.trim();
    const address = document.getElementById('supp-address').value.trim();
    
    if (!name) return;
    
    const data = { name, gstin, contact, phone, address };
    
    if (id) {
        const idx = state.suppliers.findIndex(s => s.id === id);
        if (idx !== -1) {
            // Update historical unloads with the new name if changed
            const oldName = state.suppliers[idx].name;
            if (oldName !== name) {
                state.unloads.forEach(u => {
                    if (u.supplier === oldName) u.supplier = name;
                });
            }
            state.suppliers[idx] = { ...state.suppliers[idx], ...data };
        }
    } else {
        data.id = 'sup-' + Date.now();
        state.suppliers.push(data);
    }
    
    saveState();
    closeModal('supplier-modal');
    renderAllViews();
    alert("Supplier details saved successfully!");
}

function editSupplier(id) {
    const sup = state.suppliers.find(s => s.id === id);
    if (!sup) return;
    document.getElementById('supp-id').value = sup.id;
    document.getElementById('supp-name').value = sup.name;
    document.getElementById('supp-gstin').value = sup.gstin || '';
    document.getElementById('supp-contact').value = sup.contact || '';
    document.getElementById('supp-phone').value = sup.phone || '';
    document.getElementById('supp-address').value = sup.address || '';
    
    document.getElementById('supplier-modal-title').textContent = "Edit Supplier Details";
    openModal('supplier-modal');
}

function deleteSupplier(id) {
    if (confirm("Are you sure you want to delete this supplier? This will not remove their historical unloads.")) {
        state.suppliers = state.suppliers.filter(s => s.id !== id);
        saveState();
        renderAllViews();
    }
}

function populateSupplierDropdowns() {
    const dl = document.getElementById('suppliers-datalist');
    if (!dl) return;
    const sortedSuppliers = [...state.suppliers].sort((a,b) => a.name.localeCompare(b.name));
    
    dl.innerHTML = '';
    sortedSuppliers.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.name;
        dl.appendChild(opt);
    });
}

function getLotAvailableWeight(unloadId, excludeLogId = '') {
    const load = state.unloads.find(u => u.id === unloadId);
    if (!load) return 0;
    
    const issued = state.productionLogs
        .filter(p => p.unloadId === unloadId && p.id !== excludeLogId)
        .reduce((sum, p) => sum + (parseFloat(p.weight) || 0), 0);
        
    return parseFloat((load.weight - issued).toFixed(2));
}

function populateProductionLorryDropdown(selectedUnloadId = '', currentLogId = '') {
    const select = document.getElementById('prod-lorry-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Choose Received Lorry Lot (GR) --</option>';
    
    // Sort unloads chronologically
    const activeUnloads = state.unloads
        .filter(u => u.status !== 'Rejected' && u.status !== 'Returned')
        .sort((a,b) => new Date(b.date) - new Date(a.date));
        
    activeUnloads.forEach(u => {
        const avail = getLotAvailableWeight(u.id, currentLogId);
        
        if (avail > 0 || u.id === selectedUnloadId) {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.lorryNo} - ${u.supplier} (Avail: ${avail.toFixed(2)} Qtl)`;
            select.appendChild(opt);
        }
    });
}

function handleProductionLotChange() {
    const select = document.getElementById('prod-lorry-select');
    const seedTypeSelect = document.getElementById('prod-seed-type');
    const display = document.getElementById('prod-avail-weight-display');
    const logId = document.getElementById('prod-log-id').value;
    
    if (!select || !select.value) {
        if (seedTypeSelect) seedTypeSelect.value = 'cs-oms';
        if (display) display.textContent = 'No lot selected yet';
        return;
    }
    
    const unloadId = select.value;
    const load = state.unloads.find(u => u.id === unloadId);
    if (load) {
        if (seedTypeSelect) {
            if (load.seedType === 'MS') seedTypeSelect.value = 'cs-ms';
            else if (load.seedType === 'Kandi') seedTypeSelect.value = 'kandi';
            else seedTypeSelect.value = 'cs-oms';
        }
        
        const avail = getLotAvailableWeight(unloadId, logId);
        if (display) {
            display.textContent = `Available: ${avail.toFixed(2)} Qtl (Total Load: ${load.weight.toFixed(2)} Qtl)`;
            display.style.color = '';
        }
    }
}

function validateProductionWeightLimit() {
    const select = document.getElementById('prod-lorry-select');
    const weightInput = document.getElementById('prod-weight');
    const display = document.getElementById('prod-avail-weight-display');
    const logId = document.getElementById('prod-log-id').value;
    
    if (!select || !select.value || !weightInput || !display) return;
    
    const unloadId = select.value;
    const avail = getLotAvailableWeight(unloadId, logId);
    const weight = parseFloat(weightInput.value) || 0;
    
    if (weight > avail) {
        display.style.color = '#ef4444';
        display.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Warning: Issuing more than available weight (${avail.toFixed(2)} Qtl)!`;
    } else {
        display.style.color = '';
        const load = state.unloads.find(u => u.id === unloadId);
        display.textContent = `Available: ${avail.toFixed(2)} Qtl (Total Load: ${load.weight.toFixed(2)} Qtl)`;
    }
}

// --- ACTIVE CRUSHING (WHAT'S IN THE EXPELLERS NOW) ---
function populateActiveCrushingLots() {
    const select = document.getElementById('ac-lot-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Choose a lot with remaining weight --</option>';
    const activeIds = new Set(state.activeCrushing.map(a => a.unloadId));
    state.unloads
        .filter(u => u.status !== 'Rejected' && u.status !== 'Returned')
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .forEach(u => {
            const avail = getLotAvailableWeight(u.id);
            if (avail > 0 && !activeIds.has(u.id)) {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = `${u.lorryNo} — ${u.supplier} (${avail.toFixed(2)} Qtl left)`;
                select.appendChild(opt);
            }
        });
}

function handleActiveCrushingSubmit(e) {
    e.preventDefault();
    const unloadId = document.getElementById('ac-lot-select').value;
    const expeller = document.getElementById('ac-expeller').value.trim();
    if (!unloadId || !expeller) { alert('Please choose a lot and an expeller.'); return; }
    state.activeCrushing.push({
        id: 'ac-' + Date.now(),
        unloadId,
        expeller,
        startedAt: new Date().toISOString()
    });
    saveState();
    closeModal('active-crushing-modal');
    renderProductionTable();
}

function renderActiveCrushing() {
    const card = document.getElementById('active-crushing-card');
    const list = document.getElementById('active-crushing-list');
    const count = document.getElementById('active-crushing-count');
    if (!card || !list) return;

    if (!state.activeCrushing || state.activeCrushing.length === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    list.innerHTML = '';
    if (count) count.textContent = `${state.activeCrushing.length} lot${state.activeCrushing.length !== 1 ? 's' : ''} on the floor`;

    state.activeCrushing.forEach(sess => {
        const load = state.unloads.find(u => u.id === sess.unloadId);
        const remaining = load ? getLotAvailableWeight(sess.unloadId) : 0;
        const supplier = load ? load.supplier : 'Unknown lot';
        const lorry = load ? load.lorryNo : '—';
        const seedLabel = load ? (load.seedType === 'MS' ? 'MS' : 'OMS') : '—';
        const started = sess.startedAt ? new Date(sess.startedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        const done = remaining <= 0;

        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:10px 12px;border-radius:8px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.25);';
        row.innerHTML = `
            <span style="padding:4px 12px;border-radius:8px;font-weight:800;font-size:0.82rem;background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b66;white-space:nowrap;"><i class="fa-solid fa-gear fa-spin" style="--fa-animation-duration:3s;"></i> ${escapeHtml(sess.expeller)}</span>
            <div style="flex:1;min-width:180px;">
                <div style="font-weight:700;">${escapeHtml(supplier)} <span class="text-muted" style="font-weight:400;">· ${escapeHtml(lorry)} · ${seedLabel}</span></div>
                <div class="text-xs text-muted">Loaded ${started} · <strong style="color:${done ? '#ef4444' : '#10b981'};">${done ? 'Lot fully crushed' : remaining.toFixed(2) + ' Qtl remaining'}</strong></div>
            </div>
            <div style="display:flex;gap:6px;">
                <button class="btn btn-primary btn-sm" onclick="logRunForActive('${sess.id}')" title="Log a crushing run for this lot"><i class="fa-solid fa-industry"></i> Log Run</button>
                <button class="btn btn-secondary btn-sm" onclick="finishCrushing('${sess.id}')" title="Remove from the floor board"><i class="fa-solid fa-circle-check"></i> Done</button>
            </div>
        `;
        list.appendChild(row);
    });
}

function logRunForActive(sessionId) {
    const sess = state.activeCrushing.find(a => a.id === sessionId);
    if (!sess) return;
    openModal('production-modal');
    const select = document.getElementById('prod-lorry-select');
    if (select) {
        select.value = sess.unloadId;
        handleProductionLotChange();
    }
    const remark = document.getElementById('prod-remark');
    if (remark && !remark.value) remark.value = sess.expeller;
    document.getElementById('prod-date').value = new Date().toISOString().split('T')[0];
}

function finishCrushing(sessionId) {
    const sess = state.activeCrushing.find(a => a.id === sessionId);
    if (!sess) return;
    const load = state.unloads.find(u => u.id === sess.unloadId);
    const name = load ? `${load.supplier} (${load.lorryNo})` : 'this lot';
    if (!confirm(`Remove ${name} from ${sess.expeller}? This just clears the live floor board — logged crushing runs and yields are kept.`)) return;
    state.activeCrushing = state.activeCrushing.filter(a => a.id !== sessionId);
    saveState();
    renderProductionTable();
}

// --- PRODUCTION CRUSHING LOGS LOGIC ---
function renderProductionTable() {
    renderActiveCrushing();
    const tbody = document.getElementById('production-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const seedFilter = document.getElementById('prod-filter-seed')?.value || '';
    const monthFilter = document.getElementById('prod-filter-month')?.value || '';
    const minYieldFilter = parseFloat(document.getElementById('prod-filter-min-yield')?.value) || 0;

    const sortedLogs = [...state.productionLogs].sort((a,b) => new Date(b.date) - new Date(a.date));

    const filtered = sortedLogs.filter(item => {
        const seedType = item.seedType || 'cs-oms';
        if (seedFilter && seedType !== seedFilter) return false;
        if (monthFilter) {
            const itemMonth = item.date ? item.date.slice(0,7) : '';
            if (itemMonth !== monthFilter) return false;
        }
        if (minYieldFilter > 0) {
            const w = parseFloat(item.weight) || 0;
            const oil = parseFloat(item.oilYield) || 0;
            const cake = parseFloat(item.cakeYield) || 0;
            const hulls = parseFloat(item.hullsYield) || 0;
            const yp = w > 0 ? ((oil + cake + hulls) / w) * 100 : 0;
            if (yp < minYieldFilter) return false;
        }
        return true;
    });

    // --- KPI AGGREGATION ---
    // Recovery below this % (i.e. process loss above 10%) flags a run for supervisor review.
    const YIELD_ALERT_THRESHOLD = 90;
    let totalCrushed = 0, totalOil = 0, totalCake = 0, totalHulls = 0, highLossCount = 0;
    state.productionLogs.forEach(item => {
        const w = parseFloat(item.weight) || 0;
        totalCrushed += w;
        totalOil += parseFloat(item.oilYield) || 0;
        totalCake += parseFloat(item.cakeYield) || 0;
        totalHulls += parseFloat(item.hullsYield) || 0;
        const ty = (parseFloat(item.oilYield) || 0) + (parseFloat(item.cakeYield) || 0) + (parseFloat(item.hullsYield) || 0);
        if (w > 0 && (ty / w) * 100 < YIELD_ALERT_THRESHOLD) highLossCount++;
    });
    const totalLoss = totalCrushed - totalOil - totalCake - totalHulls;

    const setPct = (id, val, total) => {
        const el = document.getElementById(id);
        if (el) el.textContent = total > 0 ? `${((val/total)*100).toFixed(1)}% recovery` : '0% recovery';
    };
    const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };

    setEl('prod-kpi-crushed', `${totalCrushed.toFixed(2)} Qtl`);
    setEl('prod-kpi-runs', `${state.productionLogs.length} run${state.productionLogs.length !== 1 ? 's' : ''}`);
    setEl('prod-kpi-oil', `${totalOil.toFixed(2)} Qtl`);
    setPct('prod-kpi-oil-pct', totalOil, totalCrushed);
    setEl('prod-kpi-cake', `${totalCake.toFixed(2)} Qtl`);
    setPct('prod-kpi-cake-pct', totalCake, totalCrushed);
    setEl('prod-kpi-hulls', `${totalHulls.toFixed(2)} Qtl`);
    setPct('prod-kpi-hulls-pct', totalHulls, totalCrushed);
    setEl('prod-kpi-loss', `${Math.max(0, totalLoss).toFixed(2)} Qtl`);
    const lossEl = document.getElementById('prod-kpi-loss-pct');
    if (lossEl) {
        const lossPctTxt = totalCrushed > 0 ? `${((Math.max(0,totalLoss)/totalCrushed)*100).toFixed(1)}% loss` : '0% loss';
        lossEl.textContent = highLossCount > 0 ? `${lossPctTxt} · ⚠ ${highLossCount} run${highLossCount !== 1 ? 's' : ''} flagged` : lossPctTxt;
        lossEl.style.color = highLossCount > 0 ? '#ef4444' : '';
        lossEl.style.fontWeight = highLossCount > 0 ? '700' : '';
    }

    // Yield composition bar
    const barCard = document.getElementById('prod-yield-bar-card');
    if (barCard && totalCrushed > 0) {
        barCard.style.display = 'block';
        const oilPct = (totalOil / totalCrushed * 100).toFixed(1);
        const cakePct = (totalCake / totalCrushed * 100).toFixed(1);
        const hullsPct = (totalHulls / totalCrushed * 100).toFixed(1);
        const lossPct = Math.max(0, (totalLoss / totalCrushed * 100)).toFixed(1);
        document.getElementById('prod-bar-oil').style.width = oilPct + '%';
        document.getElementById('prod-bar-cake').style.width = cakePct + '%';
        document.getElementById('prod-bar-hulls').style.width = hullsPct + '%';
        document.getElementById('prod-bar-oil-lbl').textContent = oilPct + '%';
        document.getElementById('prod-bar-cake-lbl').textContent = cakePct + '%';
        document.getElementById('prod-bar-hulls-lbl').textContent = hullsPct + '%';
        document.getElementById('prod-bar-loss-lbl').textContent = lossPct + '%';
    } else if (barCard) {
        barCard.style.display = 'none';
    }

    // Supplier yield traceability rollup
    renderSupplierYieldSummary();

    // Empty state
    const emptyState = document.getElementById('production-empty-state');
    const tableEl = document.getElementById('production-table');
    if (filtered.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (tableEl) tableEl.style.display = 'none';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    filtered.forEach((item, index) => {
        const seedLabel = item.seedType === 'cs-ms' ? 'Cotton Seed (MS)' : 'Cotton Seed (OMS)';
        const seedBadge = item.seedType === 'cs-ms'
            ? 'background:rgba(59,130,246,0.2);color:#60a5fa;'
            : 'background:rgba(16,185,129,0.2);color:#34d399;';
        const load = state.unloads.find(u => u.id === item.unloadId);
        const lotLabel = load ? `${load.lorryNo}<br><small class="text-muted">${load.supplier}</small>` : '<small class="text-muted">General / Legacy</small>';

        const weight = parseFloat(item.weight) || 0;
        const oil = parseFloat(item.oilYield) || 0;
        const cake = parseFloat(item.cakeYield) || 0;
        const hulls = parseFloat(item.hullsYield) || 0;

        const totalYield = oil + cake + hulls;
        const loss = Math.max(0, weight - totalYield);
        const yieldPercent = weight > 0 ? ((totalYield / weight) * 100).toFixed(1) : 0;
        const lossPercent = weight > 0 ? ((loss / weight) * 100).toFixed(1) : 0;

        // Per-row inline yield bar
        const oilW = weight > 0 ? (oil / weight * 100).toFixed(1) : 0;
        const cakeW = weight > 0 ? (cake / weight * 100).toFixed(1) : 0;
        const hullsW = weight > 0 ? (hulls / weight * 100).toFixed(1) : 0;
        const lossW = weight > 0 ? (loss / weight * 100).toFixed(1) : 0;
        const miniBar = `<div style="display:flex;height:7px;border-radius:4px;overflow:hidden;gap:1px;min-width:60px;margin:auto;">
            <div style="background:#3b82f6;width:${oilW}%;height:100%;" title="Oil ${oilW}%"></div>
            <div style="background:#10b981;width:${cakeW}%;height:100%;" title="Cake ${cakeW}%"></div>
            <div style="background:#f59e0b;width:${hullsW}%;height:100%;" title="Hulls ${hullsW}%"></div>
            <div style="background:#ef4444;flex:1;height:100%;" title="Loss ${lossW}%"></div>
        </div>`;

        const yieldColor = yieldPercent >= 90 ? '#10b981' : yieldPercent >= 80 ? '#f59e0b' : '#ef4444';
        const isHighLoss = weight > 0 && parseFloat(yieldPercent) < 90;
        const lossBadge = isHighLoss
            ? `<br><span title="Recovery below 90% (loss above 10%) — investigate expeller blockage or seed quality" style="display:inline-block;margin-top:4px;padding:2px 7px;border-radius:10px;font-size:0.62rem;font-weight:700;background:rgba(239,68,68,0.15);color:#ef4444;border:1px solid rgba(239,68,68,0.45);white-space:nowrap;"><i class="fa-solid fa-triangle-exclamation"></i> HIGH LOSS</span>`
            : '';

        const tr = document.createElement('tr');
        if (isHighLoss) tr.style.background = 'rgba(239,68,68,0.05)';
        tr.innerHTML = `
            <td style="font-family: monospace; color: var(--text-secondary); font-weight: bold; text-align: center;">${index + 1}</td>
            <td style="white-space:nowrap;">${escapeHtml(item.date)}</td>
            <td>${lotLabel}</td>
            <td><span style="padding:3px 9px;border-radius:12px;font-size:0.75rem;font-weight:600;${seedBadge}">${seedLabel}</span></td>
            <td class="text-end" style="font-family:monospace;font-weight:700;">${weight.toFixed(2)}</td>
            <td class="text-end" style="font-family:monospace;color:#3b82f6;">${oil > 0 ? oil.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td class="text-end" style="font-family:monospace;color:#10b981;">${cake > 0 ? cake.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td class="text-end" style="font-family:monospace;color:#f59e0b;">${hulls > 0 ? hulls.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td style="padding:8px 10px;">${miniBar}</td>
            <td class="text-center">
                <span style="font-weight:700;color:${yieldColor};font-size:1rem;">${yieldPercent}%</span><br>
                <small style="color:#ef4444;">-${loss.toFixed(2)} Qtl</small>${lossBadge}
            </td>
            <td><small class="text-muted">${escapeHtml(item.remark || '—')}</small></td>
            <td>
                <div class="action-buttons" style="display:flex;gap:6px;">
                    <button class="btn btn-secondary btn-sm" onclick="editProduction('${item.id}')" title="Edit Entry"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteProduction('${item.id}')" title="Delete Entry"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Quality-control rollup: group crushing runs by the SUPPLIER of their linked raw
// unload lot, so oil/cake yields trace back to the agricultural source.
function renderSupplierYieldSummary() {
    const card = document.getElementById('prod-supplier-yield-card');
    const tbody = document.getElementById('prod-supplier-tbody');
    if (!card || !tbody) return;

    const groups = {};
    state.productionLogs.forEach(p => {
        const load = state.unloads.find(u => u.id === p.unloadId);
        const supplier = load ? (load.supplier || 'Unknown') : 'General / Legacy (no lot)';
        if (!groups[supplier]) groups[supplier] = { crushed: 0, oil: 0, cake: 0, hulls: 0, runs: 0 };
        const g = groups[supplier];
        g.crushed += parseFloat(p.weight) || 0;
        g.oil += parseFloat(p.oilYield) || 0;
        g.cake += parseFloat(p.cakeYield) || 0;
        g.hulls += parseFloat(p.hullsYield) || 0;
        g.runs += 1;
    });

    const rows = Object.keys(groups).map(name => {
        const g = groups[name];
        const oilRec = g.crushed > 0 ? (g.oil / g.crushed) * 100 : 0;
        const totalRec = g.crushed > 0 ? ((g.oil + g.cake + g.hulls) / g.crushed) * 100 : 0;
        return { name, ...g, oilRec, totalRec };
    }).sort((a, b) => b.oilRec - a.oilRec); // best oil recovery first

    if (rows.length === 0) {
        card.style.display = 'none';
        return;
    }
    card.style.display = 'block';
    tbody.innerHTML = '';

    // Rank oil recovery relative to the peer average for a simple quality flag.
    const avgOilRec = rows.reduce((s, r) => s + r.oilRec, 0) / rows.length;
    rows.forEach(r => {
        let flag, flagColor;
        if (r.oilRec >= avgOilRec + 0.5) { flag = 'Top yield'; flagColor = '#10b981'; }
        else if (r.oilRec <= avgOilRec - 0.5) { flag = 'Below avg'; flagColor = '#ef4444'; }
        else { flag = 'On par'; flagColor = '#f59e0b'; }
        const oilColor = r.oilRec >= 7 ? '#10b981' : r.oilRec >= 5 ? '#f59e0b' : '#ef4444';
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${escapeHtml(r.name)}</td>
            <td class="text-center"><small class="text-muted">${r.runs}</small></td>
            <td class="text-end" style="font-family:monospace;">${r.crushed.toFixed(2)}</td>
            <td class="text-end" style="font-family:monospace;color:#3b82f6;">${r.oil.toFixed(2)}</td>
            <td class="text-end" style="font-family:monospace;font-weight:700;color:${oilColor};">${r.oilRec.toFixed(2)}%</td>
            <td class="text-end" style="font-family:monospace;">${r.totalRec.toFixed(1)}%</td>
            <td class="text-center"><span style="padding:2px 8px;border-radius:10px;font-size:0.68rem;font-weight:700;background:${flagColor}22;color:${flagColor};border:1px solid ${flagColor}66;">${flag}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

// --- GST INPUT TAX CREDIT (ITC) SUMMARY ---
// Purchase (input) GST uses each unload's own gstRate; sales (output) GST uses a
// configurable rate since individual sales don't store one. Net = output - input.
function renderGSTSummary() {
    const monthEl = document.getElementById('gst-month');
    if (!monthEl) return;
    if (!monthEl.value) {
        // Default to the latest month that has any activity, else current month.
        const dates = [...state.unloads, ...state.sales].map(x => x.date).filter(Boolean).sort();
        monthEl.value = dates.length ? dates[dates.length - 1].slice(0, 7) : new Date().toISOString().slice(0, 7);
    }
    const month = monthEl.value;
    const outputRate = parseFloat(document.getElementById('gst-output-rate').value) || 0;
    const inMonth = d => d && d.slice(0, 7) === month;
    const fmt = n => `₹${Math.round(n).toLocaleString('en-IN')}`;

    // Input GST — purchases (unloads)
    let purchaseValue = 0, gstPaid = 0, purchaseCount = 0;
    state.unloads.forEach(u => {
        if (!inMonth(u.date)) return;
        const val = (parseFloat(u.weight) || 0) * (parseFloat(u.rate) || 0);
        const bagVal = (parseInt(u.bagQty) || 0) * (parseFloat(u.bagRate) || 0);
        const rate = u.gstRate !== undefined ? parseFloat(u.gstRate) : 5;
        purchaseValue += (val + bagVal);
        gstPaid += (val + bagVal) * rate / 100;
        purchaseCount++;
    });

    // Output GST — sales (dispatches)
    let salesValue = 0, salesCount = 0;
    state.sales.forEach(s => {
        if (!inMonth(s.date) || s.status === 'Rejected' || s.status === 'Returned') return;
        salesValue += (parseFloat(s.weight) || 0) * (parseFloat(s.rate) || 0);
        salesCount++;
    });
    const gstCollected = salesValue * outputRate / 100;
    const net = gstCollected - gstPaid;

    const setTxt = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    setTxt('gst-paid-value', fmt(gstPaid));
    setTxt('gst-paid-meta', `${purchaseCount} purchase${purchaseCount !== 1 ? 's' : ''} · base ${fmt(purchaseValue)}`);
    setTxt('gst-collected-value', fmt(gstCollected));
    setTxt('gst-collected-meta', `${salesCount} sale${salesCount !== 1 ? 's' : ''} · base ${fmt(salesValue)}`);
    setTxt('gst-net-value', fmt(Math.abs(net)));
    setTxt('gst-net-meta', net > 0 ? 'Payable to Govt' : net < 0 ? 'ITC carried forward' : 'Balanced');

    const netCard = document.getElementById('gst-net-value')?.closest('.kpi-card');
    if (netCard) {
        netCard.classList.remove('warning', 'danger', 'success');
        netCard.classList.add(net > 0 ? 'danger' : 'success');
    }
}

// --- PRINT / PDF EXPORT ---
// Isolate one element and invoke the browser's print dialog (Save as PDF).
function printSection(elId) {
    const el = document.getElementById(elId);
    if (!el) { window.print(); return; }
    document.body.classList.add('printing');
    el.classList.add('print-target');
    const cleanup = () => {
        document.body.classList.remove('printing');
        el.classList.remove('print-target');
        window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    // Fallback cleanup in case afterprint doesn't fire (some browsers).
    setTimeout(cleanup, 1500);
    window.print();
}

// Fill the print-only header of the party ledger statement before printing.
function printLedgerStatement() {
    const nameEl = document.getElementById('ledger-party-name-display');
    const header = document.getElementById('ledger-print-header');
    if (header) {
        const party = nameEl ? nameEl.textContent : 'Party';
        const monthFilter = document.getElementById('ledger-filter-month')?.value;
        const period = monthFilter ? `Period: ${monthFilter}` : 'Period: All transactions';
        const today = new Date().toLocaleDateString('en-IN');
        header.innerHTML = `
            <h2 style="margin:0;">VITTHAL OIL MILL</h2>
            <p style="margin:2px 0;">Industrial Estate, Majalgaon Road, Maharashtra</p>
            <hr>
            <p style="margin:2px 0;"><strong>Account Statement:</strong> ${escapeHtml(party)}</p>
            <p style="margin:2px 0;">${period} &nbsp;·&nbsp; Generated: ${today}</p>`;
    }
    printSection('ledger-print-area');
}

function seedProductionMockData() {
    if (!confirm('This will add 10 synthetic crushing run logs to the Production tab for testing. Continue?')) return;

    // Ensure there are some unloads to reference, or use legacy
    const mockRuns = [
        { date: '2026-07-01', seedType: 'cs-oms', weight: 120.00, oilYield: 9.00,  cakeYield: 97.00,  hullsYield: 7.20, remark: 'Morning shift — Expeller #1 & #2' },
        { date: '2026-07-02', seedType: 'cs-oms', weight: 95.50,  oilYield: 7.20,  cakeYield: 77.00,  hullsYield: 5.70, remark: 'Evening shift — Expeller #1' },
        { date: '2026-07-03', seedType: 'cs-ms',  weight: 110.00, oilYield: 8.80,  cakeYield: 89.00,  hullsYield: 6.60, remark: 'Full day run — MS seed batch' },
        { date: '2026-07-04', seedType: 'cs-oms', weight: 130.00, oilYield: 9.75,  cakeYield: 104.00, hullsYield: 7.80, remark: 'New lot started — GR 4521' },
        { date: '2026-07-05', seedType: 'cs-oms', weight: 88.00,  oilYield: 6.60,  cakeYield: 71.00,  hullsYield: 5.28, remark: 'Partial day — machine maintenance' },
        { date: '2026-07-06', seedType: 'cs-ms',  weight: 145.00, oilYield: 11.60, cakeYield: 117.00, hullsYield: 8.70, remark: 'High quality MS seed — 2 expellers' },
        { date: '2026-07-07', seedType: 'cs-oms', weight: 100.00, oilYield: 7.50,  cakeYield: 81.00,  hullsYield: 6.00, remark: 'Standard day — OMS batch' },
        { date: '2026-07-08', seedType: 'cs-oms', weight: 115.00, oilYield: 8.60,  cakeYield: 93.00,  hullsYield: 6.90, remark: 'Night shift carry-over' },
        { date: '2026-07-09', seedType: 'cs-ms',  weight: 125.00, oilYield: 10.00, cakeYield: 101.00, hullsYield: 7.50, remark: 'Premium lot — Satyan Agco' },
        { date: '2026-07-10', seedType: 'cs-oms', weight: 90.00,  oilYield: 6.75,  cakeYield: 72.50,  hullsYield: 5.40, remark: 'Half-day run' },
    ];

    if (!Array.isArray(state.productionLogs)) state.productionLogs = [];

    mockRuns.forEach((run, i) => {
        const matchingUnload = state.unloads.length > i ? state.unloads[i] : null;
        const seedType = run.seedType;
        const data = {
            id: 'prd-mock-test-' + (i + 1),
            date: run.date,
            unloadId: matchingUnload ? matchingUnload.id : null,
            seedType: seedType,
            weight: run.weight,
            oilYield: run.oilYield,
            cakeYield: run.cakeYield,
            hullsYield: run.hullsYield,
            remark: run.remark
        };
        // Only add if not already present
        if (!state.productionLogs.find(p => p.id === data.id)) {
            state.productionLogs.push(data);
            addProductionToStockLedger(data);
        }
    });

    saveState();
    renderAllViews();
    alert(`✅ 10 synthetic crushing runs loaded! Check the Production & Crushing Logs tab.`);
}


function handleProductionSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('prod-log-id').value;
    const date = document.getElementById('prod-date').value;
    const unloadId = document.getElementById('prod-lorry-select').value;
    
    if (!unloadId) {
        alert("Please select a received lorry lot first!");
        return;
    }
    
    const load = state.unloads.find(u => u.id === unloadId);
    if (!load) return;
    
    const seedType = load.seedType === 'MS' ? 'cs-ms' : (load.seedType === 'Kandi' ? 'kandi' : 'cs-oms');
    const weight = parseFloat(document.getElementById('prod-weight').value);
    
    const oilYield = parseFloat(document.getElementById('prod-yield-oil').value) || 0;
    const cakeYield = parseFloat(document.getElementById('prod-yield-cake').value) || 0;
    const hullsYield = parseFloat(document.getElementById('prod-yield-hulls').value) || 0;
    
    const remark = document.getElementById('prod-remark').value.trim();
    
    if (!date || isNaN(weight) || weight <= 0) {
        alert("Please specify a valid date and positive issue weight!");
        return;
    }
    
    const avail = getLotAvailableWeight(unloadId, id);
    if (weight > avail) {
        if (!confirm(`Warning: The issue weight (${weight.toFixed(2)} Qtl) exceeds the available weight in this lot (${avail.toFixed(2)} Qtl). Do you still want to log this crushing run?`)) {
            return;
        }
    }
    
    const data = { 
        date, unloadId, seedType, weight, 
        oilYield, cakeYield, hullsYield, remark 
    };
    
    if (id) {
        const idx = state.productionLogs.findIndex(p => p.id === id);
        if (idx !== -1) {
            removeProductionFromStockLedger(state.productionLogs[idx]);
            state.productionLogs[idx] = { ...state.productionLogs[idx], ...data };
            addProductionToStockLedger(state.productionLogs[idx]);
        }
    } else {
        data.id = 'prd-' + Date.now();
        state.productionLogs.push(data);
        addProductionToStockLedger(data);
    }
    
    saveState();
    closeModal('production-modal');
    renderAllViews();
    alert("Crushing run logged successfully!");
}

function editProduction(id) {
    const item = state.productionLogs.find(p => p.id === id);
    if (!item) return;
    
    document.getElementById('prod-log-id').value = item.id;
    document.getElementById('prod-date').value = item.date;
    
    populateProductionLorryDropdown(item.unloadId, item.id);
    document.getElementById('prod-lorry-select').value = item.unloadId || '';
    
    document.getElementById('prod-seed-type').value = item.seedType;
    document.getElementById('prod-weight').value = item.weight;
    
    document.getElementById('prod-yield-oil').value = item.oilYield || 0;
    document.getElementById('prod-yield-cake').value = item.cakeYield || 0;
    document.getElementById('prod-yield-hulls').value = item.hullsYield || 0;
    
    document.getElementById('prod-remark').value = item.remark || '';
    
    handleProductionLotChange();
    
    document.getElementById('production-modal-title').textContent = "Edit Seed Crushing Log";
    openModal('production-modal');
}

function deleteProduction(id) {
    if (confirm("Are you sure you want to delete this crushing log entry? This will reverse finished goods stock and return issued weights to the raw seed lot.")) {
        const item = state.productionLogs.find(p => p.id === id);
        if (item) removeProductionFromStockLedger(item);
        state.productionLogs = state.productionLogs.filter(p => p.id !== id);
        saveState();
        renderAllViews();
    }
}

function addProductionToStockLedger(item) {
    // Seed issue and finished goods receipts are dynamically calculated in getDayLog.
    // No static entries needed in stockDaily.
    return;
}

function removeProductionFromStockLedger(item) {
    // Dynamic calculations revert automatically when production log is deleted.
    return;
}

// --- OIL REFINING LOGS LOGIC ---
// Refining consumes CRUDE oil and produces WASH oil + GAAD (soapstock/waste).
function renderRefiningTable() {
    const tbody = document.getElementById('refining-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    const monthFilter = document.getElementById('ref-filter-month')?.value || '';
    const sortedLogs = [...state.refiningLogs].sort((a, b) => new Date(b.date) - new Date(a.date));
    const filtered = sortedLogs.filter(item => {
        if (monthFilter) {
            const itemMonth = item.date ? item.date.slice(0, 7) : '';
            if (itemMonth !== monthFilter) return false;
        }
        return true;
    });

    // --- KPI AGGREGATION ---
    let totalCrude = 0, totalWash = 0, totalAcid = 0, totalGaad = 0;
    let batchCount = 0;
    
    state.refiningLogs.forEach(item => {
        if (item.batches && Array.isArray(item.batches)) {
            item.batches.forEach(b => {
                totalCrude += parseFloat(b.crudeInput) || 0;
                totalWash += parseFloat(b.washYield) || 0;
                totalAcid += parseFloat(b.acidYield) || 0;
                totalGaad += parseFloat(b.gaadYield) || 0;
                batchCount++;
            });
        } else {
            totalCrude += parseFloat(item.crudeInput) || 0;
            totalWash += parseFloat(item.washYield) || 0;
            totalAcid += parseFloat(item.acidYield) || 0; // Legacy has no acid
            totalGaad += parseFloat(item.gaadYield) || 0;
            batchCount++;
        }
    });
    const totalLoss = Math.max(0, totalCrude - totalWash - totalAcid - totalGaad);

    const setEl = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const setPct = (id, val, total) => {
        const el = document.getElementById(id);
        if (el) el.textContent = total > 0 ? `${((val / total) * 100).toFixed(1)}% of crude` : '0% of crude';
    };
    setEl('ref-kpi-crude', `${totalCrude.toFixed(2)} Qtl`);
    setEl('ref-kpi-batches', `${batchCount} batch${batchCount !== 1 ? 'es' : ''}`);
    setEl('ref-kpi-wash', `${totalWash.toFixed(2)} Qtl`);
    setPct('ref-kpi-wash-pct', totalWash, totalCrude);
    setEl('ref-kpi-acid', `${totalAcid.toFixed(2)} Qtl`);
    setPct('ref-kpi-acid-pct', totalAcid, totalCrude);
    setEl('ref-kpi-gaad', `${totalGaad.toFixed(2)} Qtl`);
    setPct('ref-kpi-gaad-pct', totalGaad, totalCrude);
    setEl('ref-kpi-loss', `${totalLoss.toFixed(2)} Qtl`);
    const lossEl = document.getElementById('ref-kpi-loss-pct');
    if (lossEl) lossEl.textContent = totalCrude > 0 ? `${((totalLoss / totalCrude) * 100).toFixed(1)}% loss` : '0% loss';

    // Empty state
    const emptyState = document.getElementById('refining-empty-state');
    const tableEl = document.getElementById('refining-table');
    if (filtered.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (tableEl) tableEl.style.display = 'none';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    filtered.forEach((item, index) => {
        let crude = 0, wash = 0, acid = 0, gaad = 0;
        let detailsText = '';

        if (item.batches && Array.isArray(item.batches)) {
            item.batches.forEach(b => {
                crude += parseFloat(b.crudeInput) || 0;
                wash += parseFloat(b.washYield) || 0;
                acid += parseFloat(b.acidYield) || 0;
                gaad += parseFloat(b.gaadYield) || 0;
            });
            detailsText = `<span style="font-size:0.75rem;color:var(--text-muted);">${item.batches.length} batch${item.batches.length !== 1 ? 'es' : ''} in tanker</span>`;
        } else {
            crude = parseFloat(item.crudeInput) || 0;
            wash = parseFloat(item.washYield) || 0;
            acid = parseFloat(item.acidYield) || 0;
            gaad = parseFloat(item.gaadYield) || 0;
            detailsText = '<span style="font-size:0.75rem;color:var(--text-muted);">1 batch (legacy)</span>';
        }

        const loss = Math.max(0, crude - wash - acid - gaad);
        const recovery = crude > 0 ? (((wash + acid) / crude) * 100).toFixed(1) : 0;
        const recColor = recovery >= 90 ? '#10b981' : recovery >= 80 ? '#f59e0b' : '#ef4444';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-family: monospace; color: var(--text-secondary); font-weight: bold; text-align: center;">${index + 1}</td>
            <td style="white-space:nowrap;">${escapeHtml(item.date)}</td>
            <td>
                <strong>${escapeHtml(item.tanker || '—')}</strong><br>
                ${detailsText}
            </td>
            <td class="text-end" style="font-family:monospace;font-weight:700;color:#f59e0b;">${crude.toFixed(2)}</td>
            <td class="text-end" style="font-family:monospace;color:#3b82f6;">${wash > 0 ? wash.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td class="text-end" style="font-family:monospace;color:#6366f1;">${acid > 0 ? acid.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td class="text-end" style="font-family:monospace;color:#a855f7;">${gaad > 0 ? gaad.toFixed(2) : '<span style="opacity:0.3">—</span>'}</td>
            <td class="text-center"><span style="font-weight:700;color:${recColor};">${recovery}%</span><br><small style="color:#ef4444;">-${loss.toFixed(2)} Qtl</small></td>
            <td><small class="text-muted">${escapeHtml(item.remark || '—')}</small></td>
            <td>
                <div class="action-buttons" style="display:flex;gap:6px;">
                    <button class="btn btn-secondary btn-sm" onclick="editRefining('${item.id}')" title="Edit Entry"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteRefining('${item.id}')" title="Delete Entry"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function handleRefiningSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('refining-id').value;
    const date = document.getElementById('refining-date').value;
    const tanker = document.getElementById('ref-tanker').value;
    const remark = document.getElementById('ref-remark').value.trim();

    // Collect batches from table
    const batches = [];
    const tbody = document.getElementById('refining-batches-tbody');
    if (tbody) {
        Array.from(tbody.children).forEach(tr => {
            const bDate = tr.querySelector('.ref-batch-date').value;
            const crude = parseFloat(tr.querySelector('.ref-batch-crude').value) || 0;
            const wash = parseFloat(tr.querySelector('.ref-batch-wash').value) || 0;
            const acid = parseFloat(tr.querySelector('.ref-batch-acid').value) || 0;
            const gaad = parseFloat(tr.querySelector('.ref-batch-gaad').value) || 0;

            if (bDate && crude > 0) {
                batches.push({ date: bDate, crudeInput: crude, washYield: wash, acidYield: acid, gaadYield: gaad });
            }
        });
    }

    if (batches.length === 0) {
        alert("Please enter at least one batch with valid date and crude consumed!");
        return;
    }

    const data = { date, tanker, batches, remark };

    if (id) {
        const idx = state.refiningLogs.findIndex(r => r.id === id);
        if (idx !== -1) {
            state.refiningLogs[idx] = { ...state.refiningLogs[idx], ...data };
        }
    } else {
        data.id = 'ref-' + Date.now();
        state.refiningLogs.push(data);
    }

    saveState();
    closeModal('refining-modal');
    renderAllViews();
    alert("Refining run saved successfully!");
}

function editRefining(id) {
    const item = state.refiningLogs.find(r => r.id === id);
    if (!item) return;
    
    document.getElementById('refining-id').value = item.id;
    document.getElementById('refining-date').value = item.date;
    document.getElementById('ref-tanker').value = item.tanker || '';
    document.getElementById('ref-remark').value = item.remark || '';

    const tbody = document.getElementById('refining-batches-tbody');
    tbody.innerHTML = '';
    
    if (item.batches && Array.isArray(item.batches)) {
        item.batches.forEach(b => {
            addRefiningBatchRow(b.date, b.crudeInput, b.washYield, b.acidYield || 0, b.gaadYield);
        });
    } else {
        // Import legacy flat record as a single batch row
        addRefiningBatchRow(item.date, item.crudeInput, item.washYield, item.acidYield || 0, item.gaadYield);
    }

    recalculateRefiningSummary();
    document.getElementById('refining-modal-title').textContent = "Edit Oil Refining Tanker Run";
    openModal('refining-modal');
}

function deleteRefining(id) {
    if (confirm("Delete this refining tanker run? This will restore the crude oil and reverse wash oil / gaad produced across all batches.")) {
        state.refiningLogs = state.refiningLogs.filter(r => r.id !== id);
        saveState();
        renderAllViews();
    }
}

// --- MACHINERY RUN-HOURS & SERVICE SCHEDULE ---
// Each machine accumulates run hours; a service is "due" once (currentHours -
// lastServiceHours) reaches the service interval.
function getMachineServiceInfo(m) {
    const current = parseFloat(m.currentHours) || 0;
    const interval = parseFloat(m.interval) || 0;
    const lastService = parseFloat(m.lastServiceHours) || 0;
    const sinceService = Math.max(0, current - lastService);
    const remaining = interval > 0 ? interval - sinceService : Infinity;
    const pct = interval > 0 ? Math.min(100, (sinceService / interval) * 100) : 0;
    let status, color;
    if (interval <= 0) { status = 'No schedule'; color = '#64748b'; }
    else if (remaining <= 0) { status = 'Overdue'; color = '#ef4444'; }
    else if (remaining <= interval * 0.1) { status = 'Due soon'; color = '#f59e0b'; }
    else { status = 'OK'; color = '#10b981'; }
    return { current, interval, lastService, sinceService, remaining, pct, status, color };
}

function renderMachineSchedule() {
    const tbody = document.getElementById('machine-schedule-tbody');
    const emptyState = document.getElementById('machine-empty-state');
    const tableEl = document.getElementById('machine-schedule-table');
    const summary = document.getElementById('machine-alert-summary');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!state.machines || state.machines.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (tableEl) tableEl.style.display = 'none';
        if (summary) summary.textContent = '';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';
    if (tableEl) tableEl.style.display = '';

    let overdue = 0, dueSoon = 0;
    // Sort by urgency: least remaining hours first.
    const sorted = [...state.machines].sort((a, b) => getMachineServiceInfo(a).remaining - getMachineServiceInfo(b).remaining);
    sorted.forEach(m => {
        const info = getMachineServiceInfo(m);
        if (info.status === 'Overdue') overdue++;
        else if (info.status === 'Due soon') dueSoon++;

        const remainingTxt = info.interval > 0
            ? (info.remaining <= 0 ? `${Math.abs(info.remaining).toFixed(0)} hrs over` : `${info.remaining.toFixed(0)} hrs left`)
            : '—';
        const bar = info.interval > 0 ? `
            <div style="display:flex;align-items:center;gap:6px;">
                <div style="flex:1;height:7px;border-radius:4px;background:rgba(148,163,184,0.2);overflow:hidden;min-width:50px;">
                    <div style="height:100%;width:${info.pct}%;background:${info.color};"></div>
                </div>
                <small style="color:${info.color};white-space:nowrap;">${remainingTxt}</small>
            </div>` : '<small class="text-muted">—</small>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="font-weight:600;">${escapeHtml(m.name)}${m.remark ? `<br><small class="text-muted">${escapeHtml(m.remark)}</small>` : ''}</td>
            <td><small class="text-muted">${escapeHtml(m.category || '—')}</small></td>
            <td class="text-end" style="font-family:monospace;font-weight:700;">${info.current.toFixed(1)}</td>
            <td class="text-end" style="font-family:monospace;">${info.sinceService.toFixed(1)}</td>
            <td class="text-end" style="font-family:monospace;">${info.interval > 0 ? info.interval.toFixed(0) : '—'}</td>
            <td style="padding:8px 10px;min-width:130px;">${bar}</td>
            <td class="text-center"><span style="padding:2px 9px;border-radius:10px;font-size:0.68rem;font-weight:700;background:${info.color}22;color:${info.color};border:1px solid ${info.color}66;white-space:nowrap;">${info.status === 'Overdue' ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : ''}${info.status}</span></td>
            <td class="text-center">
                <div class="action-buttons" style="display:flex;gap:5px;justify-content:center;">
                    <button class="btn btn-secondary btn-sm" onclick="addMachineHours('${m.id}')" title="Add run hours"><i class="fa-solid fa-clock"></i></button>
                    <button class="btn btn-success btn-sm" onclick="serviceMachine('${m.id}')" title="Mark serviced now"><i class="fa-solid fa-oil-can"></i></button>
                    <button class="btn btn-secondary btn-sm" onclick="editMachine('${m.id}')" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn btn-danger btn-sm" onclick="deleteMachine('${m.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    if (summary) {
        if (overdue > 0 || dueSoon > 0) {
            const parts = [];
            if (overdue > 0) parts.push(`<span style="color:#ef4444;font-weight:700;">${overdue} overdue</span>`);
            if (dueSoon > 0) parts.push(`<span style="color:#f59e0b;font-weight:700;">${dueSoon} due soon</span>`);
            summary.innerHTML = '· ' + parts.join(' · ');
        } else {
            summary.innerHTML = '· <span style="color:#10b981;">all machines on schedule</span>';
        }
    }
}

function handleMachineSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('machine-id').value;
    const name = document.getElementById('machine-name').value.trim();
    const category = document.getElementById('machine-category').value;
    const currentHours = parseFloat(document.getElementById('machine-current-hours').value) || 0;
    const interval = parseFloat(document.getElementById('machine-interval').value) || 0;
    const lastServiceRaw = document.getElementById('machine-last-service').value;
    const lastServiceHours = lastServiceRaw === '' ? currentHours : parseFloat(lastServiceRaw) || 0;
    const remark = document.getElementById('machine-remark').value.trim();

    if (!name) { alert('Please enter a machine name.'); return; }
    if (lastServiceHours > currentHours) {
        alert('Hours at last service cannot exceed current run hours.');
        return;
    }

    const data = { name, category, currentHours, interval, lastServiceHours, remark };
    if (id) {
        const idx = state.machines.findIndex(m => m.id === id);
        if (idx !== -1) state.machines[idx] = { ...state.machines[idx], ...data };
    } else {
        data.id = 'mch-' + Date.now();
        state.machines.push(data);
    }
    saveState();
    closeModal('machine-modal');
    renderMachineSchedule();
}

function editMachine(id) {
    const m = state.machines.find(x => x.id === id);
    if (!m) return;
    document.getElementById('machine-id').value = m.id;
    document.getElementById('machine-name').value = m.name || '';
    document.getElementById('machine-category').value = m.category || 'Other';
    document.getElementById('machine-current-hours').value = m.currentHours ?? 0;
    document.getElementById('machine-interval').value = m.interval ?? 500;
    document.getElementById('machine-last-service').value = m.lastServiceHours ?? 0;
    document.getElementById('machine-remark').value = m.remark || '';
    document.getElementById('machine-modal-title').textContent = 'Edit Machine';
    openModal('machine-modal');
}

function addMachineHours(id) {
    const m = state.machines.find(x => x.id === id);
    if (!m) return;
    const input = prompt(`Add run hours for ${m.name}.\nCurrent reading: ${(parseFloat(m.currentHours) || 0).toFixed(1)} hrs.\n\nEnter hours to ADD (or a negative number to correct):`, '');
    if (input === null) return;
    const delta = parseFloat(input);
    if (isNaN(delta)) { alert('Please enter a valid number.'); return; }
    m.currentHours = (parseFloat(m.currentHours) || 0) + delta;
    if (m.currentHours < 0) m.currentHours = 0;
    saveState();
    renderMachineSchedule();
    const info = getMachineServiceInfo(m);
    if (info.status === 'Overdue') alert(`⚠ ${m.name} is now OVERDUE for service (${Math.abs(info.remaining).toFixed(0)} hrs past the ${info.interval}-hr interval).`);
    else if (info.status === 'Due soon') alert(`${m.name} is due for service soon — ${info.remaining.toFixed(0)} hrs remaining.`);
}

function serviceMachine(id) {
    const m = state.machines.find(x => x.id === id);
    if (!m) return;
    const current = (parseFloat(m.currentHours) || 0).toFixed(1);
    if (!confirm(`Mark ${m.name} as serviced at ${current} run hours? This resets the service countdown.`)) return;
    m.lastServiceHours = parseFloat(m.currentHours) || 0;
    saveState();
    renderMachineSchedule();
}

function deleteMachine(id) {
    const m = state.machines.find(x => x.id === id);
    if (!m) return;
    if (confirm(`Remove ${m.name} from the machinery registry?`)) {
        state.machines = state.machines.filter(x => x.id !== id);
        saveState();
        renderMachineSchedule();
    }
}

// --- PARTY ACCOUNTS LEDGER LOGIC ---
function populateLedgerPartyDropdown() {
    const optionsDiv = document.getElementById('ledger-party-options');
    if (!optionsDiv) return;
    optionsDiv.innerHTML = '';
    
    // Sort suppliers alphabetically
    const sortedSuppliers = [...state.suppliers].sort((a,b) => a.name.localeCompare(b.name));
    sortedSuppliers.forEach(s => {
        const div = document.createElement('div');
        div.className = 'searchable-option';
        div.style.padding = '10px 14px';
        div.style.cursor = 'pointer';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.borderBottom = '1px solid var(--border-color)';
        
        div.onmouseenter = () => div.style.backgroundColor = 'var(--bg-card-hover)';
        div.onmouseleave = () => div.style.backgroundColor = 'transparent';
        
        div.onclick = () => selectLedgerParty('supp:' + s.name, s.name);
        
        div.innerHTML = `
            <span class="option-name" style="font-size: 0.88rem; color: var(--text-primary); font-weight: 500;">${escapeHtml(s.name)}</span>
            <span class="badge badge-info" style="font-size: 0.72rem; padding: 3px 8px; border-radius: 12px; background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);">Supplier</span>
        `;
        optionsDiv.appendChild(div);
    });
    
    // Sort customers alphabetically
    const sortedCustomers = [...state.customers].sort((a,b) => a.name.localeCompare(b.name));
    sortedCustomers.forEach(c => {
        const div = document.createElement('div');
        div.className = 'searchable-option';
        div.style.padding = '10px 14px';
        div.style.cursor = 'pointer';
        div.style.display = 'flex';
        div.style.justifyContent = 'space-between';
        div.style.alignItems = 'center';
        div.style.borderBottom = '1px solid var(--border-color)';
        
        div.onmouseenter = () => div.style.backgroundColor = 'var(--bg-card-hover)';
        div.onmouseleave = () => div.style.backgroundColor = 'transparent';
        
        div.onclick = () => selectLedgerParty('cust:' + c.name, c.name);
        
        div.innerHTML = `
            <span class="option-name" style="font-size: 0.88rem; color: var(--text-primary); font-weight: 500;">${escapeHtml(c.name)}</span>
            <span class="badge badge-success" style="font-size: 0.72rem; padding: 3px 8px; border-radius: 12px; background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">Customer</span>
        `;
        optionsDiv.appendChild(div);
    });
    
    if (optionsDiv.innerHTML === '') {
        optionsDiv.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted); font-size: 0.88rem;">No parties registered yet.</div>';
    }
}

function getPartyBalance(partyName, role) {
    let billed = 0;
    let paid = 0;
    
    if (role === 'supp') {
        state.unloads.forEach(u => {
            if (u.supplier === partyName && u.status !== 'Rejected' && u.status !== 'Returned') {
                const discount = parseFloat(u.discount) || 0;
                const seedVal = parseFloat(u.weight) * (parseFloat(u.forRate) - discount);
                const bagVal = (parseInt(u.bagQty) || 0) * (parseFloat(u.bagRate) || 0);
                billed += (seedVal + bagVal);
            }
        });
        state.payments.forEach(p => {
            if (p.partyName === partyName && p.partyRole === 'supplier') {
                paid += parseFloat(p.amount) || 0;
            }
        });
        return billed - paid; // Outstanding payable to supplier
    } else { // customer
        state.sales.forEach(s => {
            if (s.customer === partyName && s.status !== 'Rejected' && s.status !== 'Returned') {
                billed += (parseFloat(s.weight) * parseFloat(s.rate)) || 0;
            }
        });
        state.payments.forEach(p => {
            if (p.partyName === partyName && p.partyRole === 'customer') {
                paid += parseFloat(p.amount) || 0;
            }
        });
        return billed - paid; // Outstanding receivable from customer
    }
}

function renderGlobalLedgerKPIs() {
    const globalKpis = document.getElementById('global-ledger-kpis');
    if (!globalKpis) return;

    let totalPayables = 0;
    let totalReceivables = 0;

    state.suppliers.forEach(s => {
        totalPayables += getPartyBalance(s.name, 'supp');
    });

    state.customers.forEach(c => {
        totalReceivables += getPartyBalance(c.name, 'cust');
    });

    document.getElementById('global-kpi-payables').textContent = `₹${totalPayables.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
    document.getElementById('global-kpi-payables-count').textContent = `${state.suppliers.length} Suppliers`;
    
    document.getElementById('global-kpi-receivables').textContent = `₹${totalReceivables.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
    document.getElementById('global-kpi-receivables-count').textContent = `${state.customers.length} Customers`;

    document.getElementById('global-kpi-suppliers-count').textContent = state.suppliers.length;
    document.getElementById('global-kpi-customers-count').textContent = state.customers.length;
}

function renderPartyAccounts() {
    const select = document.getElementById('ledger-party-select');
    const kpisDiv = document.getElementById('ledger-kpis');
    const bodyRow = document.getElementById('ledger-body-row');
    const tbody = document.getElementById('ledger-tbody');
    const noPartyState = document.getElementById('ledger-no-party-state');
    const profileBanner = document.getElementById('ledger-party-profile');
    const globalKpis = document.getElementById('global-ledger-kpis');

    if (!select || !select.value) {
        if (kpisDiv) kpisDiv.style.display = 'none';
        if (bodyRow) bodyRow.style.display = 'none';
        if (profileBanner) profileBanner.style.display = 'none';
        if (noPartyState) noPartyState.style.display = 'block';
        if (globalKpis) globalKpis.style.display = 'grid';
        renderGlobalLedgerKPIs();
        return;
    }

    if (noPartyState) noPartyState.style.display = 'none';
    if (globalKpis) globalKpis.style.display = 'none';
    kpisDiv.style.display = 'grid';
    bodyRow.style.display = 'flex';
    if (profileBanner) profileBanner.style.display = 'block';

    const [role, name] = select.value.split(':');
    const monthFilter = document.getElementById('ledger-filter-month')?.value || '';

    // Set default date in payment form to today
    document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];

    // Payment form role defaults
    const payTypeSelect = document.getElementById('pay-type');
    if (role === 'supp') {
        payTypeSelect.value = 'Paid';
        document.getElementById('ledger-kpi-balance-title').textContent = 'Outstanding Payable';
    } else {
        payTypeSelect.value = 'Received';
        document.getElementById('ledger-kpi-balance-title').textContent = 'Outstanding Receivable';
    }

    // --- Party Profile Banner ---
    const avatarEl = document.getElementById('ledger-party-avatar');
    const nameDisplay = document.getElementById('ledger-party-name-display');
    const detailEl = document.getElementById('ledger-party-detail');
    const roleBadge = document.getElementById('ledger-role-badge');
    const badgeWrap = document.getElementById('ledger-party-type-badge');

    if (avatarEl) {
        const initials = name.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const avatarColor = role === 'supp' ? 'background:rgba(59,130,246,0.2);color:#60a5fa;' : 'background:rgba(16,185,129,0.2);color:#34d399;';
        avatarEl.style.cssText += avatarColor;
        avatarEl.textContent = initials;
    }
    if (nameDisplay) nameDisplay.textContent = name;
    if (detailEl) {
        const partyObj = role === 'supp'
            ? state.suppliers?.find(s => s.name === name)
            : state.customers?.find(c => c.name === name);
        detailEl.textContent = partyObj
            ? [partyObj.address, partyObj.phone, partyObj.gstin].filter(Boolean).join(' · ')
            : (role === 'supp' ? 'Supplier' : 'Customer');
    }
    if (roleBadge && badgeWrap) {
        badgeWrap.style.display = 'block';
        roleBadge.textContent = role === 'supp' ? '🏭 Supplier' : '🛒 Customer';
        roleBadge.style.cssText = role === 'supp'
            ? 'padding:6px 16px;border-radius:20px;font-weight:700;font-size:0.8rem;background:rgba(59,130,246,0.15);color:#60a5fa;'
            : 'padding:6px 16px;border-radius:20px;font-weight:700;font-size:0.8rem;background:rgba(16,185,129,0.15);color:#34d399;';
    }

    // --- Build Entries ---
    let entries = [];
    let totalBilledVal = 0;
    let totalWeight = 0;
    let totalPaidVal = 0;

    if (role === 'supp') {
        state.unloads.forEach(u => {
            if (u.supplier === name && u.status !== 'Rejected' && u.status !== 'Returned') {
                const discount = parseFloat(u.discount) || 0;
                const seedVal = parseFloat(u.weight) * (parseFloat(u.forRate) - discount);
                const bagVal = (parseInt(u.bagQty) || 0) * (parseFloat(u.bagRate) || 0);
                const totalVal = seedVal + bagVal;
                totalBilledVal += totalVal;
                totalWeight += parseFloat(u.weight);

                let desc = `Cotton Seed Load (${u.seedType || 'OMS'})`;
                if (u.bagQty > 0) desc += ` + ${u.bagQty} Bags`;

                entries.push({
                    date: u.date,
                    description: desc,
                    ref: `${u.lorryNo}${u.location ? ' · ' + u.location : ''}`,
                    weight: parseFloat(u.weight),
                    debit: 0,
                    credit: totalVal,
                    type: 'purchase',
                    timestamp: new Date(u.date).getTime()
                });
            }
        });

        state.payments.forEach(p => {
            if (p.partyName === name && p.partyRole === 'supplier') {
                totalPaidVal += parseFloat(p.amount);
                entries.push({
                    date: p.date,
                    description: `Payout · ${p.method}${p.remark ? ' — ' + p.remark : ''}`,
                    ref: p.id.slice(-6).toUpperCase(),
                    weight: 0,
                    debit: parseFloat(p.amount),
                    credit: 0,
                    type: 'payment',
                    timestamp: new Date(p.date).getTime()
                });
            }
        });
    } else {
        state.sales.forEach(s => {
            if (s.customer === name && s.dispatchStatus !== 'Rejected' && s.dispatchStatus !== 'Returned') {
                const val = parseFloat(s.weight) * parseFloat(s.rate);
                totalBilledVal += val;
                totalWeight += parseFloat(s.weight);
                const prodObj = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(p => p.id === s.product) : null;
                const prodName = prodObj ? prodObj.name : s.product;
                entries.push({
                    date: s.date,
                    description: `Dispatch — ${prodName}${s.qualityGrade ? ' (' + s.qualityGrade + ')' : ''}`,
                    ref: `${s.lorryNo} · Inv: ${s.invoiceNo || 'Draft'}`,
                    weight: parseFloat(s.weight),
                    debit: val,
                    credit: 0,
                    type: 'sale',
                    timestamp: new Date(s.date).getTime()
                });
            }
        });

        state.payments.forEach(p => {
            if (p.partyName === name && p.partyRole === 'customer') {
                totalPaidVal += parseFloat(p.amount);
                entries.push({
                    date: p.date,
                    description: `Receipt · ${p.method}${p.remark ? ' — ' + p.remark : ''}`,
                    ref: p.id.slice(-6).toUpperCase(),
                    weight: 0,
                    debit: 0,
                    credit: parseFloat(p.amount),
                    type: 'payment',
                    timestamp: new Date(p.date).getTime()
                });
            }
        });
    }

    // Sort chronologically
    entries.sort((a,b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.timestamp - b.timestamp;
    });

    // Month filter
    const filteredEntries = monthFilter
        ? entries.filter(e => e.date && e.date.slice(0,7) === monthFilter)
        : entries;

    // --- Render Table ---
    tbody.innerHTML = '';
    const emptyState = document.getElementById('ledger-empty-state');
    const tableEl = document.getElementById('ledger-statement-table');

    if (filteredEntries.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        if (tableEl) tableEl.style.display = 'none';
    } else {
        if (emptyState) emptyState.style.display = 'none';
        if (tableEl) tableEl.style.display = '';

        let balance = 0;
        let rowNum = 0;

        // If month filter active, compute opening balance first
        if (monthFilter) {
            const beforeFilter = entries.filter(e => e.date < monthFilter + '-01');
            beforeFilter.forEach(e => {
                balance += role === 'supp' ? (e.credit - e.debit) : (e.debit - e.credit);
            });
            if (balance !== 0) {
                const openRow = document.createElement('tr');
                openRow.style.cssText = 'background:rgba(100,100,100,0.08);font-style:italic;';
                openRow.innerHTML = `
                    <td>—</td>
                    <td colspan="5" style="color:var(--text-secondary);"><em>Opening Balance (before ${monthFilter})</em></td>
                    <td></td>
                    <td class="text-end font-bold" style="color:${balance > 0 ? '#f59e0b':'#10b981'};">₹${Math.abs(balance).toLocaleString('en-IN',{maximumFractionDigits:2})}</td>
                `;
                tbody.appendChild(openRow);
            }
        }

        filteredEntries.forEach(e => {
            if (role === 'supp') {
                balance += e.credit - e.debit;
            } else {
                balance += e.debit - e.credit;
            }
            rowNum++;

            const isPayment = e.type === 'payment';
            const rowStyle = isPayment
                ? 'background:rgba(16,185,129,0.04);'
                : '';
            const balanceColor = balance > 0 ? '#f59e0b' : '#10b981';
            const typeIcon = e.type === 'purchase' ? '📦' : e.type === 'sale' ? '🚚' : '💳';

            const tr = document.createElement('tr');
            tr.style.cssText = rowStyle;
            tr.innerHTML = `
                <td style="color:var(--text-secondary);font-size:0.7rem;">${rowNum}</td>
                <td style="white-space:nowrap;">${e.date}</td>
                <td><span style="margin-right:4px;">${typeIcon}</span>${escapeHtml(e.description)}</td>
                <td><code style="font-size:0.7rem;">${escapeHtml(e.ref)}</code></td>
                <td class="text-end">${e.weight > 0 ? e.weight.toFixed(2) + ' Qtl' : '<span style="opacity:0.3">—</span>'}</td>
                <td class="text-end" style="color:#ef4444;font-weight:600;">${e.debit > 0 ? '₹' + e.debit.toLocaleString('en-IN',{maximumFractionDigits:2}) : '<span style="opacity:0.3">—</span>'}</td>
                <td class="text-end" style="color:#10b981;font-weight:600;">${e.credit > 0 ? '₹' + e.credit.toLocaleString('en-IN',{maximumFractionDigits:2}) : '<span style="opacity:0.3">—</span>'}</td>
                <td class="text-end font-bold" style="color:${balanceColor};">₹${Math.abs(balance).toLocaleString('en-IN',{maximumFractionDigits:2})}<br><small style="font-size:0.65rem;opacity:0.6;">${balance > 0 ? 'DR' : 'CR'}</small></td>
            `;
            tbody.appendChild(tr);
        });
    }

    // --- KPIs ---
    const balance_final = entries.reduce((acc, e) => {
        return acc + (role === 'supp' ? (e.credit - e.debit) : (e.debit - e.credit));
    }, 0);

    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setEl('ledger-kpi-balance', '₹' + Math.abs(balance_final).toLocaleString('en-IN', {maximumFractionDigits:2}));
    setEl('ledger-kpi-balance-meta', balance_final > 0
        ? (role === 'supp' ? 'Amount Payable to Supplier' : 'Amount Receivable from Customer')
        : '✅ Fully Settled / Advance Paid');
    setEl('ledger-kpi-billed', '₹' + totalBilledVal.toLocaleString('en-IN', {maximumFractionDigits:2}));
    setEl('ledger-kpi-weight', `${totalWeight.toFixed(2)} Qtl Cumulative`);
    setEl('ledger-kpi-paid', '₹' + totalPaidVal.toLocaleString('en-IN', {maximumFractionDigits:2}));
    const payLogsCount = state.payments.filter(p => p.partyName === name).length;
    setEl('ledger-kpi-transactions', `${payLogsCount} payment log${payLogsCount !== 1 ? 's' : ''}`);
    setEl('ledger-kpi-txn-count', entries.length);
    setEl('ledger-kpi-txn-meta', `entries total`);

    // Balance Progress Bar
    const paidPct = totalBilledVal > 0 ? Math.min(100, (totalPaidVal / totalBilledVal) * 100) : 0;
    const barEl = document.getElementById('ledger-balance-bar');
    const barLabel = document.getElementById('ledger-bar-pct-label');
    if (barEl) barEl.style.width = paidPct.toFixed(1) + '%';
    if (barLabel) barLabel.textContent = `${paidPct.toFixed(1)}% settled`;
}

function handlePaymentSubmit(e) {
    e.preventDefault();
    const select = document.getElementById('ledger-party-select');
    if (!select || !select.value) return;
    
    const [role, name] = select.value.split(':');
    const date = document.getElementById('pay-date').value;
    const type = document.getElementById('pay-type').value;
    const amount = parseFloat(document.getElementById('pay-amount').value);
    const method = document.getElementById('pay-method').value;
    const remark = document.getElementById('pay-remark').value.trim();
    
    if (!date || isNaN(amount) || amount <= 0) {
        alert("Please specify a valid date and positive transaction amount!");
        return;
    }
    
    const data = {
        id: 'pay-' + Date.now(),
        date,
        partyName: name,
        partyRole: role === 'supp' ? 'supplier' : 'customer',
        type, // 'Paid' or 'Received'
        amount,
        method,
        remark
    };
    
    state.payments.push(data);
    saveState();
    
    // Clear amount and remark fields
    document.getElementById('pay-amount').value = '';
    document.getElementById('pay-remark').value = '';
    
    renderPartyAccounts();
    alert("Payment posted successfully!");
}


// --- HEADER QUICK ACTION DROPDOWN ---
function toggleQuickActionMenu() {
    const menu = document.getElementById('quick-action-menu');
    if (!menu) return;
    if (menu.style.display === 'none') {
        menu.style.display = 'block';
    } else {
        menu.style.display = 'none';
    }
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('quick-action-dropdown');
    const menu = document.getElementById('quick-action-menu');
    if (dropdown && menu && !dropdown.contains(e.target)) {
        menu.style.display = 'none';
    }
});

function triggerQuickAction(action) {
    const menu = document.getElementById('quick-action-menu');
    if (menu) menu.style.display = 'none';
    
    if (action === 'unload') {
        openModal('unload-modal');
    } else if (action === 'sales') {
        openModal('sales-modal');
    } else if (action === 'production') {
        openModal('production-modal');
    } else if (action === 'payment') {
        switchTab('party-accounts');
    }
}


// --- DYNAMIC AUTOCOMPLETE DATALIST GENERATOR ---
function populateAutocompleteDatalists() {
    // 1. Places (from historical unloads)
    const placesDl = document.getElementById('places-datalist');
    if (placesDl) {
        const uniquePlaces = [...new Set(state.unloads.map(u => u.place).filter(Boolean))].sort();
        placesDl.innerHTML = '';
        uniquePlaces.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            placesDl.appendChild(opt);
        });
    }

    // 2. Silos/Locations (from historical unloads)
    const silosDl = document.getElementById('silos-datalist');
    if (silosDl) {
        const uniqueSilos = [...new Set(state.unloads.map(u => u.location).filter(Boolean))].sort();
        silosDl.innerHTML = '';
        uniqueSilos.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            silosDl.appendChild(opt);
        });
    }

    // 3. Destinations (from historical sales)
    const destsDl = document.getElementById('destinations-datalist');
    if (destsDl) {
        const uniqueDests = [...new Set(state.sales.map(s => s.destination).filter(Boolean))].sort();
        destsDl.innerHTML = '';
        uniqueDests.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            destsDl.appendChild(opt);
        });
    }

    // 4. Gate Pass Parties (from customers, suppliers, and historical gate pass parties)
    const gpPartiesDl = document.getElementById('gp-party-datalist');
    if (gpPartiesDl) {
        const uniqueGPParties = [...new Set([
            ...state.customers.map(c => c.name),
            ...state.suppliers.map(s => s.name),
            ...state.gatePasses.map(g => g.partyName)
        ].filter(Boolean))].sort();
        gpPartiesDl.innerHTML = '';
        uniqueGPParties.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p;
            gpPartiesDl.appendChild(opt);
        });
    }
}


// --- CUSTOM LEDGER SEARCHABLE DROP DOWN CONTROLLERS ---
function toggleLedgerDropdown() {
    const optionsDiv = document.getElementById('ledger-party-options');
    if (!optionsDiv) return;
    if (optionsDiv.style.display === 'none') {
        populateLedgerPartyDropdown();
        optionsDiv.style.display = 'block';
    } else {
        optionsDiv.style.display = 'none';
    }
}

function filterLedgerDropdown() {
    const input = document.getElementById('ledger-party-input');
    const query = input.value.toLowerCase().trim();
    const optionsDiv = document.getElementById('ledger-party-options');
    if (!optionsDiv) return;
    optionsDiv.style.display = 'block';
    
    const options = optionsDiv.querySelectorAll('.searchable-option');
    options.forEach(opt => {
        const name = opt.querySelector('.option-name').textContent.toLowerCase();
        if (name.includes(query)) {
            opt.style.display = 'flex';
        } else {
            opt.style.display = 'none';
        }
    });
}

function selectLedgerParty(value, name) {
    document.getElementById('ledger-party-input').value = name;
    document.getElementById('ledger-party-select').value = value;
    document.getElementById('ledger-party-options').style.display = 'none';
    
    renderPartyAccounts();
}

// Global click listener to auto-close options dropdown
document.addEventListener('click', function(e) {
    const container = document.getElementById('ledger-party-container');
    const optionsDiv = document.getElementById('ledger-party-options');
    if (container && optionsDiv && !container.contains(e.target)) {
        optionsDiv.style.display = 'none';
    }
});


function revertDayStockToAuto() {
    const monthKey = document.getElementById('stock-month-selector').value;
    const prodId = document.getElementById('qs-product').value;
    const day = parseInt(document.getElementById('qs-day').value);

    if (state.stockDaily[monthKey] && state.stockDaily[monthKey][prodId]) {
        delete state.stockDaily[monthKey][prodId][day];
        // Clean up empty objects
        if (Object.keys(state.stockDaily[monthKey][prodId]).length === 0) {
            delete state.stockDaily[monthKey][prodId];
        }
        if (Object.keys(state.stockDaily[monthKey]).length === 0) {
            delete state.stockDaily[monthKey];
        }
    }

    saveState();
    closeModal('quick-stock-modal');
    renderStockStatement();
    renderDashboardKPIs();
    alert("Reverted cell to automatic calculations.");
}


// --- DATA ANALYTICS WORKSPACE CONTROLLER ---
let analyticsMarginChartInstance = null;
let analyticsProductMixChartInstance = null;
let analyticsYieldTrendChartInstance = null;

function renderAnalyticsTab() {
    // 1. Calculate operational KPIs
    const totalSalesRev = state.sales.reduce((sum, s) => sum + (parseFloat(s.weight) || 0) * (parseFloat(s.rate) || 0), 0);
    const totalPurchaseCost = state.unloads
        .filter(u => u.status !== 'Rejected' && u.status !== 'Returned')
        .reduce((sum, u) => sum + (parseFloat(u.weight) || 0) * (parseFloat(u.forRate) || 0), 0);
        
    const marginPercent = totalSalesRev > 0 
        ? ((totalSalesRev - totalPurchaseCost) / totalSalesRev * 100).toFixed(1)
        : '0.0';

    const totalCrushed = state.productionLogs.reduce((sum, p) => sum + (parseFloat(p.weight) || 0), 0);
    const totalYield = state.productionLogs.reduce((sum, p) => sum + (parseFloat(p.oilYield) || 0) + (parseFloat(p.cakeYield) || 0) + (parseFloat(p.hullsYield) || 0), 0);
    const avgYield = totalCrushed > 0 ? (totalYield / totalCrushed * 100).toFixed(1) : '0.0';
    const runsCount = state.productionLogs.length;

    const totalShortage = state.unloads
        .filter(u => u.status !== 'Rejected' && u.status !== 'Returned')
        .reduce((sum, u) => sum + (parseFloat(u.shortage) || 0), 0);
    const totalInvWeight = state.unloads
        .filter(u => u.status !== 'Rejected' && u.status !== 'Returned')
        .reduce((sum, u) => sum + (parseFloat(u.invoiceWeight !== undefined ? u.invoiceWeight : u.weight) || 0), 0);
    const avgShortage = totalInvWeight > 0 ? (totalShortage / totalInvWeight * 100).toFixed(2) : '0.00';

    const totalFuelCost = state.transportLogs.filter(t => t.type === 'Diesel').reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0);
    const totalFuelLitres = state.transportLogs.filter(t => t.type === 'Diesel').reduce((sum, t) => sum + (parseFloat(t.litres) || 0), 0);

    // Update KPI UI
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setTxt('analytics-kpi-margin', `${marginPercent}%`);
    setTxt('analytics-kpi-margin-text', totalSalesRev > 0 ? `Rev ${formatCurrency(totalSalesRev)} vs Cost ${formatCurrency(totalPurchaseCost)}` : 'No sales logs');
    setTxt('analytics-kpi-yield', `${avgYield}%`);
    setTxt('analytics-kpi-yield-runs', `${runsCount} run${runsCount !== 1 ? 's' : ''} crushed`);
    setTxt('analytics-kpi-shortage', `${avgShortage}%`);
    setTxt('analytics-kpi-shortage-qtl', `${totalShortage.toFixed(2)} Qtl total shortage`);
    setTxt('analytics-kpi-fuel', `₹${Math.round(totalFuelCost).toLocaleString('en-IN')}`);
    setTxt('analytics-kpi-fuel-litres', `${totalFuelLitres.toFixed(1)} L diesel refueled`);

    // Helper: format currency
    function formatCurrency(n) {
        return '₹' + Math.round(n).toLocaleString('en-IN');
    }

    if (typeof Chart === 'undefined') {
        console.warn("Chart.js not loaded. Skipping charts rendering.");
        return;
    }

    const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
    const gridColor = isDark ? '#24304f' : '#e2e8f0';
    const textLabelColor = isDark ? '#94a3b8' : '#475569';

    // 2. Render Margin Trends Chart (Line)
    // Extract unique months from sales and unloads
    const allMonths = new Set();
    state.sales.forEach(s => s.date && allMonths.add(s.date.slice(0, 7)));
    state.unloads.forEach(u => u.date && allMonths.add(u.date.slice(0, 7)));
    const sortedMonths = [...allMonths].sort();

    const monthlySales = sortedMonths.map(m => {
        return state.sales.filter(s => s.date && s.date.slice(0, 7) === m)
            .reduce((sum, s) => sum + (parseFloat(s.weight) || 0) * (parseFloat(s.rate) || 0), 0);
    });
    const monthlyPurchases = sortedMonths.map(m => {
        return state.unloads.filter(u => u.date && u.date.slice(0, 7) === m && u.status !== 'Rejected' && u.status !== 'Returned')
            .reduce((sum, u) => sum + (parseFloat(u.weight) || 0) * (parseFloat(u.forRate) || 0), 0);
    });

    const canvasMargin = document.getElementById('analyticsMarginChart');
    if (canvasMargin) {
        if (analyticsMarginChartInstance) analyticsMarginChartInstance.destroy();
        analyticsMarginChartInstance = new Chart(canvasMargin.getContext('2d'), {
            type: 'line',
            data: {
                labels: sortedMonths.map(m => {
                    const parts = m.split('-');
                    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    return parts.length === 2 ? `${monthNames[parseInt(parts[1])-1]} ${parts[0]}` : m;
                }),
                datasets: [
                    {
                        label: 'Sales Revenue (₹)',
                        data: monthlySales,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.05)',
                        fill: true,
                        tension: 0.2,
                        borderWidth: 3
                    },
                    {
                        label: 'Purchase Cost (₹)',
                        data: monthlyPurchases,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.05)',
                        fill: true,
                        tension: 0.2,
                        borderWidth: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { grid: { color: gridColor }, ticks: { color: textLabelColor } },
                    y: { grid: { color: gridColor }, ticks: { color: textLabelColor } }
                },
                plugins: {
                    legend: { labels: { color: textLabelColor, font: { family: 'Outfit', weight: '500' } } }
                }
            }
        });
    }

    // 3. Render Product Sales Volume Mix Chart (Doughnut)
    const productWeights = PRODUCTS.map(p => {
        return {
            name: p.name,
            weight: state.sales.filter(s => s.product === p.id && s.dispatchStatus !== 'Rejected' && s.dispatchStatus !== 'Returned')
                .reduce((sum, s) => sum + (parseFloat(s.weight) || 0), 0)
        };
    }).filter(pw => pw.weight > 0);

    const canvasMix = document.getElementById('analyticsProductMixChart');
    if (canvasMix) {
        if (analyticsProductMixChartInstance) analyticsProductMixChartInstance.destroy();
        
        if (productWeights.length === 0) {
            // Draw placeholder if no sales logged
            const ctx = canvasMix.getContext('2d');
            ctx.clearRect(0, 0, canvasMix.width, canvasMix.height);
            ctx.fillStyle = textLabelColor;
            ctx.font = '14px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No sales records to analyze mix', canvasMix.width / 2, canvasMix.height / 2);
        } else {
            analyticsProductMixChartInstance = new Chart(canvasMix.getContext('2d'), {
                type: 'doughnut',
                data: {
                    labels: productWeights.map(pw => pw.name),
                    datasets: [{
                        data: productWeights.map(pw => pw.weight),
                        backgroundColor: [
                            'rgba(59, 130, 246, 0.8)',
                            'rgba(16, 185, 129, 0.8)',
                            'rgba(245, 158, 11, 0.8)',
                            'rgba(239, 68, 68, 0.8)',
                            'rgba(139, 92, 246, 0.8)',
                            'rgba(236, 72, 153, 0.8)',
                            'rgba(20, 184, 166, 0.8)'
                        ],
                        borderColor: isDark ? '#141c2f' : '#ffffff',
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { position: 'bottom', labels: { color: textLabelColor, font: { family: 'Inter', size: 10 } } }
                    }
                }
            });
        }
    }

    // 4. Render Yield Trend Over Time Chart (Line)
    const sortedLogs = [...state.productionLogs].sort((a, b) => new Date(a.date) - new Date(b.date));
    const yieldData = sortedLogs.map(p => {
        const w = parseFloat(p.weight) || 0;
        const o = parseFloat(p.oilYield) || 0;
        const c = parseFloat(p.cakeYield) || 0;
        const h = parseFloat(p.hullsYield) || 0;
        return w > 0 ? ((o + c + h) / w * 100) : 0;
    });

    const canvasYield = document.getElementById('analyticsYieldTrendChart');
    if (canvasYield) {
        if (analyticsYieldTrendChartInstance) analyticsYieldTrendChartInstance.destroy();
        
        if (sortedLogs.length === 0) {
            const ctx = canvasYield.getContext('2d');
            ctx.clearRect(0, 0, canvasYield.width, canvasYield.height);
            ctx.fillStyle = textLabelColor;
            ctx.font = '14px Inter';
            ctx.textAlign = 'center';
            ctx.fillText('No production logs to map yield trends', canvasYield.width / 2, canvasYield.height / 2);
        } else {
            analyticsYieldTrendChartInstance = new Chart(canvasYield.getContext('2d'), {
                type: 'line',
                data: {
                    labels: sortedLogs.map(p => p.date),
                    datasets: [{
                        label: 'Crushing Yield Recovery Rate (%)',
                        data: yieldData,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.05)',
                        fill: true,
                        tension: 0.1,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointBackgroundColor: '#6366f1'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: { grid: { color: gridColor }, ticks: { color: textLabelColor } },
                        y: { 
                            grid: { color: gridColor }, 
                            ticks: { color: textLabelColor },
                            min: 80,
                            max: 100
                        }
                    },
                    plugins: {
                        legend: { labels: { color: textLabelColor } }
                    }
                }
            });
        }
    }
}

// ==========================================================================
// 12. GATE PASS CONTROLLER & OPERATIONS (मे. विठ्ठल ऑईल मिल)
// ==========================================================================

let gpItemRowCounter = 0;

function renderGatePassTable() {
    const searchVal = document.getElementById('filter-gp-search')?.value.toLowerCase() || '';
    const dateVal = document.getElementById('filter-gp-date')?.value || '';
    const tbody = document.getElementById('gp-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';
    
    // Sort gate passes descending by date and serial number
    const sortedGP = [...state.gatePasses].sort((a, b) => {
        const dDiff = new Date(b.date) - new Date(a.date);
        if (dDiff !== 0) return dDiff;
        return parseInt(b.gatePassNo) - parseInt(a.gatePassNo);
    });

    sortedGP.forEach(gp => {
        // Apply search filter (Party name, lorry, station, Dalal, Pass No)
        const matchSearch = !searchVal || 
            gp.gatePassNo.toString().toLowerCase().includes(searchVal) ||
            gp.partyName.toLowerCase().includes(searchVal) ||
            gp.station.toLowerCase().includes(searchVal) ||
            (gp.broker && gp.broker.toLowerCase().includes(searchVal)) ||
            gp.lorryNo.toLowerCase().includes(searchVal);
            
        // Apply date filter
        const matchDate = !dateVal || gp.date === dateVal;

        if (matchSearch && matchDate) {
            const tr = document.createElement('tr');
            
            const bagsCount = gp.items.reduce((sum, item) => sum + (parseInt(item.bags) || 0), 0);
            
            tr.innerHTML = `
                <td><strong>${gp.gatePassNo}</strong></td>
                <td>${gp.date}</td>
                <td><strong>${gp.partyName}</strong></td>
                <td>${gp.station}</td>
                <td>${gp.broker || '-'}</td>
                <td>${gp.lorryNo}</td>
                <td><span class="badge badge-info">${bagsCount} Bags</span></td>
                <td style="text-align: center;">
                    <div style="display: flex; gap: 4px; justify-content: center;">
                        <button class="btn btn-secondary btn-sm" onclick="printGatePass('${gp.id}')" title="Print Gate Pass" style="background-color: #2563eb; color: white; border-color: #2563eb;">
                            <i class="fa-solid fa-print"></i>
                        </button>
                        <button class="btn btn-warning btn-sm" onclick="editGatePass('${gp.id}')" title="Edit">
                            <i class="fa-solid fa-edit"></i>
                        </button>
                        <button class="btn btn-danger btn-sm" onclick="deleteGatePass('${gp.id}')" title="Delete">
                            <i class="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        }
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted">No gate passes found matching filters.</td></tr>`;
    }
}

function getNextGatePassNo() {
    if (!state.gatePasses || state.gatePasses.length === 0) return 1523;
    const maxNo = state.gatePasses.reduce((max, gp) => {
        const val = parseInt(gp.gatePassNo);
        return isNaN(val) ? max : Math.max(max, val);
    }, 0);
    return maxNo > 0 ? maxNo + 1 : 1523;
}

function openGatePassModal(id = null) {
    populateAutocompleteDatalists();
    document.getElementById('gp-form').reset();
    document.getElementById('gp-items-tbody').innerHTML = '';
    gpItemRowCounter = 0;

    const modal = document.getElementById('gate-pass-modal');
    
    if (id) {
        // Edit mode
        const gp = state.gatePasses.find(g => g.id === id);
        if (!gp) return;
        
        document.getElementById('gp-id').value = gp.id;
        document.getElementById('gp-no').value = gp.gatePassNo;
        document.getElementById('gp-date').value = gp.date;
        document.getElementById('gp-party').value = gp.partyName;
        document.getElementById('gp-station').value = gp.station;
        document.getElementById('gp-broker').value = gp.broker || '';
        document.getElementById('gp-lorry').value = gp.lorryNo;
        document.getElementById('gp-driver-mobile').value = gp.driverMobile || '';
        document.getElementById('gp-transport').value = gp.transport || '';
        document.getElementById('gp-freight').value = gp.freight || '';

        // Populate items
        if (gp.items && gp.items.length > 0) {
            gp.items.forEach(item => {
                addGatePassItemRow(item.productName, item.bhartee, item.bags, item.marka, item.thappi);
            });
        } else {
            addGatePassItemRow();
        }
        
        document.getElementById('gp-modal-title').textContent = "Edit Gate Pass (गेट पास)";
    } else {
        // New Mode
        document.getElementById('gp-id').value = '';
        document.getElementById('gp-no').value = getNextGatePassNo();
        document.getElementById('gp-date').value = new Date().toISOString().split('T')[0];
        
        // Default Prefilled
        prepopulateDefaultGPMalaiItems();
        
        document.getElementById('gp-modal-title').textContent = "Create Gate Pass (गेट पास)";
    }

    modal.classList.add('active');
}

function addGatePassItemRow(productName = '', bhartee = '50', bags = '', marka = '', thappi = '') {
    gpItemRowCounter++;
    const tbody = document.getElementById('gp-items-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.id = `gp-item-row-${gpItemRowCounter}`;

    // Get list of standard products to show as quick autocomplete helper
    const productOptions = PRODUCTS.map(p => `<option value="${p.name}"></option>`).join('');

    tr.innerHTML = `
        <td class="text-center font-bold" style="vertical-align: middle;">${tbody.children.length + 1}</td>
        <td>
            <input type="text" class="form-control gp-item-product" required value="${productName}" placeholder="e.g. Wash Oil, Hulls" list="gp-products-list-${gpItemRowCounter}">
            <datalist id="gp-products-list-${gpItemRowCounter}">
                ${productOptions}
                <option value="Keshar Malai (केशर मलाई)"></option>
                <option value="Gokul Malai (गोकुळ मलाई)"></option>
                <option value="Mastavan Malai (मस्तवन मलाई)"></option>
            </datalist>
        </td>
        <td>
            <input type="number" class="form-control gp-item-bhartee" required value="${bhartee}" placeholder="50">
        </td>
        <td>
            <input type="number" class="form-control gp-item-bags" required value="${bags}" placeholder="Bags qty">
        </td>
        <td>
            <input type="text" class="form-control gp-item-marka" value="${marka}" placeholder="e.g. Gokul">
        </td>
        <td>
            <input type="text" class="form-control gp-item-thappi" value="${thappi}" placeholder="Stack No">
        </td>
        <td style="text-align: center; vertical-align: middle;">
            <button class="btn btn-danger btn-sm" type="button" onclick="removeGatePassItemRow('${tr.id}')" title="Delete Row" style="padding: 4px 8px;">
                <i class="fa-solid fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    recalculateGatePassSrs();
}

function removeGatePassItemRow(rowId) {
    const row = document.getElementById(rowId);
    if (row) {
        row.remove();
        recalculateGatePassSrs();
    }
}

function recalculateGatePassSrs() {
    const tbody = document.getElementById('gp-items-tbody');
    if (!tbody) return;
    Array.from(tbody.children).forEach((tr, idx) => {
        tr.children[0].textContent = idx + 1;
    });
}

function prepopulateDefaultGPMalaiItems() {
    const tbody = document.getElementById('gp-items-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    addGatePassItemRow('Keshar Malai (केशर मलाई)', '50', '');
    addGatePassItemRow('Gokul Malai (गोकुळ मलाई)', '50', '');
    addGatePassItemRow('Mastavan Malai (मस्तवन मलाई)', '50', '');
}

function handleGatePassSubmit(e) {
    e.preventDefault();
    
    const id = document.getElementById('gp-id').value;
    const gatePassNo = document.getElementById('gp-no').value.trim();
    const date = document.getElementById('gp-date').value;
    const partyName = document.getElementById('gp-party').value.trim();
    const station = document.getElementById('gp-station').value.trim();
    const broker = document.getElementById('gp-broker').value.trim();
    const lorryNo = document.getElementById('gp-lorry').value.trim();
    const driverMobile = document.getElementById('gp-driver-mobile').value.trim();
    const transport = document.getElementById('gp-transport').value.trim();
    const freight = parseFloat(document.getElementById('gp-freight').value) || 0;

    // Collect dynamic table rows
    const items = [];
    const tbody = document.getElementById('gp-items-tbody');
    if (tbody) {
        Array.from(tbody.children).forEach(tr => {
            const prod = tr.querySelector('.gp-item-product').value.trim();
            const bhartee = tr.querySelector('.gp-item-bhartee').value.trim();
            const bags = parseInt(tr.querySelector('.gp-item-bags').value) || 0;
            const marka = tr.querySelector('.gp-item-marka').value.trim();
            const thappi = tr.querySelector('.gp-item-thappi').value.trim();

            if (prod && bags > 0) {
                items.push({ productName: prod, bhartee, bags, marka, thappi });
            }
        });
    }

    if (items.length === 0) {
        alert("Please enter at least one dispatch product with a positive bag quantity!");
        return;
    }

    const data = {
        id: id || 'gp-' + Date.now(),
        gatePassNo,
        date,
        partyName,
        station,
        broker,
        items,
        lorryNo,
        driverMobile,
        transport,
        freight
    };

    if (id) {
        // Edit mode
        const index = state.gatePasses.findIndex(g => g.id === id);
        if (index !== -1) {
            state.gatePasses[index] = data;
        }
    } else {
        // New mode
        state.gatePasses.push(data);
    }

    saveState();
    closeModal('gate-pass-modal');
    renderGatePassTable();
    alert("Gate Pass saved successfully!");
    
    // Automatically trigger printing slip
    printGatePass(data.id);
}

function editGatePass(id) {
    openGatePassModal(id);
}

function deleteGatePass(id) {
    if (confirm("Are you sure you want to delete this Gate Pass? This cannot be undone.")) {
        state.gatePasses = state.gatePasses.filter(g => g.id !== id);
        saveState();
        renderGatePassTable();
    }
}

function clearGatePassFilters() {
    const search = document.getElementById('filter-gp-search');
    const date = document.getElementById('filter-gp-date');
    if (search) search.value = '';
    if (date) date.value = '';
    renderGatePassTable();
}

function printGatePass(id) {
    const gp = state.gatePasses.find(g => g.id === id);
    if (!gp) return;

    // Build the items table rows
    let itemRowsHtml = '';
    gp.items.forEach((item, idx) => {
        itemRowsHtml += `
            <tr style="height: 38px;">
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; font-weight: bold;">${idx + 1}</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; font-weight: bold;">${item.productName}</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; font-weight: bold;">${item.bhartee}</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; font-weight: bold;">${item.bags}</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; font-weight: bold;">${item.marka || '-'}</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; font-weight: bold;">${item.thappi || '-'}</td>
            </tr>
        `;
    });

    // Pad with empty rows to make it look exactly like the physical pad
    const emptyRowsCount = Math.max(0, 5 - gp.items.length);
    for (let i = 0; i < emptyRowsCount; i++) {
        itemRowsHtml += `
            <tr style="height: 38px;">
                <td style="border: 1px solid #c2410c; padding: 4px 8px; text-align: center; color: transparent;">-</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; color: transparent;">-</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; color: transparent;">-</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; color: transparent;">-</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; color: transparent;">-</td>
                <td style="border: 1px solid #c2410c; padding: 4px 8px; color: transparent;">-</td>
            </tr>
        `;
    }

    const totalBags = gp.items.reduce((sum, item) => sum + (parseInt(item.bags) || 0), 0);

    const formattedDateObj = new Date(gp.date);
    const day = String(formattedDateObj.getDate()).padStart(2, '0');
    const month = String(formattedDateObj.getMonth() + 1).padStart(2, '0');
    const year = formattedDateObj.getFullYear();
    const formattedDate = `${day} / ${month} / ${year}`;

    // HTML printable window markup matching the physical print colors (red/orange)
    const printContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Gate Pass No. ${gp.gatePassNo}</title>
        <style>
            @media print {
                body {
                    margin: 0;
                    padding: 0;
                    background-color: #ffffff;
                }
                .print-container {
                    border: 3px double #c2410c !important;
                }
                .no-print {
                    display: none;
                }
            }
            body {
                font-family: 'Segoe UI', Arial, sans-serif;
                background-color: #f3f4f6;
                margin: 0;
                padding: 20px;
                color: #374151;
            }
            .print-container {
                max-width: 580px;
                margin: 0 auto;
                background-color: #ffffff;
                border: 3px double #c2410c;
                padding: 15px;
                box-sizing: border-box;
                border-radius: 4px;
            }
            .header-text {
                text-align: center;
                color: #c2410c;
            }
            .header-text h1 {
                margin: 2px 0;
                font-size: 24px;
                font-weight: 800;
            }
            .header-text p {
                margin: 1px 0;
                font-size: 11px;
                font-weight: bold;
            }
            .gp-badge {
                border: 2px solid #c2410c;
                padding: 3px 15px;
                font-size: 18px;
                font-weight: 800;
                border-radius: 4px;
                display: inline-block;
                color: #c2410c;
            }
            .info-table {
                width: 100%;
                margin-top: 10px;
                border-collapse: collapse;
                font-size: 13px;
                font-weight: bold;
            }
            .info-table td {
                padding: 5px 0;
                color: #c2410c;
            }
            .info-underline {
                border-bottom: 1px solid #c2410c;
                padding-left: 5px;
                color: #000000;
                font-weight: bold;
            }
            .items-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 12px;
                font-size: 13px;
            }
            .items-table th {
                border: 1px solid #c2410c;
                background-color: rgba(194, 65, 12, 0.08);
                color: #c2410c;
                padding: 6px;
                font-weight: bold;
            }
            .items-table td {
                color: #000000;
            }
            .footer-grid {
                margin-top: 15px;
                width: 100%;
                font-size: 13px;
                font-weight: bold;
                color: #c2410c;
            }
            .footer-grid td {
                padding: 4px 0;
            }
        </style>
    </head>
    <body>
        <div class="no-print" style="max-width: 580px; margin: 0 auto 15px auto; display: flex; justify-content: space-between;">
            <button onclick="window.print()" style="padding: 10px 20px; font-weight: bold; background: #c2410c; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Print Gate Pass
            </button>
            <button onclick="window.close()" style="padding: 10px 20px; font-weight: bold; background: #374151; color: white; border: none; border-radius: 4px; cursor: pointer;">
                Close Window
            </button>
        </div>
        
        <div class="print-container">
            <div class="header-text">
                <p style="font-size: 13px; margin-bottom: 2px;">॥ श्री ॥</p>
                <h1>मे. विठ्ठल ऑईल मिल</h1>
                <p>गट नं. १४२३, त्रिमुर्ती पब्लिक स्कूल समोर, नेवासा रोड, शेवगांव, जि. अ.नगर</p>
                <p>ऑफीस : मे. रा. वि. धूत, Market Yard, Shevgaon - 414502 Dist. Ahmednagar (MS)</p>
            </div>
            
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px; border-bottom: 2px solid #c2410c; padding-bottom: 8px;">
                <div style="font-size: 15px; font-weight: bold; color: #c2410c;">
                    नं. <span style="color: #000000; font-size: 18px; font-weight: 800; border-bottom: 1px solid #c2410c; padding: 0 5px;">${gp.gatePassNo}</span>
                </div>
                <div class="gp-badge">गेट पास</div>
                <div style="font-size: 14px; font-weight: bold; color: #c2410c;">
                    दिनांक: <span style="color: #000000; border-bottom: 1px solid #c2410c; padding-bottom: 1px;">${formattedDate}</span>
                </div>
            </div>

            <table class="info-table">
                <tr>
                    <td style="width: 85px;">पार्टीचे नांव :</td>
                    <td class="info-underline">${gp.partyName}</td>
                </tr>
                <tr>
                    <td>स्टेशन :</td>
                    <td class="info-underline">
                        <table style="width: 100%; border-collapse: collapse; margin: 0; padding: 0;">
                            <tr>
                                <td style="padding: 0; color: #000000; font-weight: bold;">${gp.station}</td>
                                <td style="width: 50px; padding: 0; text-align: right; color: #c2410c;">दलाल:</td>
                                <td style="width: 150px; padding: 0 0 0 5px; color: #000000; font-weight: bold;" class="info-underline">${gp.broker || '-'}</td>
                            </tr>
                        </table>
                    </td>
                </tr>
            </table>

            <table class="items-table">
                <thead>
                    <tr>
                        <th style="width: 40px;">अ.नं.</th>
                        <th>माल प्रकार</th>
                        <th style="width: 70px;">भरती</th>
                        <th style="width: 70px;">पोते</th>
                        <th style="width: 80px;">मार्का</th>
                        <th style="width: 80px;">थप्पी</th>
                    </tr>
                </thead>
                <tbody>
                    ${itemRowsHtml}
                    <tr style="height: 38px;">
                        <td colspan="3" style="border: 1px solid #c2410c; text-align: right; padding: 6px 12px; font-weight: 800; color: #c2410c;">एकूण पोते:</td>
                        <td style="border: 1px solid #c2410c; text-align: center; font-weight: 800; font-size: 15px; background-color: rgba(194, 65, 12, 0.08);">${totalBags}</td>
                        <td colspan="2" style="border: 1px solid #c2410c; background-color: rgba(194, 65, 12, 0.08);"></td>
                    </tr>
                </tbody>
            </table>

            <table class="footer-grid">
                <tr>
                    <td style="width: 60px;">गाडी नं.:</td>
                    <td class="info-underline" style="width: 190px;">${gp.lorryNo}</td>
                    <td style="width: 90px; text-align: right; padding-right: 8px;">ड्रायव्हर मो.नं.:</td>
                    <td class="info-underline">${gp.driverMobile || '-'}</td>
                </tr>
                <tr>
                    <td>ट्रान्सपोर्ट:</td>
                    <td class="info-underline">${gp.transport || '-'}</td>
                    <td style="text-align: right; padding-right: 8px;">गाडी भाडे:</td>
                    <td class="info-underline">${gp.freight > 0 ? '₹ ' + gp.freight.toFixed(2) : '-'}</td>
                </tr>
            </table>
            
            <div style="margin-top: 55px; display: flex; justify-content: flex-end;">
                <div style="text-align: center; width: 150px; border-top: 1px dashed #c2410c; padding-top: 5px; font-size: 12px; font-weight: bold; color: #c2410c;">
                    माल देणाराची सही
                </div>
            </div>
        </div>
    </body>
    </html>
    `;

    const printWindow = window.open('', '_blank', 'width=650,height=800');
    if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(printContent);
        printWindow.document.close();
    }
}

// --- DYNAMIC SALES MULTI-PRODUCT ITEM CONTROLLERS ---
let salesItemRowCounter = 0;

function addSalesItemRow(product = '', weight = '', rate = '', bagType = '', bagQty = '', juteBagWeight = '', juteBagQty = '') {
    salesItemRowCounter++;
    const tbody = document.getElementById('sales-items-tbody');
    if (!tbody) return;

    const tr = document.createElement('tr');
    tr.id = `sales-item-row-${salesItemRowCounter}`;

    const productOptions = getSalesProductOptionsHtml(product);

    const ppOptions = `
        <option value="" ${!bagType ? 'selected' : ''}>-- None --</option>
        <option value="gm-pp-50" ${bagType === 'gm-pp-50' ? 'selected' : ''}>50kg PP</option>
        <option value="gm-pp-60" ${bagType === 'gm-pp-60' ? 'selected' : ''}>60kg PP</option>
        <option value="gm-pp-70" ${bagType === 'gm-pp-70' ? 'selected' : ''}>70kg PP</option>
        <option value="gm-pp-km" ${bagType === 'gm-pp-km' ? 'selected' : ''}>KM PP</option>
        <option value="gm-pp-mm" ${bagType === 'gm-pp-mm' ? 'selected' : ''}>MM PP</option>
    `;

    const juteOptions = `
        <option value="" ${!juteBagWeight ? 'selected' : ''}>-- None --</option>
        <option value="45" ${juteBagWeight === 45 ? 'selected' : ''}>45 kg Jute</option>
        <option value="50" ${juteBagWeight === 50 ? 'selected' : ''}>50 kg Jute</option>
        <option value="60" ${juteBagWeight === 60 ? 'selected' : ''}>60 kg Jute</option>
        <option value="75" ${juteBagWeight === 75 ? 'selected' : ''}>75 kg Jute</option>
        <option value="90" ${juteBagWeight === 90 ? 'selected' : ''}>90 kg Jute</option>
        <option value="100" ${juteBagWeight === 100 ? 'selected' : ''}>100 kg Jute</option>
    `;

    tr.innerHTML = `
        <td>
            <select class="form-control text-xs sales-item-product" required>
                ${productOptions}
            </select>
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs sales-item-weight" required placeholder="Weight" value="${weight}">
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs sales-item-rate" required placeholder="Rate" value="${rate}">
        </td>
        <td>
            <select class="form-control text-xs sales-item-bag-select" style="margin-bottom: 4px; padding: 2px;">
                ${ppOptions}
            </select>
            <input type="number" class="form-control text-xs sales-item-bag-qty" placeholder="PP Count" min="0" value="${bagQty || ''}">
        </td>
        <td>
            <select class="form-control text-xs sales-item-jute-select" style="margin-bottom: 4px; padding: 2px;">
                ${juteOptions}
            </select>
            <input type="number" class="form-control text-xs sales-item-jute-qty" placeholder="Jute Count" min="0" value="${juteBagQty || ''}">
        </td>
        <td style="text-align: center; vertical-align: middle;">
            <button class="btn btn-danger btn-sm" type="button" onclick="removeSalesItemRow('sales-item-row-${salesItemRowCounter}')" style="padding: 4px 8px;">
                <i class="fa-solid fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
}

function removeSalesItemRow(rowId) {
    const tbody = document.getElementById('sales-items-tbody');
    if (!tbody) return;
    if (tbody.children.length <= 1) {
        alert("A sales dispatch must contain at least one product row!");
        return;
    }
    const row = document.getElementById(rowId);
    if (row) row.remove();
}

function getSalesProductOptionsHtml(selectedId = '') {
    let html = '<option value="">-- Select Product --</option>';
    PRODUCTS.forEach(p => {
        if (p.category !== 'Seed' && p.id !== 'sarki-bardan' && p.id !== 'gm-pp-hdr') {
            const selected = p.id === selectedId ? 'selected' : '';
            html += `<option value="${p.id}" ${selected}>${p.name}</option>`;
        }
    });
    return html;
}

// --- DYNAMIC REFINING BATCH CONTROLLERS ---
let refBatchRowCounter = 0;

function addRefiningBatchRow(date = '', crude = '', wash = '', acid = '', gaad = '') {
    refBatchRowCounter++;
    const tbody = document.getElementById('refining-batches-tbody');
    if (!tbody) return;

    if (!date) date = new Date().toISOString().split('T')[0];

    const tr = document.createElement('tr');
    tr.id = `ref-batch-row-${refBatchRowCounter}`;

    tr.innerHTML = `
        <td>
            <input type="date" class="form-control text-xs ref-batch-date" required value="${date}">
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs ref-batch-crude" required placeholder="Crude input" value="${crude}" oninput="recalculateRefiningSummary()">
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs ref-batch-wash" required placeholder="Wash yield" value="${wash}" oninput="recalculateRefiningSummary()">
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs ref-batch-acid" required placeholder="Acid oil" value="${acid}" oninput="recalculateRefiningSummary()">
        </td>
        <td>
            <input type="number" step="0.01" class="form-control text-xs ref-batch-gaad" required placeholder="Gaad yield" value="${gaad}" oninput="recalculateRefiningSummary()">
        </td>
        <td style="text-align: center; vertical-align: middle;">
            <button class="btn btn-danger btn-sm" type="button" onclick="removeRefiningBatchRow('${tr.id}')" style="padding: 4px 8px;">
                <i class="fa-solid fa-times"></i>
            </button>
        </td>
    `;
    tbody.appendChild(tr);
    recalculateRefiningSummary();
}

function removeRefiningBatchRow(rowId) {
    const tbody = document.getElementById('refining-batches-tbody');
    if (!tbody) return;
    if (tbody.children.length <= 1) {
        alert("A refining run must contain at least one batch row!");
        return;
    }
    const row = document.getElementById(rowId);
    if (row) row.remove();
    recalculateRefiningSummary();
}

function recalculateRefiningSummary() {
    const tbody = document.getElementById('refining-batches-tbody');
    if (!tbody) return;

    let totalCrude = 0;
    let totalWash = 0;
    let totalAcid = 0;
    let totalGaad = 0;

    Array.from(tbody.children).forEach(tr => {
        const crude = parseFloat(tr.querySelector('.ref-batch-crude').value) || 0;
        const wash = parseFloat(tr.querySelector('.ref-batch-wash').value) || 0;
        const acid = parseFloat(tr.querySelector('.ref-batch-acid').value) || 0;
        const gaad = parseFloat(tr.querySelector('.ref-batch-gaad').value) || 0;

        totalCrude += crude;
        totalWash += wash;
        totalAcid += acid;
        totalGaad += gaad;
    });

    const loss = Math.max(0, totalCrude - totalWash - totalAcid - totalGaad);
    const lossPct = totalCrude > 0 ? ((loss / totalCrude) * 100).toFixed(1) : '0.0';

    const crudeEl = document.getElementById('ref-summary-crude');
    const washEl = document.getElementById('ref-summary-wash');
    const acidEl = document.getElementById('ref-summary-acid');
    const gaadEl = document.getElementById('ref-summary-gaad');
    const lossEl = document.getElementById('ref-summary-loss');

    if (crudeEl) crudeEl.textContent = `${totalCrude.toFixed(2)} Qtl`;
    if (washEl) washEl.textContent = `${totalWash.toFixed(2)} Qtl`;
    if (acidEl) acidEl.textContent = `${totalAcid.toFixed(2)} Qtl`;
    if (gaadEl) gaadEl.textContent = `${totalGaad.toFixed(2)} Qtl`;
    if (lossEl) lossEl.textContent = `${loss.toFixed(2)} Qtl (${lossPct}%)`;
}

