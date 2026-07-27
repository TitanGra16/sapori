const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.resolve(root, `.${pathname}`);
  if (filePath !== root && !filePath.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    response.end(content);
  });
}).listen(port, '127.0.0.1', () => {
  console.log(`Sapori test server listening on http://127.0.0.1:${port}`);
});
