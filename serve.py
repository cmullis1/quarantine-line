"""Serve the game locally: python serve.py  ->  http://localhost:28802"""
import functools
import http.server
import os

PORT = 28802
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(Handler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Quarantine Line on http://localhost:{PORT}")
        httpd.serve_forever()
