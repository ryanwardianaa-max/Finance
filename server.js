const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8000;
const WEB_ROOT = __dirname;

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

function createServer() {
    return http.createServer((req, res) => {
        console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);

        // Normalisasikan URL request path
        let urlPath = req.url === '/' ? '/index.html' : req.url;

        // Hilangkan parameter query string jika ada (?action=...)
        urlPath = urlPath.split('?')[0];

        // Resolve path dan pastikan tetap berada di dalam WEB_ROOT (cegah path traversal)
        const filePath = path.normalize(path.join(WEB_ROOT, urlPath));
        const relativePath = path.relative(WEB_ROOT, filePath);
        if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
            res.writeHead(403, { 'Content-Type': 'text/html' });
            res.end('<h1>403 - Forbidden</h1>', 'utf-8');
            return;
        }

        const extname = String(path.extname(filePath)).toLowerCase();
        const contentType = MIME_TYPES[extname] || 'application/octet-stream';

        fs.readFile(filePath, (error, content) => {
            if (error) {
                if (error.code === 'ENOENT') {
                    res.writeHead(404, { 'Content-Type': 'text/html' });
                    res.end('<h1>404 - File Not Found</h1>', 'utf-8');
                } else {
                    res.writeHead(500);
                    res.end(`Sorry, check with the site admin for error: ${error.code} ..\n`);
                }
            } else {
                res.writeHead(200, { 'Content-Type': contentType });
                res.end(content, 'utf-8');
            }
        });
    });
}

if (require.main === module) {
    const server = createServer();
    server.listen(PORT, 'localhost', () => {
        const url = `http://localhost:${PORT}`;
        console.log(`\n==================================================`);
        console.log(`  Librayn Finance Server berjalan di: ${url}`);
        console.log(`  Tekan Ctrl+C untuk menghentikan server.`);
        console.log(`==================================================\n`);

        // Otomatis buka browser (Khusus OS Windows)
        exec(`start ${url}`, (err) => {
            if (err) {
                console.log(`Silakan buka link berikut secara manual di browser: ${url}`);
            }
        });
    });
}

module.exports = { createServer, WEB_ROOT, PORT };
