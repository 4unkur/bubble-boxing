#!/usr/bin/env python3
"""Local web server for this game (serves the game folder, one level above tools/).

Usage: server.py <port> [idle_seconds]
- Sends Cache-Control: no-store, so Chrome always loads the latest game files.
- idle_seconds > 0: exit after that long with no requests (the launcher apps use this,
  since a game only talks to the server while loading).
"""
import http.server
import os
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1])
IDLE = float(sys.argv[2]) if len(sys.argv) > 2 else 0
GAME = os.path.basename(ROOT)
last_request = time.time()


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        global last_request
        last_request = time.time()
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-KidGame", GAME)  # lets the launcher check its own server is running
        super().end_headers()

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)


def stop_when_idle():
    while True:
        time.sleep(60)
        if time.time() - last_request > IDLE:
            server.shutdown()
            return


if IDLE > 0:
    threading.Thread(target=stop_when_idle, daemon=True).start()
server.serve_forever()
