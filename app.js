/**
 * Saku Librayn - Application Logic
 * Pembukuan Suara Cerdas untuk UMKM
 *
 * Stack: Supabase Auth + PostgreSQL, Google Gemini 1.5 Flash, Web Speech API
 * Author: ryanwardiana | © 2026 Saku Librayn
 *
 * =========================================================
 * CARA PENGATURAN API (BACA INI SEBELUM MULAI):
 * =========================================================
 * 1. SUPABASE URL & ANON KEY:
 *    - Buka supabase.com → Pilih project Anda
 *    - Klik Settings (roda gigi) → API
 *    - Salin "Project URL" dan "anon public" key
 *    - Tempel ke kolom di Dashboard → Pengaturan API
 *
 * 2. GEMINI API KEY (untuk Voice & OCR):
 *    - Buka aistudio.google.com
 *    - Login Google → Klik "Get API Key" → "Create API Key"
 *    - Salin key yang diawali "AIza..."
 *    - Tempel ke kolom Gemini API Key di Dashboard → Pengaturan API
 *    - Klik "Simpan Konfigurasi"
 *    - Selesai! Voice Note dan OCR sudah aktif.
 * =========================================================
 */

// =============================================
// DEFAULT CREDENTIALS (OVERRIDE VIA UI SETTINGS)
// =============================================
const DEFAULT_SUPABASE_URL = "https://wdilryxahcylzosahdof.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_wK3CwI-qTtJoY8ilQOw2xg_RL89GQcK";
const DEFAULT_GEMINI_API_KEY = "";

// =============================================
// APPLICATION STATE
// =============================================
let supabaseClient = null;
let currentUser = null;
let transactions = [];
let activeInputType = 'expense';
let calcExpression = '';
let currentTxFilter = 'all';
let currentMobileTab = 'dashboard';
let cashflowChartInstance = null;
let categoryChartInstance = null;
let speechRecognitionInstance = null;
let qrScannerInstance = null;
let loginQrScannerInstance = null;
let loginSyncChannel = null;
let shareSyncChannel = null;
let currentLoginMode = 'form';
let currentLoginQrSubMode = 'show';
let currentQrMode = 'share';

// =============================================
// INIT
// =============================================
window.onload = function () {
    initApp();
};

function initApp() {
    // Apply saved theme
    const savedTheme = localStorage.getItem('sk_theme') || 'dark';
    if (savedTheme === 'light') {
        document.documentElement.classList.remove('dark');
    } else {
        document.documentElement.classList.add('dark');
    }

    // Load saved credentials
    const supaUrl = localStorage.getItem('sk_supabase_url') || DEFAULT_SUPABASE_URL;
    const supaKey = localStorage.getItem('sk_supabase_key') || DEFAULT_SUPABASE_ANON_KEY;
    const geminiKey = localStorage.getItem('sk_gemini_key') || DEFAULT_GEMINI_API_KEY;

    const elUrl = document.getElementById('input-supabase-url');
    const elKey = document.getElementById('input-supabase-key');
    const elGem = document.getElementById('input-gemini-key');
    if (elUrl) elUrl.value = supaUrl;
    if (elKey) elKey.value = supaKey;
    if (elGem) elGem.value = geminiKey;

    // Init Supabase
    if (supaUrl && supaKey) {
        try {
            supabaseClient = window.supabase.createClient(supaUrl, supaKey);
        } catch (e) {
            console.error("Supabase init error:", e);
        }
    }

    // Auth listener
    if (supabaseClient) {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            if (session && session.user && localStorage.getItem('sk_demo') !== 'true') {
                setCurrentUserFromSession(session.user);
                showDashboard();
            } else if (!session && localStorage.getItem('sk_demo') !== 'true') {
                currentUser = null;
                localStorage.removeItem('sk_user');
                showLoginScreen();
            }
        });
    }

    // Check persisted session
    const savedUser = localStorage.getItem('sk_user');
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            showDashboard();
        } catch (e) {
            showLoginScreen();
        }
    } else {
        showLoginScreen();
    }

    setupEventListeners();
}

function setCurrentUserFromSession(user) {
    currentUser = {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        picture: user.user_metadata?.avatar_url || null
    };
    localStorage.setItem('sk_user', JSON.stringify(currentUser));
    localStorage.setItem('sk_demo', 'false');
}

function setupEventListeners() {
    safeListener('form-login', 'submit', loginWithEmail);
    safeListener('form-register', 'submit', registerWithEmail);
    safeListener('link-show-register', 'click', (e) => { e.preventDefault(); showAuthForm('register'); });
    safeListener('link-show-login', 'click', (e) => { e.preventDefault(); showAuthForm('login'); });
    safeListener('btn-demo-mode', 'click', loginAsDemo);

    // Amount input - format with dots
    const amtInput = document.getElementById('input-amount');
    if (amtInput) {
        amtInput.addEventListener('input', function (e) {
            const rawVal = e.target.value.replace(/\./g, '');
            calcExpression = rawVal;
            e.target.value = formatDisplayNumber(rawVal);
        });
        amtInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); pressCalc('='); }
        });
    }

    // Resize handler
    window.addEventListener('resize', () => {
        if (window.innerWidth >= 768) {
            document.getElementById('section-dashboard')?.classList.remove('hidden');
            document.getElementById('section-transactions')?.classList.remove('hidden');
        } else {
            switchMobileTab(currentMobileTab);
        }
    });
}

function safeListener(id, event, handler) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
}

// =============================================
// AUTH
// =============================================
function showLoginScreen() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('hidden');
}

function showAuthForm(mode) {
    const loginForm = document.getElementById('form-login');
    const registerForm = document.getElementById('form-register');
    if (mode === 'register') {
        loginForm.classList.add('hidden');
        registerForm.classList.remove('hidden');
    } else {
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
    }
}

async function loginWithEmail(e) {
    if (e) e.preventDefault();
    if (!supabaseClient) {
        showToast("Supabase belum dikonfigurasi!", "error");
        toggleApiSettings();
        return;
    }

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = e.target.querySelector('button[type=submit]');
    setButtonLoading(btn, true, 'Masuk Sekarang');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (data?.user) {
            setCurrentUserFromSession(data.user);
            showToast("Masuk berhasil! Selamat datang 🎉", "success");
            showDashboard();
        }
    } catch (err) {
        showToast(`Masuk gagal: ${err.message}`, "error");
    } finally {
        setButtonLoading(btn, false, '<i class="fa-solid fa-arrow-right-to-bracket mr-2"></i>Masuk Sekarang');
    }
}

async function registerWithEmail(e) {
    if (e) e.preventDefault();
    if (!supabaseClient) {
        showToast("Supabase belum dikonfigurasi!", "error");
        toggleApiSettings();
        return;
    }

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (password.length < 6) {
        showToast("Password minimal 6 karakter!", "warning");
        return;
    }

    const btn = e.target.querySelector('button[type=submit]');
    setButtonLoading(btn, true, 'Buat Akun Baru');

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
            options: { data: { full_name: name } }
        });
        if (error) throw error;

        if (data?.session) {
            setCurrentUserFromSession(data.user);
            showToast("Akun berhasil dibuat! Selamat datang 🎉", "success");
            showDashboard();
        } else {
            showToast("Akun dibuat! Cek email untuk verifikasi, lalu masuk.", "info");
            showAuthForm('login');
        }
    } catch (err) {
        showToast(`Daftar gagal: ${err.message}`, "error");
    } finally {
        setButtonLoading(btn, false, '<i class="fa-solid fa-user-plus mr-2"></i>Buat Akun Baru');
    }
}

function loginAsDemo() {
    currentUser = {
        id: "demo-user-saku-librayn",
        email: "demo@sakulibrayn.local",
        name: "Demo UMKM",
        picture: null
    };
    localStorage.setItem('sk_demo', 'true');
    localStorage.setItem('sk_user', JSON.stringify(currentUser));
    showToast("Mode Demo aktif. Data tersimpan secara lokal.", "info");
    showDashboard();
}

async function logout() {
    const isDemo = localStorage.getItem('sk_demo') === 'true';
    localStorage.removeItem('sk_user');
    localStorage.removeItem('sk_demo');
    currentUser = null;
    transactions = [];

    if (supabaseClient && !isDemo) {
        try { await supabaseClient.auth.signOut(); } catch (e) {}
    }

    // Clean up QR channels
    if (loginSyncChannel) { loginSyncChannel.unsubscribe(); loginSyncChannel = null; }
    if (shareSyncChannel) { shareSyncChannel.unsubscribe(); shareSyncChannel = null; }

    showLoginScreen();
    showToast("Berhasil keluar.", "info");
}

// Login Mode: form | qr
function setLoginMode(mode) {
    currentLoginMode = mode;
    const formTab = document.getElementById('tab-login-form');
    const qrTab = document.getElementById('tab-login-qr');
    const formSection = document.getElementById('login-form-section');
    const qrSection = document.getElementById('login-qr-section');

    const activeClass = 'flex-1 py-2 text-xs font-semibold rounded-lg bg-violet-600 text-white shadow-violet btn-press';
    const inactiveClass = 'flex-1 py-2 text-xs font-semibold rounded-lg text-slate-400 btn-press';

    if (mode === 'form') {
        formTab.className = activeClass;
        qrTab.className = inactiveClass;
        formSection.classList.remove('hidden');
        qrSection.classList.add('hidden');
        stopLoginQrScanner();
        if (loginSyncChannel) { loginSyncChannel.unsubscribe(); loginSyncChannel = null; }
    } else {
        qrTab.className = activeClass;
        formTab.className = inactiveClass;
        qrSection.classList.remove('hidden');
        formSection.classList.add('hidden');
        setLoginQrSubMode('show');
    }
}

function setLoginQrSubMode(submode) {
    currentLoginQrSubMode = submode;
    const btnShow = document.getElementById('btn-login-qr-show');
    const btnScan = document.getElementById('btn-login-qr-scan');
    const showPanel = document.getElementById('login-qr-show-panel');
    const scanPanel = document.getElementById('login-qr-scan-panel');

    const activeClass = 'flex-1 py-1.5 text-[10px] font-semibold rounded-lg bg-violet-600 text-white btn-press';
    const inactiveClass = 'flex-1 py-1.5 text-[10px] font-semibold rounded-lg text-slate-400 btn-press';

    if (submode === 'show') {
        btnShow.className = activeClass;
        btnScan.className = inactiveClass;
        showPanel.classList.remove('hidden');
        scanPanel.classList.add('hidden');
        stopLoginQrScanner();
        initLoginQrCode();
    } else {
        btnScan.className = activeClass;
        btnShow.className = inactiveClass;
        scanPanel.classList.remove('hidden');
        scanPanel.classList.remove('hidden');
        scanPanel.style.display = 'flex';
        showPanel.classList.add('hidden');
        if (loginSyncChannel) { loginSyncChannel.unsubscribe(); loginSyncChannel = null; }
    }
}

/** Display a simple QR on login screen that HP (already logged in) can scan to push session here */
function initLoginQrCode() {
    if (!supabaseClient) {
        const url = localStorage.getItem('sk_supabase_url') || DEFAULT_SUPABASE_URL;
        const key = localStorage.getItem('sk_supabase_key') || DEFAULT_SUPABASE_ANON_KEY;
        if (url && key) {
            try { supabaseClient = window.supabase.createClient(url, key); } catch (e) {}
        }
    }

    const container = document.getElementById('login-qrcode-container');
    if (!container) return;
    container.innerHTML = '';

    // Short token only — keeps QR code sparse/easy to scan
    const token = 'sk_' + generateShortToken();

    new QRCode(container, {
        text: 'sync_login:' + token,
        width: 144,
        height: 144,
        colorDark: '#1e1b4b',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M  // Medium error correction = simpler/sparser pattern
    });

    // Listen on Supabase Realtime for session push from HP
    if (loginSyncChannel) { loginSyncChannel.unsubscribe(); }

    if (!supabaseClient) return;

    loginSyncChannel = supabaseClient.channel('sk-login-' + token);
    loginSyncChannel.on('broadcast', { event: 'push-session' }, ({ payload }) => {
        if (!payload) return;
        applyIncomingSession(payload);
    }).subscribe();
}

function startLoginQrScanner() {
    const placeholder = document.getElementById('login-qr-scanner-placeholder');
    if (placeholder) placeholder.classList.add('hidden');

    if (loginQrScannerInstance) {
        try { loginQrScannerInstance.clear(); } catch (e) {}
        loginQrScannerInstance = null;
    }

    loginQrScannerInstance = new Html5Qrcode('login-qr-reader');
    loginQrScannerInstance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 160, height: 160 } },
        onQrScanSuccess,
        () => {}
    ).catch(err => {
        showToast("Akses kamera ditolak atau tidak tersedia.", "error");
        if (placeholder) placeholder.classList.remove('hidden');
    });
}

function stopLoginQrScanner() {
    if (loginQrScannerInstance) {
        try { loginQrScannerInstance.clear(); } catch (e) {}
        loginQrScannerInstance = null;
    }
    const placeholder = document.getElementById('login-qr-scanner-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
}

// =============================================
// DASHBOARD
// =============================================
function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');

    updateUserProfileUI();
    document.getElementById('input-date').value = todayString();

    if (window.innerWidth < 768) {
        switchMobileTab(currentMobileTab);
    } else {
        document.getElementById('section-dashboard')?.classList.remove('hidden');
        document.getElementById('section-transactions')?.classList.remove('hidden');
    }

    loadData();
}

function updateUserProfileUI() {
    if (!currentUser) return;

    const initial = (currentUser.name || currentUser.email || 'U').charAt(0).toUpperCase();
    const hasAvatar = currentUser.picture && !currentUser.picture.includes('placeholder');

    // Desktop
    const desktopAvatar = document.getElementById('user-avatar');
    const desktopInitial = document.getElementById('user-avatar-initial');
    const desktopName = document.getElementById('user-name');
    if (desktopName) desktopName.textContent = currentUser.name;
    if (hasAvatar && desktopAvatar) {
        desktopAvatar.src = currentUser.picture;
        desktopAvatar.classList.remove('hidden');
        if (desktopInitial) desktopInitial.classList.add('hidden');
    } else {
        if (desktopAvatar) desktopAvatar.classList.add('hidden');
        if (desktopInitial) { desktopInitial.textContent = initial; desktopInitial.classList.remove('hidden'); }
    }

    // Mobile
    const mobAvatar = document.getElementById('mobile-user-avatar');
    const mobInitial = document.getElementById('mobile-user-avatar-initial');
    const mobName = document.getElementById('mobile-user-name');
    if (mobName) mobName.textContent = currentUser.name;
    if (hasAvatar && mobAvatar) {
        mobAvatar.src = currentUser.picture;
        mobAvatar.classList.remove('hidden');
        if (mobInitial) mobInitial.classList.add('hidden');
    } else {
        if (mobAvatar) mobAvatar.classList.add('hidden');
        if (mobInitial) { mobInitial.textContent = initial; mobInitial.classList.remove('hidden'); }
    }
}

// =============================================
// DATA
// =============================================
async function loadData() {
    const loading = document.getElementById('tx-loading-state');
    const empty = document.getElementById('tx-empty-state');
    const list = document.getElementById('tx-list-container');
    if (loading) loading.classList.remove('hidden');
    if (empty) empty.classList.add('hidden');
    if (list) list.classList.add('hidden');

    const isDemo = localStorage.getItem('sk_demo') === 'true';

    if (!supabaseClient || isDemo) {
        loadLocalTransactions();
        if (loading) loading.classList.add('hidden');
        return;
    }

    try {
        const { data, error } = await supabaseClient
            .from('transactions')
            .select('*')
            .order('date', { ascending: false });
        if (error) throw error;
        transactions = data || [];
        cacheTransactions();
        updateDashboardMetrics();
    } catch (err) {
        console.error("Supabase load error:", err);
        showToast("Koneksi gagal, menggunakan data cache.", "warning");
        loadLocalTransactions();
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function loadLocalTransactions() {
    const cached = localStorage.getItem(`sk_tx_${currentUser?.email}`);
    if (cached) {
        try { transactions = JSON.parse(cached); } catch (e) { transactions = defaultDemoData(); }
    } else {
        transactions = defaultDemoData();
        cacheTransactions();
    }
    updateDashboardMetrics();
}

function cacheTransactions() {
    if (!currentUser?.email) return;
    localStorage.setItem(`sk_tx_${currentUser.email}`, JSON.stringify(transactions));
}

function defaultDemoData() {
    const uid = currentUser?.id || 'demo';
    return [
        { id: 'd1', date: offsetDate(0), user_id: uid, amount: 350000, category: 'Makanan & Minuman', type: 'income', description: 'Jual nasi bungkus pagi' },
        { id: 'd2', date: offsetDate(-1), user_id: uid, amount: 125000, category: 'Belanja', type: 'expense', description: 'Beli bahan baku dapur' },
        { id: 'd3', date: offsetDate(-2), user_id: uid, amount: 5500000, category: 'Gaji / Pemasukan', type: 'income', description: 'Pendapatan bersih mingguan' },
        { id: 'd4', date: offsetDate(-3), user_id: uid, amount: 200000, category: 'Tagihan & Utilitas', type: 'expense', description: 'Token listrik warung' },
        { id: 'd5', date: offsetDate(-4), user_id: uid, amount: 85000, category: 'Transportasi', type: 'expense', description: 'Ongkos kirim order online' },
        { id: 'd6', date: offsetDate(-5), user_id: uid, amount: 450000, category: 'Makanan & Minuman', type: 'income', description: 'Jual kue pesanan arisan' },
        { id: 'd7', date: offsetDate(-6), user_id: uid, amount: 300000, category: 'Investasi', type: 'income', description: 'Dividen reksa dana' },
        { id: 'd8', date: offsetDate(-7), user_id: uid, amount: 50000, category: 'Hiburan & Rekreasi', type: 'expense', description: 'Nonton film akhir pekan' },
    ];
}

function updateDashboardMetrics() {
    let totalIncome = 0, totalExpense = 0;
    const now = new Date();
    const cy = now.getFullYear(), cm = now.getMonth();

    transactions.forEach(t => {
        const d = new Date(t.date);
        if (t.type === 'income') totalIncome += parseFloat(t.amount) || 0;
        else totalExpense += parseFloat(t.amount) || 0;
    });

    const balance = totalIncome - totalExpense;
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

    setInnerText('stat-total-balance', formatRupiah(balance));
    setInnerText('stat-total-income', formatRupiah(totalIncome));
    setInnerText('stat-total-expense', formatRupiah(totalExpense));
    setInnerText('stat-income-desc', `Total pemasukan bulan ini`);
    setInnerText('stat-expense-desc', `Total pengeluaran bulan ini`);

    renderTransactionsList();
    renderCharts();
}

function renderTransactionsList(searchQuery = '') {
    const listEl = document.getElementById('tx-list');
    const emptyEl = document.getElementById('tx-empty-state');
    const containerEl = document.getElementById('tx-list-container');
    if (!listEl) return;
    listEl.innerHTML = '';

    let filtered = transactions;
    if (currentTxFilter !== 'all') {
        filtered = filtered.filter(t => t.type === currentTxFilter);
    }
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(t =>
            (t.description || '').toLowerCase().includes(q) ||
            (t.category || '').toLowerCase().includes(q)
        );
    }

    if (filtered.length === 0) {
        containerEl?.classList.add('hidden');
        emptyEl?.classList.remove('hidden');
        return;
    }
    emptyEl?.classList.add('hidden');
    containerEl?.classList.remove('hidden');

    filtered.forEach(t => {
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between py-3 px-1 group hover:bg-slate-800/30 rounded-xl transition-all duration-150';

        const icon = getCategoryIcon(t.category);
        const catClass = getCategoryClass(t.category);
        const isIncome = t.type === 'income';
        const sign = isIncome ? '+' : '-';
        const amountColor = isIncome ? 'text-emerald-400' : 'text-rose-400';

        item.innerHTML = `
            <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm ${catClass}">
                    ${icon}
                </div>
                <div class="min-w-0">
                    <p class="text-xs font-semibold text-slate-200 truncate">${t.description || 'Tanpa keterangan'}</p>
                    <p class="text-[10px] text-slate-500 mt-0.5">${t.category} · ${formatDateShort(t.date)}</p>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0 ml-2">
                <span class="text-xs font-black ${amountColor}">${sign} ${formatRupiah(t.amount)}</span>
                <button onclick="handleDeleteTransaction('${t.id}')"
                    class="opacity-0 group-hover:opacity-100 focus:opacity-100 w-7 h-7 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 flex items-center justify-center transition-all min-h-0">
                    <i class="fa-solid fa-trash-can text-[9px]"></i>
                </button>
            </div>
        `;
        listEl.appendChild(item);
    });
}

async function handleDeleteTransaction(id) {
    if (!confirm("Hapus transaksi ini?")) return;

    const isDemo = localStorage.getItem('sk_demo') === 'true';
    const original = [...transactions];
    transactions = transactions.filter(t => t.id !== id);
    updateDashboardMetrics();
    cacheTransactions();

    if (!supabaseClient || isDemo) {
        showToast("Transaksi dihapus secara lokal.", "success");
        return;
    }

    try {
        const { error } = await supabaseClient.from('transactions').delete().eq('id', id);
        if (error) throw error;
        showToast("Transaksi dihapus dari database.", "success");
    } catch (err) {
        transactions = original;
        updateDashboardMetrics();
        showToast("Gagal menghapus: " + err.message, "error");
    }
}

function setTxFilter(filter) {
    currentTxFilter = filter;
    const allBtn = document.getElementById('filter-tx-all');
    const incBtn = document.getElementById('filter-tx-income');
    const expBtn = document.getElementById('filter-tx-expense');

    const active = 'px-3 py-1.5 text-[10px] font-bold rounded-lg bg-violet-600 text-white btn-press min-h-0';
    const inactive = 'px-3 py-1.5 text-[10px] font-bold rounded-lg text-slate-400 btn-press min-h-0';

    if (allBtn) allBtn.className = filter === 'all' ? active : inactive;
    if (incBtn) incBtn.className = filter === 'income' ? active : inactive;
    if (expBtn) expBtn.className = filter === 'expense' ? active : inactive;

    const listEl = document.getElementById('tx-list');
    if (listEl) {
        listEl.style.opacity = '0';
        listEl.style.transition = 'opacity 0.15s';
        setTimeout(() => {
            renderTransactionsList(document.getElementById('search-tx')?.value || '');
            listEl.style.opacity = '1';
        }, 120);
    }
}

function switchMobileTab(tab) {
    if (window.innerWidth >= 768) return;
    currentMobileTab = tab;

    const dashSec = document.getElementById('section-dashboard');
    const txSec = document.getElementById('section-transactions');
    const btnDash = document.getElementById('btn-nav-dashboard');
    const btnTx = document.getElementById('btn-nav-transactions');

    const activeNav = 'flex flex-col items-center gap-0.5 flex-1 py-2 text-violet-400 min-h-0';
    const inactiveNav = 'flex flex-col items-center gap-0.5 flex-1 py-2 text-slate-500 min-h-0';

    if (tab === 'dashboard') {
        dashSec?.classList.remove('hidden');
        txSec?.classList.add('hidden');
        if (btnDash) btnDash.className = activeNav;
        if (btnTx) btnTx.className = inactiveNav;
    } else {
        txSec?.classList.remove('hidden');
        dashSec?.classList.add('hidden');
        if (btnTx) btnTx.className = activeNav;
        if (btnDash) btnDash.className = inactiveNav;
    }
}

// =============================================
// CHARTS
// =============================================
function renderCharts() {
    const ctxCashflow = document.getElementById('cashflowChart')?.getContext('2d');
    const ctxCategory = document.getElementById('categoryChart')?.getContext('2d');
    if (!ctxCashflow || !ctxCategory) return;

    if (cashflowChartInstance) cashflowChartInstance.destroy();
    if (categoryChartInstance) categoryChartInstance.destroy();

    const filterDays = parseInt(document.getElementById('chart-filter')?.value) || 30;
    const labels = [], incomeData = [], expenseData = [];

    for (let i = filterDays - 1; i >= 0; i--) {
        labels.push(offsetDate(-i));
        incomeData.push(0);
        expenseData.push(0);
    }

    transactions.forEach(t => {
        const idx = labels.indexOf(t.date);
        if (idx !== -1) {
            if (t.type === 'income') incomeData[idx] += parseFloat(t.amount) || 0;
            else expenseData[idx] += parseFloat(t.amount) || 0;
        }
    });

    const fmtLabels = labels.map(l => {
        const d = new Date(l);
        return `${d.getDate()} ${['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'][d.getMonth()]}`;
    });

    const chartDefaults = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'bottom', labels: { color: '#64748b', font: { size: 10 }, padding: 12 } },
            tooltip: {
                callbacks: { label: ctx => `${ctx.dataset.label}: ${formatRupiah(ctx.raw)}` }
            }
        }
    };

    cashflowChartInstance = new Chart(ctxCashflow, {
        type: 'line',
        data: {
            labels: fmtLabels,
            datasets: [
                {
                    label: 'Pemasukan', data: incomeData,
                    borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.07)',
                    borderWidth: 2, tension: 0.4, fill: true, pointRadius: filterDays > 30 ? 0 : 2, pointBackgroundColor: '#10b981'
                },
                {
                    label: 'Pengeluaran', data: expenseData,
                    borderColor: '#f43f5e', backgroundColor: 'rgba(244,63,94,0.07)',
                    borderWidth: 2, tension: 0.4, fill: true, pointRadius: filterDays > 30 ? 0 : 2, pointBackgroundColor: '#f43f5e'
                }
            ]
        },
        options: {
            ...chartDefaults,
            scales: {
                x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 9 }, maxTicksLimit: 8 } },
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: { color: '#475569', font: { size: 9 }, callback: v => v >= 1000000 ? (v / 1000000).toFixed(1) + 'M' : v >= 1000 ? (v / 1000) + 'K' : v }
                }
            }
        }
    });

    const catTotals = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
        catTotals[t.category] = (catTotals[t.category] || 0) + (parseFloat(t.amount) || 0);
    });

    const catLabels = Object.keys(catTotals);
    const catData = Object.values(catTotals);
    const chartColors = ['#f43f5e', '#8b5cf6', '#10b981', '#f59e0b', '#38bdf8', '#f472b6', '#94a3b8', '#818cf8'];

    if (catLabels.length === 0) { catLabels.push('Belum ada'); catData.push(1); chartColors[0] = '#1e293b'; }

    categoryChartInstance = new Chart(ctxCategory, {
        type: 'doughnut',
        data: {
            labels: catLabels,
            datasets: [{ data: catData, backgroundColor: chartColors, borderWidth: 0, hoverOffset: 4 }]
        },
        options: {
            ...chartDefaults,
            cutout: '72%',
            plugins: {
                ...chartDefaults.plugins,
                tooltip: {
                    enabled: catLabels[0] !== 'Belum ada',
                    callbacks: {
                        label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            return ` ${formatRupiah(ctx.raw)} (${((ctx.raw / total) * 100).toFixed(1)}%)`;
                        }
                    }
                }
            }
        }
    });
}

// =============================================
// INPUT MODAL
// =============================================
function openInputModal(trigger = 'manual') {
    const modal = document.getElementById('modal-input');
    const container = document.getElementById('modal-input-container');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    resetInputForm();

    // On desktop, remove transform so modal shows as centered dialog immediately
    const isDesktop = window.innerWidth >= 768;
    if (isDesktop) {
        container?.classList.remove('bottom-sheet');
        container?.classList.add('open');
    } else {
        requestAnimationFrame(() => {
            setTimeout(() => container?.classList.add('open'), 20);
        });
    }

    if (trigger === 'voice') {
        setTimeout(() => startVoiceRecording(), 400);
    }
}

function closeInputModal() {
    const modal = document.getElementById('modal-input');
    const container = document.getElementById('modal-input-container');
    container?.classList.remove('open');
    container?.classList.add('bottom-sheet'); // restore for next mobile open
    stopSpeechListening();

    const delay = window.innerWidth >= 768 ? 0 : 300;
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }, delay);
}

function resetInputForm() {
    calcExpression = '';
    const amtEl = document.getElementById('input-amount');
    if (amtEl) amtEl.value = '0';
    const descEl = document.getElementById('input-description');
    if (descEl) descEl.value = '';
    setInputType('expense');
    document.getElementById('calculator-keypad')?.classList.remove('hidden');
    clearOCRPreview();
    document.getElementById('ai-processing-box')?.classList.add('hidden');
}

function setInputType(type) {
    activeInputType = type;
    const expBtn = document.getElementById('tab-type-expense');
    const incBtn = document.getElementById('tab-type-income');

    if (type === 'expense') {
        if (expBtn) expBtn.className = 'flex-1 py-2.5 text-xs font-bold rounded-xl bg-rose-600 text-white btn-press';
        if (incBtn) incBtn.className = 'flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-400 btn-press';
        const cat = document.getElementById('input-category');
        if (cat && !['income', 'Gaji / Pemasukan', 'Investasi'].includes(cat.value)) cat.value = 'Lainnya';
    } else {
        if (incBtn) incBtn.className = 'flex-1 py-2.5 text-xs font-bold rounded-xl bg-emerald-600 text-white btn-press';
        if (expBtn) expBtn.className = 'flex-1 py-2.5 text-xs font-bold rounded-xl text-slate-400 btn-press';
        const cat = document.getElementById('input-category');
        if (cat) cat.value = 'Gaji / Pemasukan';
    }
}

function toggleCalcPad() {
    document.getElementById('calculator-keypad')?.classList.toggle('hidden');
}

function pressCalc(val) {
    const field = document.getElementById('input-amount');
    if (!field) return;

    if (val === 'C') {
        calcExpression = '';
        field.value = '0';
    } else if (val === 'DEL') {
        calcExpression = calcExpression.toString().slice(0, -1);
        field.value = formatDisplayNumber(calcExpression) || '0';
    } else if (val === '=') {
        if (!calcExpression) return;
        const result = evaluateExpression(calcExpression);
        field.value = formatDisplayNumber(result.toString());
        calcExpression = result.toString();
    } else {
        if (calcExpression === '' && !isNaN(val) && val !== '.') {
            calcExpression = val;
        } else {
            calcExpression += val;
        }
        field.value = formatDisplayNumber(calcExpression);
    }
}

function evaluateExpression(str) {
    str = str.replace(/\./g, '').replace(/×/g, '*').replace(/÷/g, '/');
    const sanitized = str.replace(/[^0-9+\-*/().]/g, '');
    try {
        const result = new Function(`return ${sanitized}`)();
        if (isNaN(result) || !isFinite(result)) return 0;
        return Math.max(0, Math.round(result));
    } catch { return 0; }
}

async function submitTransaction() {
    const rawAmt = document.getElementById('input-amount')?.value.replace(/\./g, '') || '0';
    const amount = parseInt(rawAmt) || 0;
    const category = document.getElementById('input-category')?.value || 'Lainnya';
    const date = document.getElementById('input-date')?.value || todayString();
    const description = document.getElementById('input-description')?.value.trim() || 'Tanpa keterangan';
    const type = activeInputType;

    if (amount <= 0) { showToast("Nominal harus lebih dari Rp 0", "warning"); return; }

    const isDemo = localStorage.getItem('sk_demo') === 'true';
    const tempId = 'local_' + Date.now();
    const newTx = { id: tempId, user_id: currentUser.id, amount, category, date, description, type };

    transactions.unshift(newTx);
    updateDashboardMetrics();
    cacheTransactions();
    closeInputModal();
    showToast("Transaksi tersimpan! 🎉", "success");

    if (!supabaseClient || isDemo) return;

    try {
        const { data, error } = await supabaseClient
            .from('transactions')
            .insert([{ user_id: currentUser.id, amount, category, date, description, type }])
            .select();
        if (error) throw error;
        if (data?.[0]) {
            const idx = transactions.findIndex(t => t.id === tempId);
            if (idx !== -1) { transactions[idx].id = data[0].id; cacheTransactions(); }
            showToast("Tersinkronisasi ke Supabase ✓", "success");
        }
    } catch (err) {
        console.error("Supabase insert error:", err);
        showToast("Tersimpan lokal, sinkronisasi tertunda.", "warning");
    }
}

// =============================================
// VOICE INPUT (Web Speech API + Gemini Parser)
// =============================================
function startVoiceRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast("Browser tidak mendukung Speech API. Gunakan Chrome atau Edge.", "error");
        return;
    }

    if (speechRecognitionInstance) {
        stopSpeechListening();
        return;
    }

    speechRecognitionInstance = new SpeechRecognition();
    speechRecognitionInstance.lang = 'id-ID';
    speechRecognitionInstance.interimResults = false;
    speechRecognitionInstance.maxAlternatives = 1;

    const micBtn = document.getElementById('btn-voice-input');
    const processBox = document.getElementById('ai-processing-box');
    const processStatus = document.getElementById('ai-processing-status');
    const processIcon = document.getElementById('ai-processing-icon');
    const transcriptPreview = document.getElementById('ai-transcript-preview');

    if (micBtn) micBtn.classList.add('recording-active');
    if (processBox) processBox.classList.remove('hidden');
    if (processStatus) processStatus.textContent = 'Mendengarkan suara Anda...';
    if (processIcon) processIcon.className = 'fa-solid fa-microphone text-violet-400 fa-bounce text-xs';
    if (transcriptPreview) transcriptPreview.textContent = 'Coba ucapkan: "Jual nasi bungkus 35 ribu" atau "Beli token listrik 50 ribu"';

    speechRecognitionInstance.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        if (transcriptPreview) transcriptPreview.textContent = `🎙️ "${transcript}"`;
        if (processStatus) processStatus.textContent = 'AI sedang mengekstrak data...';
        if (processIcon) processIcon.className = 'fa-solid fa-circle-notch fa-spin text-violet-400 text-xs';

        const result = await parseTransactionWithGemini(transcript);
        if (result) {
            applyParsedData(result);
            showToast("AI berhasil mengisi form dari suara Anda! 🤖", "success");
        } else {
            showToast("AI gagal mendeteksi transaksi. Coba ucapkan lebih jelas.", "warning");
        }
        stopSpeechListening();
    };

    speechRecognitionInstance.onerror = (event) => {
        console.error("Speech recognition error:", event.error);
        if (event.error === 'not-allowed') {
            showToast("Izin mikrofon ditolak. Aktifkan izin di browser.", "error");
        } else if (event.error !== 'no-speech') {
            showToast("Mikrofon error: " + event.error, "error");
        }
        stopSpeechListening();
    };

    speechRecognitionInstance.onend = () => { stopSpeechListening(); };
    speechRecognitionInstance.start();
}

function stopSpeechListening() {
    const micBtn = document.getElementById('btn-voice-input');
    const processBox = document.getElementById('ai-processing-box');
    if (micBtn) micBtn.classList.remove('recording-active');
    if (speechRecognitionInstance) {
        try { speechRecognitionInstance.stop(); } catch (e) {}
        speechRecognitionInstance = null;
    }

    setTimeout(() => {
        if (processBox) processBox.classList.add('hidden');
    }, 1500);
}

// =============================================
// GEMINI API
// =============================================
async function queryGemini(promptText, base64ImageData = null, mimeType = null) {
    const geminiKey = localStorage.getItem('sk_gemini_key') || DEFAULT_GEMINI_API_KEY;
    if (!geminiKey) {
        showToast("Gemini API Key belum diisi! Buka Pengaturan API & Kredensial di dashboard.", "warning");
        toggleApiSettings();
        return null;
    }

    // Model priority list - fallback otomatis jika satu gagal
    const modelCandidates = [
        'gemini-2.0-flash',
        'gemini-2.0-flash-lite',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro-latest',
    ];

    const parts = [{ text: promptText }];
    if (base64ImageData && mimeType) {
        parts.push({ inlineData: { mimeType, data: base64ImageData } });
    }

    for (const model of modelCandidates) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
        try {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts }] })
            });
            const json = await resp.json();
            if (json.error) {
                // Model not found or not supported — try next one
                const errCode = json.error.code || 0;
                const errMsg = json.error.message || '';
                if (errCode === 404 || errMsg.includes('not found') || errMsg.includes('not supported')) {
                    console.warn(`Model ${model} tidak tersedia, mencoba model berikutnya...`);
                    continue;
                }
                // Auth or quota error — no point retrying other models
                if (errCode === 400 || errCode === 401 || errCode === 403 || errCode === 429) {
                    const friendlyMsg = errCode === 429
                        ? 'Batas kuota Gemini API tercapai. Coba lagi sebentar.'
                        : errCode === 403
                        ? 'Gemini API Key tidak valid. Cek kembali di Pengaturan.'
                        : `Gemini error (${errCode}): Periksa kembali API Key Anda.`;
                    showToast(friendlyMsg, 'error');
                    return null;
                }
                console.error(`Gemini error (model=${model}):`, json.error);
                continue;
            }
            const result = json.candidates?.[0]?.content?.parts?.[0]?.text;
            if (result) return result;
            continue;
        } catch (err) {
            console.error(`Fetch error (model=${model}):`, err.message);
            continue;
        }
    }

    showToast('Semua model Gemini tidak tersedia saat ini. Coba beberapa saat lagi.', 'error');
    return null;
}

async function parseTransactionWithGemini(transcript) {
    const prompt = `Analisis kalimat transaksi keuangan UMKM berikut dalam Bahasa Indonesia: "${transcript}".
Ekstrak data menjadi format JSON mentah tanpa blok format kode markdown (tanpa \`\`\`json).
Skema JSON yang harus dikembalikan PERSIS seperti ini:
{
  "amount": <number tanpa titik/koma pemisah ribuan>,
  "category": "<kategori>",
  "type": "income" atau "expense",
  "description": "<keterangan singkat dalam Bahasa Indonesia>"
}
Kategori HANYA boleh bernilai salah satu dari:
"Makanan & Minuman", "Transportasi", "Belanja", "Tagihan & Utilitas", "Hiburan & Rekreasi", "Gaji / Pemasukan", "Investasi", "Lainnya".
Jika kalimat menunjukkan penjualan/pendapatan, set type ke "income". Jika pembelian/pengeluaran, set type ke "expense".
Contoh: "Jual nasi bungkus 35 ribu" → {"amount":35000,"category":"Makanan & Minuman","type":"income","description":"Jual nasi bungkus"}`;

    const raw = await queryGemini(prompt);
    if (!raw) return null;

    try {
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("Failed to parse Gemini response:", raw);
        return null;
    }
}

function applyParsedData(data) {
    if (data.amount) {
        const amtEl = document.getElementById('input-amount');
        if (amtEl) {
            amtEl.value = formatDisplayNumber(data.amount.toString());
            calcExpression = data.amount.toString();
        }
    }
    if (data.category) {
        const catEl = document.getElementById('input-category');
        if (catEl) catEl.value = data.category;
    }
    if (data.type) setInputType(data.type);
    if (data.description) {
        const descEl = document.getElementById('input-description');
        if (descEl) descEl.value = data.description;
    }
}

// =============================================
// OCR RECEIPT SCANNER
// =============================================
async function handleReceiptOCR(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("Pilih file gambar kuitansi.", "warning");
        return;
    }

    const previewBox = document.getElementById('ocr-preview-box');
    const imgThumb = document.getElementById('ocr-img-thumbnail');
    const fileName = document.getElementById('ocr-file-name');
    const fileSize = document.getElementById('ocr-file-size');
    const progressBar = document.getElementById('ocr-progress-bar');
    const processBox = document.getElementById('ai-processing-box');
    const processStatus = document.getElementById('ai-processing-status');
    const processIcon = document.getElementById('ai-processing-icon');

    if (previewBox) previewBox.classList.remove('hidden');
    if (fileName) fileName.textContent = file.name;
    if (fileSize) fileSize.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    if (progressBar) progressBar.style.width = '15%';
    if (processBox) processBox.classList.remove('hidden');
    if (processStatus) processStatus.textContent = 'Membaca foto kuitansi...';
    if (processIcon) processIcon.className = 'fa-solid fa-circle-notch fa-spin text-violet-400 text-xs';

    const reader = new FileReader();
    reader.onload = async function () {
        if (imgThumb) imgThumb.src = reader.result;
        if (progressBar) progressBar.style.width = '40%';

        const base64Data = reader.result.split(',')[1];
        const mimeType = reader.result.split(';')[0].split(':')[1];

        if (progressBar) progressBar.style.width = '65%';

        const prompt = `Analisis foto struk belanja/kuitansi/nota ini. Ekstrak data total nominal akhir pengeluaran setelah diskon jika ada.
Ekstrak data menjadi format JSON mentah tanpa blok format kode markdown (tanpa \`\`\`json).
Skema JSON yang harus dikembalikan PERSIS seperti ini:
{
  "amount": <number tanpa titik/koma>,
  "category": "<kategori>",
  "description": "<nama toko atau keterangan singkat>"
}
Kategori HANYA boleh bernilai salah satu dari:
"Makanan & Minuman", "Transportasi", "Belanja", "Tagihan & Utilitas", "Hiburan & Rekreasi", "Lainnya".`;

        const raw = await queryGemini(prompt, base64Data, mimeType);
        if (progressBar) progressBar.style.width = '100%';

        if (raw) {
            try {
                const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
                const data = JSON.parse(cleaned);
                applyParsedData({ ...data, type: 'expense' });
                showToast("OCR berhasil! Data kuitansi terisi otomatis. 📄", "success");
            } catch (e) {
                showToast("Gagal membaca kuitansi. Isi nominal secara manual.", "warning");
            }
        } else {
            showToast("Gagal membaca kuitansi. Coba foto yang lebih jelas.", "warning");
        }

        if (processBox) setTimeout(() => processBox.classList.add('hidden'), 1500);
    };
    reader.readAsDataURL(file);
}

function clearOCRPreview() {
    document.getElementById('ocr-preview-box')?.classList.add('hidden');
    const upload = document.getElementById('ocr-image-upload');
    if (upload) upload.value = '';
    const thumb = document.getElementById('ocr-img-thumbnail');
    if (thumb) thumb.src = '';
    const bar = document.getElementById('ocr-progress-bar');
    if (bar) bar.style.width = '0%';
}

// =============================================
// AI BUSINESS ANALYSIS
// =============================================
function openAiAnalysisModal() {
    const modal = document.getElementById('modal-ai-analysis');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    // Reset to prompt state
    document.getElementById('ai-analysis-loading')?.classList.add('hidden');
    document.getElementById('ai-analysis-results')?.classList.add('hidden');
    document.getElementById('ai-analysis-prompt')?.classList.remove('hidden');
}

function closeAiAnalysisModal() {
    document.getElementById('modal-ai-analysis')?.classList.add('hidden');
    document.getElementById('modal-ai-analysis')?.classList.remove('flex');
}

async function runAiAnalysis() {
    const promptEl = document.getElementById('ai-analysis-prompt');
    const loadingEl = document.getElementById('ai-analysis-loading');
    const resultsEl = document.getElementById('ai-analysis-results');
    const insightsContainer = document.getElementById('ai-insights-container');

    promptEl?.classList.add('hidden');
    loadingEl?.classList.remove('hidden');
    resultsEl?.classList.add('hidden');

    const last10 = transactions.slice(0, 10);
    if (last10.length === 0) {
        loadingEl?.classList.add('hidden');
        promptEl?.classList.remove('hidden');
        showToast("Belum ada data transaksi untuk dianalisis.", "warning");
        return;
    }

    const txSummary = last10.map(t =>
        `- ${t.date}: ${t.type === 'income' ? 'PEMASUKAN' : 'PENGELUARAN'} Rp ${t.amount.toLocaleString('id-ID')} kategori "${t.category}" (${t.description})`
    ).join('\n');

    const prompt = `Anda adalah konsultan keuangan ahli untuk UMKM Indonesia.
Berikut adalah 10 transaksi terakhir usaha:

${txSummary}

Berikan TEPAT 3 insight keuangan yang tajam, praktis, dan spesifik berdasarkan data di atas.
Format respons HARUS berupa JSON array, tanpa blok format kode markdown:
[
  {"type": "warning"|"success"|"tip", "title": "<judul singkat>", "body": "<penjelasan 1-2 kalimat>"},
  {"type": "warning"|"success"|"tip", "title": "<judul singkat>", "body": "<penjelasan 1-2 kalimat>"},
  {"type": "warning"|"success"|"tip", "title": "<judul singkat>", "body": "<penjelasan 1-2 kalimat>"}
]
Gunakan Bahasa Indonesia yang mudah dipahami pemilik UMKM.`;

    const raw = await queryGemini(prompt);
    loadingEl?.classList.add('hidden');

    if (!raw) {
        promptEl?.classList.remove('hidden');
        return;
    }

    try {
        const cleaned = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        const insights = JSON.parse(cleaned);

        if (insightsContainer) {
            insightsContainer.innerHTML = '';
            insights.forEach(insight => {
                const div = document.createElement('div');
                const styles = {
                    warning: { bg: 'bg-amber-500/10 border-amber-500/20', icon: 'fa-triangle-exclamation text-amber-400', title: 'text-amber-300' },
                    success: { bg: 'bg-emerald-500/10 border-emerald-500/20', icon: 'fa-circle-check text-emerald-400', title: 'text-emerald-300' },
                    tip: { bg: 'bg-violet-500/10 border-violet-500/20', icon: 'fa-lightbulb text-violet-400', title: 'text-violet-300' }
                };
                const s = styles[insight.type] || styles.tip;
                div.className = `p-4 ${s.bg} border rounded-2xl`;
                div.innerHTML = `
                    <div class="flex items-start gap-3">
                        <i class="fa-solid ${s.icon} mt-0.5 flex-shrink-0"></i>
                        <div>
                            <p class="text-xs font-bold ${s.title} mb-1">${insight.title}</p>
                            <p class="text-[11px] text-slate-300 leading-relaxed">${insight.body}</p>
                        </div>
                    </div>`;
                insightsContainer.appendChild(div);
            });
        }

        resultsEl?.classList.remove('hidden');
    } catch (e) {
        console.error("AI parse error:", e, raw);
        showToast("AI memberikan respons yang tidak valid. Coba lagi.", "warning");
        promptEl?.classList.remove('hidden');
    }
}

// =============================================
// QR SYNC (Token-Based Supabase Realtime)
// =============================================
function openQrModal() {
    const modal = document.getElementById('modal-qr-sync');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setQrMode('share');
}

function closeQrModal() {
    document.getElementById('modal-qr-sync')?.classList.add('hidden');
    document.getElementById('modal-qr-sync')?.classList.remove('flex');
    if (qrScannerInstance) {
        try { qrScannerInstance.clear(); } catch (e) {}
        qrScannerInstance = null;
    }
    const placeholder = document.getElementById('qr-scanner-placeholder');
    if (placeholder) placeholder.classList.remove('hidden');
    if (shareSyncChannel) { shareSyncChannel.unsubscribe(); shareSyncChannel = null; }
}

function setQrMode(mode) {
    currentQrMode = mode;
    const shareTab = document.getElementById('tab-qr-share');
    const scanTab = document.getElementById('tab-qr-scan');
    const shareSection = document.getElementById('qr-share-section');
    const scanSection = document.getElementById('qr-scan-section');

    const active = 'flex-1 py-2 text-xs font-semibold rounded-lg bg-violet-600 text-white btn-press min-h-0';
    const inactive = 'flex-1 py-2 text-xs font-semibold rounded-lg text-slate-400 btn-press min-h-0';

    if (mode === 'share') {
        shareTab.className = active; scanTab.className = inactive;
        shareSection?.classList.remove('hidden'); scanSection?.classList.add('hidden');
        generateSyncQrCode();
    } else {
        scanTab.className = active; shareTab.className = inactive;
        scanSection?.classList.remove('hidden'); shareSection?.classList.add('hidden');
    }
}

function generateSyncQrCode() {
    const container = document.getElementById('qrcode-container');
    if (!container || !currentUser) return;
    container.innerHTML = '';

    // Only a short token in the QR — keeps it simple and scannable
    const token = generateShortToken();

    new QRCode(container, {
        text: 'sync_share:' + token,
        width: 176,
        height: 176,
        colorDark: '#1e1b4b',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.M
    });

    // Listen for a device requesting this session
    if (shareSyncChannel) shareSyncChannel.unsubscribe();
    if (!supabaseClient) return;

    shareSyncChannel = supabaseClient.channel('sk-share-' + token);
    shareSyncChannel.on('broadcast', { event: 'request-session' }, async ({ payload }) => {
        // Push full session data to requesting device
        await shareSyncChannel.send({
            type: 'broadcast',
            event: 'session-data',
            payload: {
                user: currentUser,
                supabase_url: localStorage.getItem('sk_supabase_url') || '',
                supabase_key: localStorage.getItem('sk_supabase_key') || '',
                gemini_key: localStorage.getItem('sk_gemini_key') || ''
            }
        });
        showToast("Sesi berhasil dikirim ke perangkat baru!", "success");
        setTimeout(() => closeQrModal(), 1500);
    }).subscribe();
}

function startQrCamera() {
    const placeholder = document.getElementById('qr-scanner-placeholder');
    if (placeholder) placeholder.classList.add('hidden');

    if (qrScannerInstance) {
        try { qrScannerInstance.clear(); } catch (e) {}
    }

    qrScannerInstance = new Html5Qrcode('qr-reader');
    qrScannerInstance.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 200, height: 200 } },
        onQrScanSuccess,
        () => {}
    ).catch(err => {
        showToast("Akses kamera ditolak atau tidak tersedia.", "error");
        if (placeholder) placeholder.classList.remove('hidden');
    });
}

async function onQrScanSuccess(decodedText) {
    // Stop scanner first to avoid repeated triggers
    if (qrScannerInstance) { try { qrScannerInstance.stop(); } catch (e) {} }
    if (loginQrScannerInstance) { try { loginQrScannerInstance.stop(); } catch (e) {} }

    try {
        // === sync_login: HP (already logged in) scans login screen QR and pushes session ===
        if (decodedText.startsWith('sync_login:')) {
            const token = decodedText.split(':')[1];
            if (!supabaseClient) {
                showToast("Supabase belum terkonfigurasi di perangkat ini.", "error");
                return;
            }
            const ch = supabaseClient.channel('sk-login-' + token);
            ch.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await ch.send({
                        type: 'broadcast',
                        event: 'push-session',
                        payload: {
                            user: currentUser,
                            supabase_url: localStorage.getItem('sk_supabase_url') || '',
                            supabase_key: localStorage.getItem('sk_supabase_key') || '',
                            gemini_key: localStorage.getItem('sk_gemini_key') || ''
                        }
                    });
                    showToast("Sesi berhasil dikirim ke komputer!", "success");
                    closeQrModal();
                    setTimeout(() => ch.unsubscribe(), 2000);
                }
            });
            return;
        }

        // === sync_share: New device scans logged-in device's QR, requests session ===
        if (decodedText.startsWith('sync_share:')) {
            const token = decodedText.split(':')[1];
            initSupabaseIfNeeded();
            if (!supabaseClient) {
                showToast("Supabase belum terkonfigurasi.", "error");
                return;
            }

            showToast("QR terbaca! Meminta sesi dari perangkat lain...", "info");

            const ch = supabaseClient.channel('sk-share-' + token);
            ch.on('broadcast', { event: 'session-data' }, ({ payload }) => {
                if (payload) {
                    applyIncomingSession(payload);
                    ch.unsubscribe();
                }
            }).subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await ch.send({ type: 'broadcast', event: 'request-session', payload: { ts: Date.now() } });
                }
            });
            return;
        }

        // Legacy: base64 encoded JSON (backward compatibility)
        const jsonStr = decodeURIComponent(atob(decodedText));
        const payload = JSON.parse(jsonStr);
        if (payload.expires && Date.now() > payload.expires) {
            showToast("QR Code sudah kedaluwarsa. Muat ulang kode baru.", "error");
            return;
        }
        applyIncomingSession({
            user: { id: payload.id, email: payload.email, name: payload.name, picture: payload.picture },
            supabase_url: payload.supabase_url,
            supabase_key: payload.supabase_key,
            gemini_key: payload.gemini_key
        });
    } catch (err) {
        console.error("QR scan error:", err);
        showToast("QR tidak dikenali.", "error");
    }
}

function applyIncomingSession(payload) {
    currentUser = payload.user;
    localStorage.setItem('sk_user', JSON.stringify(currentUser));
    localStorage.setItem('sk_demo', 'false');
    if (payload.supabase_url) localStorage.setItem('sk_supabase_url', payload.supabase_url);
    if (payload.supabase_key) localStorage.setItem('sk_supabase_key', payload.supabase_key);
    if (payload.gemini_key) localStorage.setItem('sk_gemini_key', payload.gemini_key);

    if (payload.supabase_url && payload.supabase_key) {
        supabaseClient = window.supabase.createClient(payload.supabase_url, payload.supabase_key);
    }

    showToast("Masuk via QR berhasil! 🎉", "success");
    closeQrModal();
    stopLoginQrScanner();
    if (loginSyncChannel) { loginSyncChannel.unsubscribe(); loginSyncChannel = null; }
    showDashboard();
}

function initSupabaseIfNeeded() {
    if (supabaseClient) return;
    const url = localStorage.getItem('sk_supabase_url') || DEFAULT_SUPABASE_URL;
    const key = localStorage.getItem('sk_supabase_key') || DEFAULT_SUPABASE_ANON_KEY;
    if (url && key) {
        try { supabaseClient = window.supabase.createClient(url, key); } catch (e) {}
    }
}

// =============================================
// SETTINGS
// =============================================
function toggleApiSettings() {
    const panel = document.getElementById('api-settings-panel');
    const chevron = document.getElementById('api-settings-chevron');
    panel?.classList.toggle('hidden');
    chevron?.classList.toggle('rotate-180');
}

function saveApiSettings() {
    const url = document.getElementById('input-supabase-url')?.value.trim() || '';
    const key = document.getElementById('input-supabase-key')?.value.trim() || '';
    const gemini = document.getElementById('input-gemini-key')?.value.trim() || '';

    localStorage.setItem('sk_supabase_url', url);
    localStorage.setItem('sk_supabase_key', key);
    localStorage.setItem('sk_gemini_key', gemini);

    if (url && key) {
        try { supabaseClient = window.supabase.createClient(url, key); } catch (e) {}
    }

    showToast("Konfigurasi API berhasil disimpan! ✓", "success");
    toggleApiSettings();
    if (currentUser) loadData();
}

// =============================================
// THEME
// =============================================
function toggleTheme() {
    if (document.documentElement.classList.contains('dark')) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('sk_theme', 'light');
    } else {
        document.documentElement.classList.add('dark');
        localStorage.setItem('sk_theme', 'dark');
    }
}

// =============================================
// PASSWORD TOGGLE
// =============================================
function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        btn.innerHTML = '<i class="fa-solid fa-eye-slash text-xs"></i>';
    } else {
        input.type = 'password';
        btn.innerHTML = '<i class="fa-solid fa-eye text-xs"></i>';
    }
}

// =============================================
// UTILITY HELPERS
// =============================================
function formatRupiah(n) {
    return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(n);
}

function formatDisplayNumber(str) {
    if (!str) return '';
    // Format each number group in expression with dots
    return str.toString().replace(/\d+/g, match => match.replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
}

function todayString() {
    return new Date().toISOString().substring(0, 10);
}

function offsetDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().substring(0, 10);
}

function formatDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const months = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    return `${d.getDate()} ${months[d.getMonth()]}`;
}

function setInnerText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function generateShortToken() {
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
}

function setButtonLoading(btn, loading, defaultHTML) {
    if (!btn) return;
    if (loading) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>Mohon tunggu...';
    } else {
        btn.disabled = false;
        btn.innerHTML = defaultHTML;
    }
}

// Category icons & colors
function getCategoryIcon(cat) {
    const icons = {
        'Makanan & Minuman': '<i class="fa-solid fa-utensils"></i>',
        'Transportasi': '<i class="fa-solid fa-car-side"></i>',
        'Belanja': '<i class="fa-solid fa-bag-shopping"></i>',
        'Tagihan & Utilitas': '<i class="fa-solid fa-bolt"></i>',
        'Hiburan & Rekreasi': '<i class="fa-solid fa-gamepad"></i>',
        'Gaji / Pemasukan': '<i class="fa-solid fa-sack-dollar"></i>',
        'Investasi': '<i class="fa-solid fa-chart-line"></i>',
        'Lainnya': '<i class="fa-solid fa-tag"></i>',
    };
    return icons[cat] || icons['Lainnya'];
}

function getCategoryClass(cat) {
    const classes = {
        'Makanan & Minuman': 'cat-makanan',
        'Transportasi': 'cat-transportasi',
        'Belanja': 'cat-belanja',
        'Tagihan & Utilitas': 'cat-tagihan',
        'Hiburan & Rekreasi': 'cat-hiburan',
        'Gaji / Pemasukan': 'cat-gaji',
        'Investasi': 'cat-investasi',
        'Lainnya': 'cat-lainnya',
    };
    return classes[cat] || 'cat-lainnya';
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const configs = {
        success: { border: 'border-emerald-500/40', icon: 'fa-circle-check text-emerald-400', bg: 'bg-slate-900/95' },
        error:   { border: 'border-rose-500/40',    icon: 'fa-circle-xmark text-rose-400',    bg: 'bg-slate-900/95' },
        warning: { border: 'border-amber-500/40',   icon: 'fa-triangle-exclamation text-amber-400', bg: 'bg-slate-900/95' },
        info:    { border: 'border-violet-500/40',  icon: 'fa-circle-info text-violet-400',   bg: 'bg-slate-900/95' },
    };
    const cfg = configs[type] || configs.info;

    toast.className = `toast-enter flex items-start gap-3 p-3.5 ${cfg.bg} border ${cfg.border} rounded-2xl shadow-card pointer-events-auto max-w-xs backdrop-blur-md`;
    toast.innerHTML = `
        <i class="fa-solid ${cfg.icon} text-sm mt-0.5 flex-shrink-0"></i>
        <span class="text-xs font-semibold text-slate-200 leading-relaxed">${message}</span>
    `;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('toast-enter');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, 3800);
}
