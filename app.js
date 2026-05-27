/**
 * Aura Finance - Logic and Integration Script (Supabase Migration)
 * 
 * PETUNJUK PEMASANGAN & PENGATURAN API (INDONESIAN INSTRUCTIONS):
 * 1. Di bagian bawah baris komentar ini, isi nilai variabel:
 *    - `DEFAULT_SUPABASE_URL`: Dapatkan dari Supabase Console -> Project Settings -> API -> Project URL.
 *    - `DEFAULT_SUPABASE_ANON_KEY`: Dapatkan dari Supabase Console -> Project Settings -> API -> anon public key.
 *    - `DEFAULT_GEMINI_API_KEY`: Dapatkan dari Google AI Studio (https://aistudio.google.com/).
 * 
 * CATATAN KEAMANAN GITHUB & VERCEL:
 * - Jangan membagikan API Key Anda di repositori Git publik.
 * - Cara paling aman adalah mengosongkan variabel default di bawah dan memasukkan kredensialnya 
 *   secara langsung lewat menu "Pengaturan API & Kredensial" di dashboard Web UI Aura Finance.
 *   Nilai tersebut akan tersimpan aman di browser LocalStorage Anda secara mandiri.
 */

const DEFAULT_SUPABASE_URL = "https://wdilryxahcylzosahdof.supabase.co"; // Masukkan Supabase Project URL Anda
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_wK3CwI-qTtJoY8ilQOw2xg_RL89GQcK"; // Masukkan Supabase Anon Key Anda
const DEFAULT_GEMINI_API_KEY = ""; // Masukkan API Key Gemini default Anda

// Instans Supabase Client (Diubah ke supabaseClient untuk menghindari tabrakan nama dengan library global window.supabase)
let supabaseClient = null;

// State Manajemen Aplikasi
let currentUser = null;
let transactions = [];
let activeInputType = 'expense'; // 'expense' atau 'income'
let calcExpression = '';
let currentTxFilter = 'all'; // 'all' | 'income' | 'expense'
let currentMobileTab = 'dashboard'; // 'dashboard' | 'transactions'
let currentQrMode = 'share'; // 'share' atau 'scan'
let qrScannerInstance = null;

// Instans Chart.js untuk dihancurkan sebelum digambar ulang
let cashflowChartInstance = null;
let categoryChartInstance = null;

// Inisialisasi Aplikasi Saat Window Dimuat
window.onload = function() {
    initApp();
};

function initApp() {
    // Muat kredensial dari LocalStorage atau fallback default
    const savedSupaUrl = localStorage.getItem('supabase_url') || DEFAULT_SUPABASE_URL;
    const savedSupaKey = localStorage.getItem('supabase_anon_key') || DEFAULT_SUPABASE_ANON_KEY;
    const savedGeminiKey = localStorage.getItem('gemini_api_key') || DEFAULT_GEMINI_API_KEY;
    
    document.getElementById('input-supabase-url').value = savedSupaUrl;
    document.getElementById('input-supabase-key').value = savedSupaKey;
    document.getElementById('input-gemini-key').value = savedGeminiKey;

    // Inisialisasi Supabase Client jika kredensial terisi
    if (savedSupaUrl && savedSupaKey) {
        try {
            // Menggunakan objek global window.supabase dari CDN
            supabaseClient = window.supabase.createClient(savedSupaUrl, savedSupaKey);
        } catch (err) {
            console.error("Gagal memuat client Supabase:", err);
        }
    }

    // Dengarkan status Auth dari Supabase
    if (supabaseClient) {
        supabaseClient.auth.onAuthStateChange((event, session) => {
            const isDemo = localStorage.getItem('is_demo_mode') === 'true';
            
            if (session && session.user && !isDemo) {
                currentUser = {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.user_metadata.full_name || session.user.email,
                    picture: session.user.user_metadata.avatar_url || 'https://via.placeholder.com/150'
                };
                localStorage.setItem('user_session', JSON.stringify(currentUser));
                showDashboard();
            } else if (!session && !isDemo) {
                // Sesi habis / logout
                currentUser = null;
                localStorage.removeItem('user_session');
                document.getElementById('login-screen').classList.remove('hidden');
                document.getElementById('dashboard-screen').classList.add('hidden');
            }
        });
    }

    // Periksa status login sesi sebelumnya
    const savedUser = localStorage.getItem('user_session');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        showDashboard();
    } else {
        // Tampilkan layar login jika tidak ada sesi tersimpan
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('dashboard-screen').classList.add('hidden');
    }

    // Hubungkan Event Listener komponen UI
    setupEventListeners();
}

// Menghubungkan kontrol tombol dengan fungsinya
function setupEventListeners() {
    // Form Auth Toggles
    document.getElementById('link-show-register').addEventListener('click', function(e) {
        e.preventDefault();
        showAuthForm('register');
    });
    document.getElementById('link-show-login').addEventListener('click', function(e) {
        e.preventDefault();
        showAuthForm('login');
    });

    // Form Submits
    document.getElementById('form-login').addEventListener('submit', loginWithEmail);
    document.getElementById('form-register').addEventListener('submit', registerWithEmail);

    // Mode Google Sign-in Supabase Auth
    document.getElementById('btn-google-login').addEventListener('click', loginWithGoogle);

    // Mode Demo
    document.getElementById('btn-demo-mode').addEventListener('click', loginAsDemo);

    // Logout (Desktop & Mobile)
    document.getElementById('btn-logout').addEventListener('click', logout);
    const mobLogout = document.getElementById('btn-mobile-logout');
    if (mobLogout) mobLogout.addEventListener('click', logout);

    // Simpan Pengaturan API
    document.getElementById('btn-save-settings').addEventListener('click', saveApiSettings);

    // Modal Input Transaksi
    const openBtn = document.getElementById('btn-open-input-modal');
    if (openBtn) openBtn.addEventListener('click', openInputModal);
    document.getElementById('btn-close-input-modal').addEventListener('click', closeInputModal);
    document.getElementById('btn-cancel-tx').addEventListener('click', closeInputModal);
    document.getElementById('btn-submit-tx').addEventListener('click', submitTransaction);

    // Tombol Toggle Kalkulator
    document.getElementById('btn-toggle-calc').addEventListener('click', function(e) {
        e.preventDefault();
        const calcPanel = document.getElementById('calculator-keypad');
        calcPanel.classList.toggle('hidden');
    });

    // Perekam Suara & OCR Struk
    document.getElementById('btn-voice-input').addEventListener('click', startVoiceRecording);
    document.getElementById('ocr-image-upload').addEventListener('change', handleReceiptOCR);
    document.getElementById('btn-remove-ocr-img').addEventListener('click', clearOCRPreview);

    // Modal Sync QR
    document.getElementById('btn-qr-sync').addEventListener('click', openQrModal);
    document.getElementById('btn-close-qr-modal').addEventListener('click', closeQrModal);
    document.getElementById('btn-start-scanner').addEventListener('click', startQrCamera);

    // Pencarian Transaksi
    document.getElementById('search-tx').addEventListener('input', function(e) {
        renderTransactionsList(e.target.value);
    });

    // Filter Grafik
    document.getElementById('chart-filter').addEventListener('change', function() {
        renderCharts();
    });

    // Input nominal keyboard listener
    const inputAmt = document.getElementById('input-amount');
    inputAmt.addEventListener('input', function(e) {
        calcExpression = e.target.value;
    });
    inputAmt.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            pressCalc('=');
        }
    });

    // Menangani perubahan ukuran layar (Resize Event)
    window.addEventListener('resize', function() {
        if (window.innerWidth >= 768) {
            document.getElementById('section-dashboard').classList.remove('hidden');
            document.getElementById('section-transactions').classList.remove('hidden');
        } else {
            switchMobileTab(currentMobileTab);
        }
    });
}

// Toggle drawer pengaturan API
function toggleApiSettings() {
    const panel = document.getElementById('api-settings-panel');
    const chevron = document.getElementById('api-settings-chevron');
    
    panel.classList.toggle('hidden');
    chevron.classList.toggle('rotate-180');
}

// Simpan Kredensial Konfigurasi secara Lokal
function saveApiSettings() {
    const supaUrl = document.getElementById('input-supabase-url').value.trim();
    const supaKey = document.getElementById('input-supabase-key').value.trim();
    const geminiKey = document.getElementById('input-gemini-key').value.trim();

    localStorage.setItem('supabase_url', supaUrl);
    localStorage.setItem('supabase_anon_key', supaKey);
    localStorage.setItem('gemini_api_key', geminiKey);

    showToast("Kredensial Supabase & Gemini berhasil disimpan!", "success");
    toggleApiSettings();
    
    // Inisialisasi ulang Supabase Client
    if (supaUrl && supaKey) {
        try {
            supabaseClient = window.supabase.createClient(supaUrl, supaKey);
        } catch (err) {
            console.error("Gagal memuat client Supabase:", err);
        }
    }

    // Refresh data jika sedang login
    if (currentUser) {
        loadData();
    }
}

// Toggle login & register forms
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

// Login using email and password
async function loginWithEmail(e) {
    if (e) e.preventDefault();
    if (!supabaseClient) {
        showToast("Supabase belum dikonfigurasi! Harap lengkapi URL dan Anon Key terlebih dahulu.", "error");
        toggleApiSettings();
        return;
    }

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    localStorage.setItem('is_demo_mode', 'false');

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) throw error;

        if (data && data.user) {
            currentUser = {
                id: data.user.id,
                email: data.user.email,
                name: data.user.user_metadata.full_name || data.user.email,
                picture: data.user.user_metadata.avatar_url || 'https://via.placeholder.com/150'
            };
            localStorage.setItem('user_session', JSON.stringify(currentUser));
            showToast("Masuk berhasil!", "success");
            showDashboard();
        }
    } catch (e) {
        console.error("Kesalahan Login Email:", e.message);
        showToast(`Masuk Gagal: ${e.message}`, "error");
    }
}

// Register new account with email and password
async function registerWithEmail(e) {
    if (e) e.preventDefault();
    if (!supabaseClient) {
        showToast("Supabase belum dikonfigurasi! Harap lengkapi URL dan Anon Key terlebih dahulu.", "error");
        toggleApiSettings();
        return;
    }

    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    if (password.length < 6) {
        showToast("Password minimal harus 6 karakter!", "warning");
        return;
    }

    localStorage.setItem('is_demo_mode', 'false');

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    full_name: name
                }
            }
        });

        if (error) throw error;

        if (data && data.user) {
            if (data.session) {
                currentUser = {
                    id: data.user.id,
                    email: data.user.email,
                    name: data.user.user_metadata.full_name || data.user.email,
                    picture: data.user.user_metadata.avatar_url || 'https://via.placeholder.com/150'
                };
                localStorage.setItem('user_session', JSON.stringify(currentUser));
                showToast("Pendaftaran berhasil dan otomatis masuk!", "success");
                showDashboard();
            } else {
                showToast("Pendaftaran berhasil! Silakan periksa email untuk verifikasi (atau langsung coba masuk jika tidak perlu verifikasi).", "info");
                showAuthForm('login');
            }
        }
    } catch (e) {
        console.error("Kesalahan Pendaftaran:", e.message);
        showToast(`Pendaftaran Gagal: ${e.message}`, "error");
    }
}

// Authentication Handlers menggunakan Supabase OAuth
async function loginWithGoogle() {
    if (!supabaseClient) {
        showToast("Supabase belum dikonfigurasi! Harap lengkapi URL dan Anon Key terlebih dahulu.", "error");
        toggleApiSettings();
        return;
    }
    
    localStorage.setItem('is_demo_mode', 'false');
    
    try {
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname
            }
        });
        if (error) throw error;
    } catch (e) {
        console.error("Kesalahan Login Google OAuth:", e.message);
        showToast(`Masuk Gagal: ${e.message}`, "error");
    }
}

function loginAsDemo() {
    currentUser = {
        id: "demo-user-uuid-12345",
        email: "demo.user@aura.local",
        name: "Demo User (Uji Coba)",
        picture: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=200"
    };
    
    localStorage.setItem('is_demo_mode', 'true');
    localStorage.setItem('user_session', JSON.stringify(currentUser));
    showToast("Masuk sebagai Pengguna Demo. Data disimpan di memori lokal.", "info");
    showDashboard();
}

async function logout() {
    const isDemo = localStorage.getItem('is_demo_mode') === 'true';
    
    localStorage.removeItem('user_session');
    localStorage.removeItem('is_demo_mode');
    currentUser = null;
    transactions = [];
    
    if (supabaseClient && !isDemo) {
        try {
            await supabaseClient.auth.signOut();
        } catch (e) {
            console.error("Supabase signout error:", e);
        }
    }
    
    // Tampilkan login screen kembali
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('dashboard-screen').classList.add('hidden');
    showToast("Berhasil keluar dari sesi aplikasi.", "info");
}

// Tampilkan Dashboard & Tarik Data
function showDashboard() {
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('dashboard-screen').classList.remove('hidden');

    // Perbarui Profile Widget (Desktop & Mobile)
    const profilePic = currentUser.picture || 'https://via.placeholder.com/150';
    document.getElementById('user-avatar').src = profilePic;
    document.getElementById('user-name').innerText = currentUser.name;
    
    const mobAvatar = document.getElementById('mobile-user-avatar');
    const mobName = document.getElementById('mobile-user-name');
    if (mobAvatar) mobAvatar.src = profilePic;
    if (mobName) mobName.innerText = currentUser.name;

    // Reset Form Input Tanggal ke Tanggal Hari Ini
    document.getElementById('input-date').value = new Date().toISOString().substring(0, 10);

    // Inisialisasi tampilan tab aktif pada mobile
    if (window.innerWidth < 768) {
        switchMobileTab(currentMobileTab);
    } else {
        document.getElementById('section-dashboard').classList.remove('hidden');
        document.getElementById('section-transactions').classList.remove('hidden');
    }

    // Ambil Data Transaksi
    loadData();
}

// Mengambil data transaksi dari Supabase (atau LocalStorage jika Demo)
async function loadData() {
    const loadingState = document.getElementById('tx-loading-state');
    const emptyState = document.getElementById('tx-empty-state');
    const listContainer = document.getElementById('tx-list-container');

    loadingState.classList.remove('hidden');
    emptyState.classList.add('hidden');
    listContainer.classList.add('hidden');

    const isDemo = localStorage.getItem('is_demo_mode') === 'true';

    if (!supabaseClient || isDemo) {
        // Mode Demo Offline
        loadLocalTransactions();
        loadingState.classList.add('hidden');
        return;
    }

    try {
        // Query PostgreSQL di Supabase. RLS akan membatasi baris secara otomatis
        // agar hanya mengembalikan data milik auth.uid() == user_id.
        const { data, error } = await supabaseClient
            .from('transactions')
            .select('*')
            .order('date', { ascending: false });
            
        if (error) throw error;
        
        transactions = data || [];
        localStorage.setItem(`tx_cache_${currentUser.email}`, JSON.stringify(transactions));
        updateDashboardMetrics();
    } catch (e) {
        console.error("Gagal memuat data dari Supabase Database:", e);
        showToast("Koneksi gagal. Menggunakan data cache offline.", "warning");
        loadLocalTransactions();
    } finally {
        loadingState.classList.add('hidden');
    }
}

function loadLocalTransactions() {
    const cached = localStorage.getItem(`tx_cache_${currentUser.email}`);
    if (cached) {
        transactions = JSON.parse(cached);
    } else {
        // Dummy data awal agar UI terlihat interaktif & premium saat dicoba pertama kali
        transactions = [
            { id: "d1", date: getOffsetDate(0), user_id: currentUser.id, amount: 85000, category: "Makanan & Minuman", type: "expense", description: "Beli Kopi Susu & Roti Bakar" },
            { id: "d2", date: getOffsetDate(-1), user_id: currentUser.id, amount: 450000, category: "Belanja", type: "expense", description: "Pakaian Kaos Kasual" },
            { id: "d3", date: getOffsetDate(-2), user_id: currentUser.id, amount: 15000000, category: "Gaji / Pemasukan", type: "income", description: "Transfer Gaji Pokok Mei" },
            { id: "d4", date: getOffsetDate(-3), user_id: currentUser.id, amount: 350000, category: "Tagihan & Utilitas", type: "expense", description: "Tagihan Wi-Fi Rumah" },
            { id: "d5", date: getOffsetDate(-4), user_id: currentUser.id, amount: 120000, category: "Transportasi", type: "expense", description: "Isi Ulang Kartu Commuter & Ojol" },
            { id: "d6", date: getOffsetDate(-5), user_id: currentUser.id, amount: 2500000, category: "Investasi", type: "income", description: "Dividen Reksa Dana Saham" }
        ];
        localStorage.setItem(`tx_cache_${currentUser.email}`, JSON.stringify(transactions));
    }
    updateDashboardMetrics();
}

function getOffsetDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().substring(0, 10);
}

// Update metrik dashboard, list, dan redraw charts
function updateDashboardMetrics() {
    let totalIncome = 0;
    let totalExpense = 0;
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    transactions.forEach(t => {
        const tDate = new Date(t.date);
        const isCurrentMonth = tDate.getFullYear() === currentYear && tDate.getMonth() === currentMonth;
        
        if (t.type === 'income') {
            totalIncome += parseFloat(t.amount) || 0;
        } else {
            totalExpense += parseFloat(t.amount) || 0;
        }
    });

    const balance = totalIncome - totalExpense;

    // Render statistik
    document.getElementById('stat-total-balance').innerText = formatRupiah(balance);
    document.getElementById('stat-total-income').innerText = formatRupiah(totalIncome);
    document.getElementById('stat-total-expense').innerText = formatRupiah(totalExpense);
    
    const monthNames = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
    const currentMonthName = monthNames[currentMonth];
    
    document.getElementById('stat-income-desc').innerText = `Total Pemasukan di ${currentMonthName} ${currentYear}`;
    document.getElementById('stat-expense-desc').innerText = `Total Pengeluaran di ${currentMonthName} ${currentYear}`;

    // Render list dan charts
    renderTransactionsList();
    renderCharts();
}

// Render daftar transaksi ke UI
function renderTransactionsList(searchQuery = '') {
    const listContainer = document.getElementById('tx-list-container');
    const emptyState = document.getElementById('tx-empty-state');
    const listElement = document.getElementById('tx-list');
    
    listElement.innerHTML = '';
    
    // Saring berdasarkan tab filter (Semua, Pemasukan, Pengeluaran)
    let filtered = transactions;
    if (currentTxFilter !== 'all') {
        filtered = filtered.filter(t => t.type === currentTxFilter);
    }
    
    // Filter pencarian
    filtered = filtered.filter(t => {
        const matchesQuery = t.description.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             t.category.toLowerCase().includes(searchQuery.toLowerCase());
        return matchesQuery;
    });

    if (filtered.length === 0) {
        listContainer.classList.add('hidden');
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    listContainer.classList.remove('hidden');

    filtered.forEach(t => {
        const item = document.createElement('div');
        item.className = 'py-3.5 flex items-center justify-between group hover:bg-slate-800/20 px-2 rounded-xl transition duration-150';
        
        const iconClass = getCategoryIcon(t.category);
        const colorClass = t.type === 'income' ? 'text-brandTeal bg-brandTeal/10' : 'text-brandCoral bg-brandCoral/10';
        const sign = t.type === 'income' ? '+' : '-';
        const amountColor = t.type === 'income' ? 'text-brandTeal' : 'text-brandCoral';

        item.innerHTML = `
            <div class="flex items-center space-x-3.5 min-w-0">
                <div class="w-10 h-10 rounded-xl ${colorClass} flex items-center justify-center flex-shrink-0 text-sm">
                    <i class="${iconClass}"></i>
                </div>
                <div class="min-w-0">
                    <span class="block text-xs font-semibold text-slate-200 truncate">${t.description || 'Tanpa Catatan'}</span>
                    <div class="flex items-center space-x-2 mt-0.5">
                        <span class="text-[10px] font-bold text-slate-500 uppercase">${t.category}</span>
                        <span class="text-[10px] text-slate-500">•</span>
                        <span class="text-[10px] text-slate-500">${formatDateIndo(t.date)}</span>
                    </div>
                </div>
            </div>
            <div class="flex items-center space-x-3 flex-shrink-0">
                <span class="text-xs font-bold ${amountColor}">${sign} ${formatRupiah(t.amount)}</span>
                <button onclick="handleDeleteTransaction('${t.id}')" class="opacity-0 group-hover:opacity-100 focus:opacity-100 text-slate-500 hover:text-brandCoral p-1.5 rounded-lg hover:bg-brandCoral/10 transition duration-150 min-h-[32px] w-[32px] flex items-center justify-center" title="Hapus Transaksi">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            </div>
        `;
        listElement.appendChild(item);
    });
}

// Menghapus Transaksi di Supabase
async function handleDeleteTransaction(id) {
    if (!confirm("Apakah Anda yakin ingin menghapus transaksi ini?")) return;

    const isDemo = localStorage.getItem('is_demo_mode') === 'true';

    // UI Responsif: Hapus lokal dahulu
    const originalTx = [...transactions];
    transactions = transactions.filter(t => t.id !== id);
    updateDashboardMetrics();
    
    localStorage.setItem(`tx_cache_${currentUser.email}`, JSON.stringify(transactions));

    if (!supabaseClient || isDemo) {
        showToast("Transaksi dihapus secara lokal offline.", "success");
        return;
    }

    try {
        const { error } = await supabaseClient
            .from('transactions')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        showToast("Transaksi berhasil dihapus dari database Supabase.", "success");
    } catch (e) {
        console.error("Gagal hapus data dari database Supabase:", e);
        transactions = originalTx; // Rollback
        updateDashboardMetrics();
        showToast("Hapus gagal. Hubungi administrator.", "error");
    }
}

// Mengganti filter tipe transaksi di list
function setTxFilter(filter) {
    currentTxFilter = filter;
    
    // Update visual tab filter
    const allBtn = document.getElementById('filter-tx-all');
    const incomeBtn = document.getElementById('filter-tx-income');
    const expenseBtn = document.getElementById('filter-tx-expense');
    
    const activeClass = "px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-brandPurple text-white shadow-neon-purple active:scale-95 transition-transform duration-100 min-h-[36px]";
    const inactiveClass = "px-3.5 py-1.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 active:scale-95 transition-transform duration-100 min-h-[36px]";
    
    if (allBtn) allBtn.className = filter === 'all' ? activeClass : inactiveClass;
    if (incomeBtn) incomeBtn.className = filter === 'income' ? activeClass : inactiveClass;
    if (expenseBtn) expenseBtn.className = filter === 'expense' ? activeClass : inactiveClass;
    
    // Efek transisi halus (fade out -> render -> fade in)
    const listElement = document.getElementById('tx-list');
    if (listElement) {
        listElement.style.opacity = '0';
        listElement.style.transition = 'opacity 0.15s ease-in-out';
        
        setTimeout(() => {
            renderTransactionsList(document.getElementById('search-tx').value);
            listElement.style.opacity = '1';
        }, 150);
    } else {
        renderTransactionsList(document.getElementById('search-tx').value);
    }
}

// Mengganti tab aktif di perangkat mobile (Tab Routing)
function switchMobileTab(tab) {
    if (window.innerWidth >= 768) return; // Hiraukan jika di desktop
    
    currentMobileTab = tab;
    
    const dashboardSec = document.getElementById('section-dashboard');
    const txSec = document.getElementById('section-transactions');
    
    const btnDash = document.getElementById('btn-nav-dashboard');
    const btnTx = document.getElementById('btn-nav-transactions');
    
    const activeNavClass = "flex flex-col items-center justify-center flex-1 h-full text-brandPurple active:scale-95 transition-transform duration-100";
    const inactiveNavClass = "flex flex-col items-center justify-center flex-1 h-full text-slate-400 active:scale-95 transition-transform duration-100";
    
    if (tab === 'dashboard') {
        if (dashboardSec) dashboardSec.classList.remove('hidden');
        if (txSec) txSec.classList.add('hidden');
        
        if (btnDash) btnDash.className = activeNavClass;
        if (btnTx) btnTx.className = inactiveNavClass;
    } else {
        if (dashboardSec) dashboardSec.classList.add('hidden');
        if (txSec) txSec.classList.remove('hidden');
        
        if (btnTx) btnTx.className = activeNavClass;
        if (btnDash) btnDash.className = inactiveNavClass;
    }
}

// Helper category icons mapping
function getCategoryIcon(category) {
    switch(category) {
        case "Makanan & Minuman": return "fa-solid fa-utensils";
        case "Transportasi": return "fa-solid fa-car-side";
        case "Belanja": return "fa-solid fa-bag-shopping";
        case "Tagihan & Utilitas": return "fa-solid fa-bolt";
        case "Hiburan & Rekreasi": return "fa-solid fa-gamepad";
        case "Gaji / Pemasukan": return "fa-solid fa-wallet";
        case "Investasi": return "fa-solid fa-chart-line";
        default: return "fa-solid fa-tag";
    }
}

// Menggambar Charts dengan Chart.js
function renderCharts() {
    const ctxCashflow = document.getElementById('cashflowChart').getContext('2d');
    const ctxCategory = document.getElementById('categoryChart').getContext('2d');
    
    if (cashflowChartInstance) cashflowChartInstance.destroy();
    if (categoryChartInstance) categoryChartInstance.destroy();

    // 1. DATA TREN ARUS KAS (LINE CHART)
    const filterDays = parseInt(document.getElementById('chart-filter').value) || 30;
    const labels = [];
    const incomeData = [];
    const expenseData = [];

    for (let i = filterDays - 1; i >= 0; i--) {
        labels.push(getOffsetDate(-i));
        incomeData.push(0);
        expenseData.push(0);
    }

    transactions.forEach(t => {
        const idx = labels.indexOf(t.date);
        if (idx !== -1) {
            if (t.type === 'income') {
                incomeData[idx] += parseFloat(t.amount) || 0;
            } else {
                expenseData[idx] += parseFloat(t.amount) || 0;
            }
        }
    });

    const formattedLabels = labels.map(l => {
        const d = new Date(l);
        const day = d.getDate();
        const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        return `${day} ${months[d.getMonth()]}`;
    });

    cashflowChartInstance = new Chart(ctxCashflow, {
        type: 'line',
        data: {
            labels: formattedLabels,
            datasets: [
                {
                    label: 'Pemasukan',
                    data: incomeData,
                    borderColor: '#0d9488',
                    backgroundColor: 'rgba(13, 148, 136, 0.05)',
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true,
                    pointRadius: filterDays > 30 ? 0 : 2,
                },
                {
                    label: 'Pengeluaran',
                    data: expenseData,
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.05)',
                    borderWidth: 2,
                    tension: 0.35,
                    fill: true,
                    pointRadius: filterDays > 30 ? 0 : 2,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 10, weight: 600 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: Rp ${context.raw.toLocaleString('id-ID')}`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 8 } }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.03)' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 9 },
                        callback: function(value) {
                            if (value >= 1000000) return (value / 1000000) + 'M';
                            if (value >= 1000) return (value / 1000) + 'K';
                            return value;
                        }
                    }
                }
            }
        }
    });

    // 2. DATA PENGELUARAN KATEGORI (DOUGHNUT CHART)
    const categoryTotals = {};
    const expenses = transactions.filter(t => t.type === 'expense');
    
    expenses.forEach(t => {
        categoryTotals[t.category] = (categoryTotals[t.category] || 0) + (parseFloat(t.amount) || 0);
    });

    const categoryLabels = Object.keys(categoryTotals);
    const categoryData = Object.values(categoryTotals);

    const chartColors = [
        '#f43f5e', // Coral
        '#8b5cf6', // Purple
        '#0284c7', // Sky Blue
        '#f59e0b', // Amber/Orange
        '#10b981', // Emerald
        '#ec4899', // Pink
        '#64748b', // Slate
    ];

    if (categoryLabels.length === 0) {
        categoryLabels.push("Belum ada");
        categoryData.push(1);
        chartColors[0] = 'rgba(255,255,255,0.08)';
    }

    categoryChartInstance = new Chart(ctxCategory, {
        type: 'doughnut',
        data: {
            labels: categoryLabels,
            datasets: [{
                data: categoryData,
                backgroundColor: chartColors,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#94a3b8',
                        boxWidth: 10,
                        font: { size: 10, weight: 500 },
                        padding: 12
                    }
                },
                tooltip: {
                    enabled: categoryLabels[0] !== "Belum ada",
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const val = context.raw;
                            const pct = ((val / total) * 100).toFixed(1);
                            return ` Rp ${val.toLocaleString('id-ID')} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

// Modal Form Inputs & Calculator Handlers
function openInputModal() {
    const modal = document.getElementById('modal-input');
    const container = document.getElementById('modal-input-container');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    
    resetInputForm();
    
    setTimeout(() => {
        if (container) {
            container.classList.remove('translate-y-full');
            container.classList.add('translate-y-0');
        }
    }, 50);
}

// Animasi menutup modal form input transaksi
function closeInputModal() {
    const modal = document.getElementById('modal-input');
    const container = document.getElementById('modal-input-container');
    
    if (container) {
        container.classList.remove('translate-y-0');
        container.classList.add('translate-y-full');
    }
    
    setTimeout(() => {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
        stopSpeechListening();
    }, 300);
}

function setInputType(type) {
    activeInputType = type;
    const expenseTab = document.getElementById('tab-type-expense');
    const incomeTab = document.getElementById('tab-type-income');

    if (type === 'expense') {
        expenseTab.className = "py-2.5 text-xs font-semibold rounded-lg bg-brandCoral text-white shadow-neon-coral transition-all duration-150 min-h-[40px] active:scale-95 transition-transform";
        incomeTab.className = "py-2.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-150 min-h-[40px] active:scale-95 transition-transform";
        document.getElementById('input-category').value = "Lainnya";
    } else {
        incomeTab.className = "py-2.5 text-xs font-semibold rounded-lg bg-brandTeal text-white shadow-neon-teal transition-all duration-150 min-h-[40px] active:scale-95 transition-transform";
        expenseTab.className = "py-2.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 transition-all duration-150 min-h-[40px] active:scale-95 transition-transform";
        document.getElementById('input-category').value = "Gaji / Pemasukan";
    }
}

function resetInputForm() {
    calcExpression = '';
    document.getElementById('input-amount').value = '0';
    document.getElementById('input-description').value = '';
    setInputType('expense');
    document.getElementById('calculator-keypad').classList.remove('hidden');
    clearOCRPreview();
}

// Built-in Numpad Calculator logic
function pressCalc(val) {
    const amountField = document.getElementById('input-amount');
    
    if (val === 'C') {
        calcExpression = '';
        amountField.value = '0';
    } else if (val === 'DEL') {
        calcExpression = calcExpression.toString().slice(0, -1);
        amountField.value = calcExpression || '0';
    } else if (val === '=') {
        if (!calcExpression) return;
        const result = evaluateExpression(calcExpression);
        amountField.value = result;
        calcExpression = result.toString();
    } else {
        if (amountField.value === '0' && !isNaN(val)) {
            calcExpression = val;
        } else {
            calcExpression += val;
        }
        amountField.value = calcExpression;
    }
}

function evaluateExpression(str) {
    str = str.replace(/×/g, '*').replace(/÷/g, '/');
    const sanitized = str.replace(/[^0-9+\-*/().]/g, '');
    try {
        const calcResult = new Function(`return ${sanitized}`)();
        if (isNaN(calcResult) || !isFinite(calcResult)) return "Error";
        return Math.max(0, Math.round(calcResult));
    } catch(e) {
        return "Error";
    }
}

// Google Gemini API Request Wrapper
async function queryGemini(promptText, base64ImageData = null, mimeType = null) {
    const geminiKey = localStorage.getItem('gemini_api_key') || DEFAULT_GEMINI_API_KEY;
    if (!geminiKey) {
        showToast("Gemini API Key belum dikonfigurasi!", "warning");
        toggleApiSettings();
        return null;
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
    const parts = [{ text: promptText }];
    
    if (base64ImageData && mimeType) {
        parts.push({
            inlineData: {
                mimeType: mimeType,
                data: base64ImageData
            }
        });
    }

    const payload = { contents: [{ parts: parts }] };

    try {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (data.candidates && data.candidates[0].content.parts[0].text) {
            return data.candidates[0].content.parts[0].text;
        } else {
            throw new Error("Respon tidak valid");
        }
    } catch (error) {
        console.error("Gemini API Error:", error);
        return null;
    }
}

// 1. VOICE COMMAND LOGIC
let speechRecognitionInstance = null;

function startVoiceRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        showToast("Browser Anda tidak mendukung Web Speech API (Gunakan Chrome/Edge).", "error");
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

    micBtn.classList.add('recording-active');
    processBox.classList.remove('hidden');
    processStatus.innerText = "Sedang mendengarkan suara Anda...";
    processStatus.className = "font-semibold text-brandCoral animate-pulse";
    processIcon.className = "fa-solid fa-microphone text-brandCoral animate-bounce";
    transcriptPreview.innerText = 'Bicaralah kalimat seperti: "Catat pengeluaran makan siang sebesar lima puluh ribu rupiah"';

    speechRecognitionInstance.onresult = async function(event) {
        const transcript = event.results[0][0].transcript;
        transcriptPreview.innerText = `Suara Anda: "${transcript}"`;
        
        processStatus.innerText = "Sedang mengekstrak data keuangan via AI...";
        processStatus.className = "font-semibold text-brandPurple";
        processIcon.className = "fa-solid fa-circle-notch fa-spin text-brandPurple";

        const parsedJsonStr = await queryGemini(
            `Analisis kalimat transaksi keuangan berikut: "${transcript}".
            Ekstrak data menjadi format JSON mentah tanpa blok format kode markdown (tanpa \`\`\`json).
            Skema JSON harus tepat seperti ini:
            {
              "amount": <number>,
              "category": "<kategori>",
              "type": "income" atau "expense",
              "description": "<keterangan singkat>"
            }
            Kategori HANYA boleh bernilai salah satu dari:
            "Makanan & Minuman", "Transportasi", "Belanja", "Tagihan & Utilitas", "Hiburan & Rekreasi", "Gaji / Pemasukan", "Investasi", "Lainnya".
            Jika kalimat menunjukkan pemasukan, set tipe ke "income". Jika pengeluaran, set tipe ke "expense".`
        );

        if (parsedJsonStr) {
            applyParsedTxData(parsedJsonStr);
        } else {
            showToast("AI gagal mendeteksi detail transaksi. Coba ulangi dengan suara lebih jelas.", "error");
        }
        stopSpeechListening();
    };

    speechRecognitionInstance.onerror = function(event) {
        console.error("Speech Recognition Error:", event.error);
        showToast("Mikrofon gagal merespon atau terjadi time out.", "error");
        stopSpeechListening();
    };

    speechRecognitionInstance.onend = function() {
        stopSpeechListening();
    };

    speechRecognitionInstance.start();
}

function stopSpeechListening() {
    const micBtn = document.getElementById('btn-voice-input');
    const processBox = document.getElementById('ai-processing-box');
    
    if (speechRecognitionInstance) {
        speechRecognitionInstance.stop();
        speechRecognitionInstance = null;
    }

    micBtn.classList.remove('recording-active');
    processBox.classList.add('hidden');
}

function applyParsedTxData(jsonStr) {
    try {
        const cleanedStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(cleanedStr);
        
        if (data.amount) {
            document.getElementById('input-amount').value = data.amount;
            calcExpression = data.amount.toString();
        }
        if (data.category) {
            document.getElementById('input-category').value = data.category;
        }
        if (data.type) {
            setInputType(data.type);
        }
        if (data.description) {
            document.getElementById('input-description').value = data.description;
        }
        
        showToast("Transaksi berhasil diurai otomatis oleh AI!", "success");
    } catch (err) {
        console.error("Gagal parse respon JSON Gemini:", err, jsonStr);
        showToast("AI memberikan respon yang tidak valid. Isi data secara manual.", "warning");
    }
}

// 2. OCR RECEIPT SCANNER LOGIC
async function handleReceiptOCR(event) {
    const file = event.target.files[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
        showToast("Harap pilih file gambar kuitansi.", "warning");
        return;
    }

    const previewBox = document.getElementById('ocr-preview-box');
    const imgThumbnail = document.getElementById('ocr-img-thumbnail');
    const fileName = document.getElementById('ocr-file-name');
    const fileSize = document.getElementById('ocr-file-size');
    const progressBar = document.getElementById('ocr-progress-bar');

    previewBox.classList.remove('hidden');
    fileName.innerText = file.name;
    fileSize.innerText = `${(file.size / 1024).toFixed(1)} KB`;
    progressBar.style.width = '20%';

    const reader = new FileReader();
    reader.onload = async function() {
        imgThumbnail.src = reader.result;
        progressBar.style.width = '50%';
        
        const base64String = reader.result;
        const base64Data = base64String.split(',')[1];
        const mimeType = base64String.split(';')[0].split(':')[1];
        
        progressBar.style.width = '70%';

        const ocrPrompt = `Analisis foto struk belanja/kuitansi/nota ini. Ekstrak data total nominal akhir pengeluaran setelah diskon.
        Ekstrak data menjadi format JSON mentah tanpa blok format kode markdown (tanpa \`\`\`json).
        Skema JSON harus tepat seperti ini:
        {
          "amount": <number>,
          "category": "<kategori>",
          "description": "<nama merchant / keterangan belanja>"
        }
        Kategori HANYA boleh bernilai salah satu dari:
        "Makanan & Minuman", "Transportasi", "Belanja", "Tagihan & Utilitas", "Hiburan & Rekreasi", "Lainnya".
        Jika tidak ada kategori yang cocok, isi dengan "Lainnya".`;

        const parsedJsonStr = await queryGemini(ocrPrompt, base64Data, mimeType);
        
        progressBar.style.width = '100%';
        
        if (parsedJsonStr) {
            applyParsedTxData(parsedJsonStr);
            setInputType('expense');
        } else {
            showToast("Gagal mendeteksi teks struk kuitansi. Isi nominal secara manual.", "error");
        }
    };
    reader.readAsDataURL(file);
}

function clearOCRPreview() {
    document.getElementById('ocr-preview-box').classList.add('hidden');
    document.getElementById('ocr-image-upload').value = '';
    document.getElementById('ocr-img-thumbnail').src = '';
}

// Mengirimkan Transaksi baru ke Supabase
async function submitTransaction() {
    const amountVal = parseInt(document.getElementById('input-amount').value) || 0;
    const category = document.getElementById('input-category').value;
    const date = document.getElementById('input-date').value;
    const description = document.getElementById('input-description').value.trim() || 'Tanpa keterangan';
    const type = activeInputType;

    if (amountVal <= 0) {
        showToast("Nominal transaksi harus lebih dari Rp 0", "warning");
        return;
    }

    if (!date) {
        showToast("Tanggal transaksi wajib diisi", "warning");
        return;
    }

    const txData = {
        amount: amountVal,
        category: category,
        date: date,
        description: description,
        type: type
    };

    const isDemo = localStorage.getItem('is_demo_mode') === 'true';
    const tempId = 'local_' + Date.now();
    const newLocalTx = { id: tempId, user_id: currentUser.id, ...txData };

    // Sisi UI Responsif: Tambah lokal dahulu
    transactions.unshift(newLocalTx);
    updateDashboardMetrics();
    
    localStorage.setItem(`tx_cache_${currentUser.email}`, JSON.stringify(transactions));

    closeInputModal();
    showToast("Transaksi disimpan secara lokal.", "success");

    if (!supabaseClient || isDemo) return;

    try {
        // Kirim data ke tabel transactions Supabase
        const { data, error } = await supabaseClient
            .from('transactions')
            .insert([{
                user_id: currentUser.id,
                ...txData
            }])
            .select();

        if (error) throw error;

        // Ganti ID lokal sementara dengan ID yang dihasilkan database Supabase
        if (data && data[0]) {
            const idx = transactions.findIndex(t => t.id === tempId);
            if (idx !== -1) {
                transactions[idx].id = data[0].id;
                localStorage.setItem(`tx_cache_${currentUser.email}`, JSON.stringify(transactions));
                renderTransactionsList();
            }
            showToast("Transaksi berhasil disinkronisasi ke Supabase Database!", "success");
        }
    } catch(err) {
        console.error("Gagal menyimpan transaksi ke Cloud Supabase:", err);
        showToast("Sinkronisasi Cloud tertunda. Data disimpan secara luring.", "warning");
    }
}

// 3. QR CODE WEB SYNC LOGIC
function openQrModal() {
    document.getElementById('modal-qr-sync').classList.remove('hidden');
    document.getElementById('modal-qr-sync').classList.add('flex');
    setQrMode('share');
}

function closeQrModal() {
    document.getElementById('modal-qr-sync').classList.add('hidden');
    document.getElementById('modal-qr-sync').classList.remove('flex');
    
    if (qrScannerInstance) {
        try {
            qrScannerInstance.clear();
        } catch (e) {
            console.error(e);
        }
        qrScannerInstance = null;
    }
    document.getElementById('qr-scanner-placeholder').classList.remove('hidden');
}

function setQrMode(mode) {
    currentQrMode = mode;
    const shareTab = document.getElementById('tab-qr-share');
    const scanTab = document.getElementById('tab-qr-scan');
    const shareSection = document.getElementById('qr-share-section');
    const scanSection = document.getElementById('qr-scan-section');

    if (mode === 'share') {
        shareTab.className = "py-2.5 text-xs font-semibold rounded-lg bg-brandPurple text-white shadow-neon-purple active:scale-95 transition-transform min-h-[36px]";
        scanTab.className = "py-2.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 active:scale-95 transition-transform min-h-[36px]";
        shareSection.classList.remove('hidden');
        scanSection.classList.add('hidden');
        
        generateSyncQrCode();
    } else {
        scanTab.className = "py-2.5 text-xs font-semibold rounded-lg bg-brandPurple text-white shadow-neon-purple active:scale-95 transition-transform min-h-[36px]";
        shareTab.className = "py-2.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-slate-200 active:scale-95 transition-transform min-h-[36px]";
        scanSection.classList.remove('hidden');
        shareSection.classList.add('hidden');
    }
}

function generateSyncQrCode() {
    const qrContainer = document.getElementById('qrcode-container');
    qrContainer.innerHTML = '';

    if (!currentUser) return;

    const payload = {
        id: currentUser.id,
        email: currentUser.email,
        name: currentUser.name,
        picture: currentUser.picture,
        supabase_url: localStorage.getItem('supabase_url') || '',
        supabase_key: localStorage.getItem('supabase_anon_key') || '',
        gemini_key: localStorage.getItem('gemini_api_key') || '',
        expires: Date.now() + (5 * 60 * 1000)
    };

    const token = btoa(encodeURIComponent(JSON.stringify(payload)));
    
    new QRCode(qrContainer, {
        text: token,
        width: 180,
        height: 180,
        colorDark : "#090d16",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.H
    });
}

function startQrCamera() {
    document.getElementById('qr-scanner-placeholder').classList.add('hidden');
    
    qrScannerInstance = new Html5Qrcode("qr-reader");
    const config = { fps: 10, qrbox: { width: 220, height: 220 } };

    qrScannerInstance.start(
        { facingMode: "environment" },
        config,
        onQrScanSuccess,
        onQrScanError
    ).catch(err => {
        console.error("Gagal membuka kamera:", err);
        showToast("Akses kamera ditolak atau tidak ditemukan.", "error");
        document.getElementById('qr-scanner-placeholder').classList.remove('hidden');
    });
}

function onQrScanSuccess(decodedText) {
    try {
        const jsonStr = decodeURIComponent(atob(decodedText));
        const payload = JSON.parse(jsonStr);

        if (payload.expires && Date.now() > payload.expires) {
            showToast("Kode QR telah kedaluwarsa. Muat ulang kode baru.", "error");
            return;
        }

        currentUser = {
            id: payload.id,
            email: payload.email,
            name: payload.name,
            picture: payload.picture
        };
        localStorage.setItem('user_session', JSON.stringify(currentUser));
        localStorage.setItem('is_demo_mode', 'false');
        
        if (payload.supabase_url) localStorage.setItem('supabase_url', payload.supabase_url);
        if (payload.supabase_key) localStorage.setItem('supabase_anon_key', payload.supabase_key);
        if (payload.gemini_key) localStorage.setItem('gemini_api_key', payload.gemini_key);

        showToast("Sinkronisasi Sesi Supabase Berhasil!", "success");
        
        // Re-init client
        if (payload.supabase_url && payload.supabase_key) {
            supabaseClient = window.supabase.createClient(payload.supabase_url, payload.supabase_key);
        }
        
        closeQrModal();
        showDashboard();
    } catch (err) {
        console.error(err);
        showToast("Kode QR tidak dikenal.", "error");
    }
}

function onQrScanError(err) {}

// UTILITY FUNCTIONS: Formatting Currency, Date and Toasts
function formatRupiah(number) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(number);
}

function formatDateIndo(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = date.getDate();
    const months = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    
    let typeClass = 'bg-slate-900 border-indigo-500 text-indigo-400';
    let icon = 'fa-solid fa-info-circle';
    
    if (type === 'success') {
        typeClass = 'bg-slate-900 border-brandTeal text-brandTeal shadow-neon-teal';
        icon = 'fa-solid fa-circle-check';
    } else if (type === 'error') {
        typeClass = 'bg-slate-900 border-brandCoral text-brandCoral shadow-neon-coral';
        icon = 'fa-solid fa-circle-xmark';
    } else if (type === 'warning') {
        typeClass = 'bg-slate-900 border-yellow-500 text-yellow-500';
        icon = 'fa-solid fa-triangle-exclamation';
    }

    toast.className = `p-4 border backdrop-blur-md rounded-2xl flex items-center space-x-3 shadow-glass transition-all duration-300 transform translate-x-12 opacity-0 pointer-events-auto`;
    toast.innerHTML = `
        <i class="${icon} text-lg flex-shrink-0"></i>
        <span class="text-xs font-semibold text-slate-200">${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.remove('translate-x-12', 'opacity-0');
    }, 50);

    setTimeout(() => {
        toast.classList.add('translate-x-12', 'opacity-0');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}
