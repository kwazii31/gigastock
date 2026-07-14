const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8000);
const HOST = "127.0.0.1";
const REMOTE_STOCK_URL = "https://api.growagarden2wiki.net/api/v1/games/grow-a-garden-2/stock";
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function proxyStock(res) {
  const request = https.request(
    REMOTE_STOCK_URL,
    {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
        Origin: "https://growagarden2wiki.net",
        Referer: "https://growagarden2wiki.net/stock/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
      }
    },
    (upstream) => {
      let body = "";
      upstream.setEncoding("utf8");
      upstream.on("data", (chunk) => {
        body += chunk;
      });
      upstream.on("end", () => {
        const status = upstream.statusCode || 502;
        const contentType = upstream.headers["content-type"] || "application/json; charset=utf-8";
        send(res, status, body, contentType);
      });
    }
  );

  request.on("error", (error) => {
    const payload = JSON.stringify({
      error: "proxy_request_failed",
      message: error.message
    });
    send(res, 502, payload, "application/json; charset=utf-8");
  });

  request.end();
}

function serveFile(urlPath, res) {
  const safePath = urlPath === "/" ? "/index.html" : urlPath;
  const absolute = path.join(ROOT, safePath);
  const normalized = path.normalize(absolute);

  if (!normalized.startsWith(ROOT)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.stat(normalized, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(res, 404, "Not found");
      return;
    }

    const ext = path.extname(normalized).toLowerCase();
    const contentType = MIME[ext] || "application/octet-stream";

    fs.readFile(normalized, (readError, data) => {
      if (readError) {
        send(res, 500, "Failed to read file");
        return;
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-store"
      });
      res.end(data);
    });
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/gag2-stock.json") {
    proxyStock(res);
    return;
  }

  serveFile(url.pathname, res);
});

server.listen(PORT, HOST, () => {
  console.log(`GAG2 dev server running at http://${HOST}:${PORT}`);
  console.log("Serves static tracker files and proxies /api/gag2-stock.json");
});
