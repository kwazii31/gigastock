from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import json
import os

HOST = "127.0.0.1"
PORT = 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
REMOTE_STOCK_URL = "https://api.growagarden2wiki.net/api/v1/games/grow-a-garden-2/stock"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _proxy_stock(self):
        req = Request(
            REMOTE_STOCK_URL,
            headers={
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://growagarden2wiki.net",
                "Referer": "https://growagarden2wiki.net/stock/",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/148.0.0.0 Safari/537.36"
                ),
            },
        )

        try:
            with urlopen(req, timeout=20) as response:
                body = response.read()
                status = response.getcode()
                content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
                self.send_response(status)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
        except HTTPError as err:
            body = err.read() if hasattr(err, "read") else b""
            if body:
                self.send_response(err.code)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            else:
                self._send_json(err.code, {"error": "upstream_http_error", "message": str(err)})
        except URLError as err:
            self._send_json(502, {"error": "proxy_request_failed", "message": str(err)})

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/gag2-stock.json":
            self._proxy_stock()
            return
        super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"GAG2 dev server running at http://{HOST}:{PORT}")
    print("Serves static tracker files and proxies /api/gag2-stock.json")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
