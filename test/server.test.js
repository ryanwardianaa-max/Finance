const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');

const { createServer } = require('../server.js');

const ROOT = path.join(__dirname, '..');
let server;
let port;

before(async () => {
    server = createServer();
    await new Promise((resolve) => server.listen(0, 'localhost', resolve));
    port = server.address().port;
});

after(() => new Promise((resolve) => server.close(resolve)));

function get(urlPath) {
    return new Promise((resolve, reject) => {
        http.get(`http://localhost:${port}${urlPath}`, (res) => {
            let body = '';
            res.on('data', (c) => (body += c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
    });
}

// Raw TCP request so the server receives an un-normalized path (http.get would
// be free to rewrite ".." before it is sent).
function rawGet(requestTarget) {
    return new Promise((resolve, reject) => {
        const sock = net.connect(port, 'localhost', () => {
            sock.write(`GET ${requestTarget} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        });
        let data = '';
        sock.on('data', (c) => (data += c));
        sock.on('error', reject);
        sock.on('end', () => {
            const statusLine = data.split('\r\n')[0];
            const body = data.slice(data.indexOf('\r\n\r\n') + 4);
            resolve({ statusLine, body });
        });
    });
}

test('GET / serves index.html as text/html', async () => {
    const res = await get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/);
    assert.equal(res.body, fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));
});

test('GET /app.js serves the client script as text/javascript', async () => {
    const res = await get('/app.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/javascript/);
    assert.equal(res.body, fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
});

test('query strings are stripped before file lookup', async () => {
    const res = await get('/app.js?action=read');
    assert.equal(res.status, 200);
    assert.equal(res.body, fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8'));
});

test('unmapped extensions fall back to application/octet-stream', async () => {
    const res = await get('/run.bat');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^application\/octet-stream/);
});

test('missing files return 404', async () => {
    const res = await get('/does-not-exist.js');
    assert.equal(res.status, 404);
    assert.match(res.body, /404/);
});

test('path traversal is rejected with 403 and never leaks file contents', async () => {
    for (const target of ['/../server.js', '/../../server.js', '/../../../etc/passwd', '/..\\..\\server.js']) {
        const res = await rawGet(target);
        assert.equal(res.statusLine, 'HTTP/1.1 403 Forbidden', `traversal ${target} must be 403`);
        assert.ok(!res.body.includes('root:x:'), `traversal ${target} must not leak /etc/passwd`);
        assert.ok(!res.body.includes('const http'), `traversal ${target} must not leak server.js`);
    }
});

test('percent-encoded traversal is not decoded into content', async () => {
    const res = await rawGet('/..%2f..%2f..%2fetc/passwd');
    assert.equal(res.statusLine, 'HTTP/1.1 403 Forbidden');
    assert.ok(!res.body.includes('root:x:'));
});

test('files inside the web root still serve normally (positive control)', async () => {
    const res = await get('/server.js');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/javascript/);
    assert.equal(res.body, fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8'));
});
