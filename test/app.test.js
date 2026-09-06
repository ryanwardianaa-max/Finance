const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Load app.js (a browser script) inside a Node VM with stubbed browser globals
// so its pure production logic can be exercised without a DOM.
function loadApp() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

    const elements = new Map();
    function makeElement() {
        const classes = new Set();
        let html = '';
        return {
            value: '',
            textContent: '',
            className: '',
            children: [],
            style: {},
            // A real DOM clears its children whenever innerHTML is assigned.
            get innerHTML() { return html; },
            set innerHTML(v) { html = v; this.children.length = 0; },
            appendChild(child) { this.children.push(child); },
            remove() {},
            classList: {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
                contains: (c) => classes.has(c),
            },
            getContext: () => null,
        };
    }

    const sandbox = {
        console,
        Intl,
        setTimeout: () => {},
        clearTimeout: () => {},
        localStorage: (() => {
            const store = new Map();
            return {
                getItem: (k) => (store.has(k) ? store.get(k) : null),
                setItem: (k, v) => store.set(k, String(v)),
                removeItem: (k) => store.delete(k),
            };
        })(),
        document: {
            getElementById: (id) => {
                if (!elements.has(id)) elements.set(id, makeElement());
                return elements.get(id);
            },
            createElement: () => makeElement(),
            documentElement: { classList: { add() {}, remove() {} } },
        },
        navigator: {},
        supabase: { createClient: () => ({ auth: { onAuthStateChange: () => {} } }) },
    };
    sandbox.window = sandbox;

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'app.js' });

    sandbox.run = (expr) => vm.runInContext(expr, sandbox, { filename: 'app-test.js' });
    sandbox.elements = elements;
    return sandbox;
}

let ctx;
let elements;

beforeEach(() => {
    ctx = loadApp();
    elements = ctx.elements;
});

// ---------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------
test('formatRupiah formats IDR with thousands separators', () => {
    assert.equal(ctx.formatRupiah(1500000), 'Rp\u00A01.500.000');
    assert.equal(ctx.formatRupiah(0), 'Rp\u00A00');
    assert.equal(ctx.formatRupiah(123456789), 'Rp\u00A0123.456.789');
    assert.equal(ctx.formatRupiah(-5000), '-Rp\u00A05.000');
});

test('formatDisplayNumber inserts dots as thousands separators per number group', () => {
    assert.equal(ctx.formatDisplayNumber(''), '');
    assert.equal(ctx.formatDisplayNumber(null), '');
    assert.equal(ctx.formatDisplayNumber('123'), '123');
    assert.equal(ctx.formatDisplayNumber('1234'), '1.234');
    assert.equal(ctx.formatDisplayNumber('1500000'), '1.500.000');
    assert.equal(ctx.formatDisplayNumber('1000000000'), '1.000.000.000');
    assert.equal(ctx.formatDisplayNumber('1000+2000'), '1.000+2.000');
    assert.equal(ctx.formatDisplayNumber('abc1234def'), 'abc1.234def');
});

// ---------------------------------------------------------------
// Calculator
// ---------------------------------------------------------------
function setCalc(expr) {
    ctx.run(`calcExpression = ${JSON.stringify(expr)};`);
    ctx.document.getElementById('input-amount').value = '0';
}

test('pressCalc builds an expression and formats the display with dots', () => {
    setCalc('');
    ctx.pressCalc('1');
    ctx.pressCalc('5');
    ctx.pressCalc('0');
    ctx.pressCalc('0');
    assert.equal(elements.get('input-amount').value, '1.500');
});

test('pressCalc "=" evaluates the expression and stores the result', () => {
    setCalc('5+5');
    ctx.pressCalc('=');
    assert.equal(elements.get('input-amount').value, '10');
    assert.equal(ctx.run('calcExpression'), '10');
});

test('pressCalc "C" clears and "DEL" removes the last character', () => {
    setCalc('123');
    ctx.pressCalc('DEL');
    assert.equal(elements.get('input-amount').value, '12');
    ctx.pressCalc('C');
    assert.equal(elements.get('input-amount').value, '0');
    assert.equal(ctx.run('calcExpression'), '');
});

test('pressCalc full arithmetic sequence', () => {
    setCalc('');
    for (const k of ['2', '+', '3', '*', '4', '=']) ctx.pressCalc(k);
    assert.equal(elements.get('input-amount').value, '14');
});

test('evaluateExpression computes arithmetic with precedence', () => {
    assert.equal(ctx.evaluateExpression('1+2'), 3);
    assert.equal(ctx.evaluateExpression('10-4'), 6);
    assert.equal(ctx.evaluateExpression('2+3*4'), 14);
    assert.equal(ctx.evaluateExpression('20/5*2'), 8);
    assert.equal(ctx.evaluateExpression('2*(3+4)'), 14);
});

test('evaluateExpression handles calculator symbols and thousands-separator dots', () => {
    assert.equal(ctx.evaluateExpression('3×4'), 12);
    assert.equal(ctx.evaluateExpression('10÷4'), 3); // rounds 2.5 up
    assert.equal(ctx.evaluateExpression('1.500+500'), 2000); // dots are separators, stripped
});

test('evaluateExpression clamps negative and non-finite results to 0', () => {
    assert.equal(ctx.evaluateExpression('5-10'), 0);
    assert.equal(ctx.evaluateExpression('1/0'), 0); // Infinity
    assert.equal(ctx.evaluateExpression('0/0'), 0); // NaN
    assert.equal(ctx.evaluateExpression(''), 0);
});

test('evaluateExpression strips non-numeric characters instead of executing them', () => {
    assert.equal(ctx.evaluateExpression('a+b'), 0);
    assert.equal(ctx.evaluateExpression('console.log()'), 0); // stripped to '()', syntax error
    assert.equal(ctx.evaluateExpression('1;process.exit()'), 0); // stripped to '1..()', syntax error
    assert.equal(ctx.evaluateExpression('1+alert(1)'), 2); // stripped to '1+(1)', still plain math
});

// ---------------------------------------------------------------
// Dates
// ---------------------------------------------------------------
test('offsetDate walks the calendar one day at a time in ISO form', () => {
    const base = new Date(ctx.offsetDate(0));
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + 1);
    assert.equal(ctx.offsetDate(1), next.toISOString().substring(0, 10));
    const prev = new Date(base);
    prev.setUTCDate(prev.getUTCDate() - 1);
    assert.equal(ctx.offsetDate(-1), prev.toISOString().substring(0, 10));
    assert.equal(ctx.offsetDate(0), ctx.todayString());
});

test('formatDateShort renders Indonesian month abbreviations and tolerates empty input', () => {
    assert.match(ctx.formatDateShort('2026-01-05'), /^\d+ Jan$/);
    assert.match(ctx.formatDateShort('2026-12-31'), /^\d+ Des$/);
    assert.equal(ctx.formatDateShort(''), '');
    assert.equal(ctx.formatDateShort(null), '');
});

// ---------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------
test('defaultDemoData returns 8 valid transactions owned by the demo user', () => {
    const data = ctx.defaultDemoData();
    assert.equal(data.length, 8);
    assert.equal(new Set(data.map((t) => t.id)).size, 8);
    for (const t of data) {
        assert.ok(['income', 'expense'].includes(t.type));
        assert.ok(t.amount > 0);
        assert.equal(t.user_id, 'demo');
    }
    const income = data.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = data.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    assert.equal(income, 6600000);
    assert.equal(expense, 460000);
});

test('defaultDemoData uses the current user id when one is signed in', () => {
    ctx.run('currentUser = { id: "u-42" };');
    assert.equal(ctx.defaultDemoData()[0].user_id, 'u-42');
});

// ---------------------------------------------------------------
// Dashboard metrics
// ---------------------------------------------------------------
function metricsWith(transactionsExpr) {
    ctx.run(`transactions = ${transactionsExpr};`);
    ctx.run('renderCharts = function () {};');
    ctx.run('renderTransactionsList = function () {};');
    ctx.updateDashboardMetrics();
    return {
        balance: elements.get('stat-total-balance').textContent,
        income: elements.get('stat-total-income').textContent,
        expense: elements.get('stat-total-expense').textContent,
    };
}

test('updateDashboardMetrics computes income, expense and balance', () => {
    const m = metricsWith(JSON.stringify([
        { type: 'income', amount: 6600000 },
        { type: 'expense', amount: 460000 },
    ]));
    assert.equal(m.income, 'Rp\u00A06.600.000');
    assert.equal(m.expense, 'Rp\u00A0460.000');
    assert.equal(m.balance, 'Rp\u00A06.140.000');
});

test('updateDashboardMetrics handles empty and unknown-type transactions', () => {
    const empty = metricsWith('[]');
    assert.equal(empty.income, 'Rp\u00A00');
    assert.equal(empty.expense, 'Rp\u00A00');
    assert.equal(empty.balance, 'Rp\u00A00');

    const unknown = metricsWith(JSON.stringify([
        { type: 'income', amount: 50 },
        { type: 'transfer', amount: 100 }, // anything not "income" counts as expense
    ]));
    assert.equal(unknown.income, 'Rp\u00A050');
    assert.equal(unknown.expense, 'Rp\u00A0100');
    assert.equal(unknown.balance, '-Rp\u00A050');
});

// ---------------------------------------------------------------
// Transaction list rendering and filtering
// ---------------------------------------------------------------
function renderWith(transactionsExpr, filter, search) {
    ctx.run(`transactions = ${transactionsExpr};`);
    ctx.run(`currentTxFilter = ${JSON.stringify(filter)};`);
    ctx.renderTransactionsList(search || '');
    const listEl = elements.get('tx-list');
    return {
        items: listEl.children.map((c) => c.innerHTML),
        listHidden: elements.get('tx-list-container').classList.contains('hidden'),
        emptyHidden: elements.get('tx-empty-state').classList.contains('hidden'),
    };
}

const SAMPLE_TXS = JSON.stringify([
    { id: 't1', type: 'income', amount: 1000, category: 'Gaji / Pemasukan', description: 'Jual nasi bungkus pagi', date: '2026-01-01' },
    { id: 't2', type: 'expense', amount: 200, category: 'Belanja', description: 'Beli bahan baku dapur', date: '2026-01-02' },
]);

test('renderTransactionsList shows every transaction when filter is "all"', () => {
    const r = renderWith(SAMPLE_TXS, 'all', '');
    assert.equal(r.items.length, 2);
    assert.ok(r.items[0].includes('Jual nasi bungkus pagi'));
    assert.ok(r.items[1].includes('Beli bahan baku dapur'));
    assert.equal(r.emptyHidden, true);
    assert.equal(r.listHidden, false);
});

test('renderTransactionsList filters by transaction type', () => {
    const r = renderWith(SAMPLE_TXS, 'expense', '');
    assert.equal(r.items.length, 1);
    assert.ok(r.items[0].includes('Beli bahan baku dapur'));
    assert.ok(!r.items[0].includes('Jual nasi bungkus pagi'));
});

test('renderTransactionsList filters by search across description and category, case-insensitive', () => {
    const byDesc = renderWith(SAMPLE_TXS, 'all', 'NASI');
    assert.equal(byDesc.items.length, 1);
    assert.ok(byDesc.items[0].includes('Jual nasi bungkus pagi'));

    const byCat = renderWith(SAMPLE_TXS, 'all', 'belanja');
    assert.equal(byCat.items.length, 1);
    assert.ok(byCat.items[0].includes('Beli bahan baku dapur'));
});

test('renderTransactionsList shows the empty state when nothing matches', () => {
    const r = renderWith(SAMPLE_TXS, 'expense', 'nasi');
    assert.equal(r.items.length, 0);
    assert.equal(r.emptyHidden, false);
    assert.equal(r.listHidden, true);
});

test('setTxFilter updates the active filter and button classes', () => {
    ctx.setTxFilter('income');
    assert.equal(ctx.run('currentTxFilter'), 'income');
    assert.match(elements.get('filter-tx-income').className, /bg-violet-600/);
    assert.doesNotMatch(elements.get('filter-tx-all').className, /bg-violet-600/);
});
