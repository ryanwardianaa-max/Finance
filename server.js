const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 8000;

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

const server = http.createServer((req, res) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);

    // Normalisasikan URL request path
    let filePath = req.url === '/' ? './index.html' : '.' + req.url;
    
    // Hilangkan parameter query string jika ada (?action=...)
    filePath = filePath.split('?')[0];

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
