const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Load Code.gs (a Google Apps Script backend) inside a Node VM with stubbed
// Apps Script services so the request-handling logic can be tested.
function loadCodeGs() {
    const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

    let rows = [];
    let lastResponse = null;

    const sheet = () => ({
        getDataRange: () => ({ getValues: () => rows }),
        appendRow: (row) => rows.push(row),
        deleteRow: (index) => rows.splice(index - 1, 1),
        getRange: () => ({
            setFontWeight: () => ({ setBackground: () => ({ setHorizontalAlignment: () => ({}) }) }),
        }),
    });

    const sandbox = {
        console,
        SpreadsheetApp: {
            getActiveSpreadsheet: () => ({ getSheetByName: () => sheet() }),
        },
        LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
        Utilities: { getUuid: () => 'uuid-0001' },
        ContentService: {
            MimeType: { JSON: 'application/json' },
            createTextOutput: (text) => {
                lastResponse = { text, mime: null };
                return {
                    setMimeType(mime) {
                        lastResponse.mime = mime;
                        return this;
                    },
                };
            },
        },
    };

    vm.createContext(sandbox);
    vm.runInContext(code, sandbox, { filename: 'Code.gs' });

    sandbox.setRows = (r) => { rows = r; };
    sandbox.getRows = () => rows;
    sandbox.run = (expr) => vm.runInContext(expr, sandbox, { filename: 'codegs-test.js' });
    sandbox.lastResponse = () => JSON.parse(lastResponse.text);
    return sandbox;
}

const HEADER = ['ID', 'Date', 'User Email', 'Amount', 'Category', 'Type', 'Description'];

let ctx;

beforeEach(() => {
    ctx = loadCodeGs();
});

function post(contents) {
    const e = contents === undefined ? {} : { postData: { contents } };
    ctx.doPost(e);
    return ctx.lastResponse();
}

// ---------------------------------------------------------------
// doGet — read transactions
// ---------------------------------------------------------------
test('doGet rejects requests without an email', () => {
    ctx.doGet({ parameter: {} });
    const res = ctx.lastResponse();
    assert.equal(res.status, 'error');
    assert.match(res.message, /email/i);
});

test('doGet returns only the requesting user rows with ISO dates, newest first', () => {
    // Dates must be created inside the VM realm: a test-realm Date fails
    // `instanceof Date` there, which would skip the real formatting branch.
    const VMDate = ctx.run('Date');
    ctx.setRows([
        HEADER,
        ['a1', new VMDate('2026-01-01'), 'one@x.com', 5000, 'Food', 'expense', 'lunch'],
        ['a2', '2026-01-05', 'two@x.com', 1000, 'Rent', 'income', 'rent'],
        ['a3', new VMDate('2026-01-03'), 'one@x.com', 7000, 'Food', 'income', 'snacks'],
        ['a4', new VMDate('2026-02-01'), 'one@x.com', 'oops', 'Other', 'expense', 'bad amount'],
    ]);

    ctx.doGet({ parameter: { email: 'one@x.com' } });
    const res = ctx.lastResponse();
    assert.equal(res.status, 'success');
    assert.equal(res.data.length, 3);

    // Transaction 'a4' dated 2026-02-01 sorts first, then 2026-01-03, then 2026-01-01
    assert.deepEqual(res.data.map((t) => t.id), ['a4', 'a3', 'a1']);
    assert.equal(res.data[0].date, '2026-02-01');
    assert.equal(res.data[1].date, '2026-01-03');
    // Date objects are normalized to YYYY-MM-DD
    assert.equal(res.data[2].date, '2026-01-01');
    // Unparsable amounts fall back to 0
    assert.equal(res.data[0].amount, 0);
    assert.equal(res.data[2].amount, 5000);
    // Other users' rows never leak into the response
    assert.ok(!res.data.some((t) => t.email !== 'one@x.com'));
});

test('doGet preserves string dates as-is', () => {
    ctx.setRows([
        HEADER,
        ['a1', '2026-03-15', 'one@x.com', 10, 'Food', 'expense', 'd'],
    ]);
    ctx.doGet({ parameter: { email: 'one@x.com' } });
    const res = ctx.lastResponse();
    assert.equal(res.data[0].date, '2026-03-15');
});

// ---------------------------------------------------------------
// doPost — addTransaction
// ---------------------------------------------------------------
test('doPost rejects an empty body', () => {
    const res = post(undefined);
    assert.equal(res.status, 'error');
    assert.match(res.message, /body/i);
});

test('doPost rejects invalid JSON with a 500-style error', () => {
    const res = post('{not json');
    assert.equal(res.status, 'error');
});

test('doPost adds a transaction with provided values', () => {
    const res = post(JSON.stringify({
        action: 'addTransaction',
        email: 'a@x.com',
        amount: '7500',
        date: '2026-04-01',
        category: 'Food',
        type: 'income',
        description: 'Sells',
    }));
    assert.equal(res.status, 'success');
    assert.equal(res.data.id, 'uuid-0001');
    assert.equal(res.data.amount, 7500);
    assert.equal(ctx.getRows().length, 1);
});

test('doPost addTransaction fills defaults for missing fields', () => {
    const res = post(JSON.stringify({ action: 'addTransaction', email: 'a@x.com' }));
    assert.equal(res.status, 'success');
    assert.match(res.data.date, /^\d{4}-\d{2}-\d{2}$/); // defaults to today
    assert.equal(res.data.amount, 0);
    assert.equal(res.data.category, 'Lainnya');
    assert.equal(res.data.type, 'expense');
    assert.equal(res.data.description, '');
});

test('doPost addTransaction requires an email', () => {
    const res = post(JSON.stringify({ action: 'addTransaction', amount: '100' }));
    assert.equal(res.status, 'error');
    assert.equal(ctx.getRows().length, 0);
});

// ---------------------------------------------------------------
// doPost — deleteTransaction
// ---------------------------------------------------------------
test('doPost deletes a transaction owned by the requesting email', () => {
    ctx.setRows([
        HEADER,
        ['t1', '2026-01-01', 'a@x.com', 100, 'Food', 'expense', 'd'],
        ['t2', '2026-01-02', 'b@x.com', 200, 'Food', 'expense', 'd'],
    ]);
    const res = post(JSON.stringify({ action: 'deleteTransaction', id: 't1', email: 'a@x.com' }));
    assert.equal(res.status, 'success');
    assert.equal(ctx.getRows().length, 2); // header + remaining row
    assert.equal(ctx.getRows()[1][0], 't2');
});

test('doPost refuses to delete another user transaction', () => {
    ctx.setRows([
        HEADER,
        ['t1', '2026-01-01', 'a@x.com', 100, 'Food', 'expense', 'd'],
    ]);
    const res = post(JSON.stringify({ action: 'deleteTransaction', id: 't1', email: 'b@x.com' }));
    assert.equal(res.status, 'error');
    assert.match(res.message, /hak akses|ditemukan/i);
    assert.equal(ctx.getRows().length, 2); // nothing deleted
});

test('doPost deleteTransaction requires id and email', () => {
    const res = post(JSON.stringify({ action: 'deleteTransaction', email: 'a@x.com' }));
    assert.equal(res.status, 'error');
});

test('doPost rejects unknown actions', () => {
    const res = post(JSON.stringify({ action: 'explode', email: 'a@x.com' }));
    assert.equal(res.status, 'error');
    assert.match(res.message, /aksi/i);
});
