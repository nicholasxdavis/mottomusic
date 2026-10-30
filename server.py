import http.server
import json
import os
import re
import socketserver
import sys
import urllib.parse
import urllib.request
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools"))
from lyrics_api import resolve_lyrics

PORT = 8080
DIR = os.path.dirname(os.path.abspath(__file__))
AUDIO_EXT = re.compile(r"\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|mp4|aiff|aif)$", re.I)


COVER_CACHE: dict[str, str] = {}


def fetch_itunes_cover(artist: str, title: str) -> str | None:
    key = f"{artist}|{title}"
    if key in COVER_CACHE:
        return COVER_CACHE[key]
    params = urllib.parse.urlencode(
        {"term": f"{artist} {title}", "entity": "song", "limit": "1", "country": "US"}
    )
    try:
        with urllib.request.urlopen(
            f"https://itunes.apple.com/search?{params}", timeout=15
        ) as resp:
            data = json.loads(resp.read().decode())
        hit = (data.get("results") or [None])[0]
        if not hit or not hit.get("artworkUrl100"):
            return None
        url = re.sub(r"/\d+x\d+bb\.", "/600x600bb.", hit["artworkUrl100"])
        COVER_CACHE[key] = url
        return url
    except Exception:
        return None


def scan_music(root, base="music"):
    out = []
    music_dir = os.path.join(root, base)
    if not os.path.isdir(music_dir):
        return out
    for dirpath, _, filenames in os.walk(music_dir):
        for name in filenames:
            if AUDIO_EXT.search(name):
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, root).replace("\\", "/")
                out.append({"path": rel, "name": name})
    return out


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        path_only = self.path.split("?")[0]
        if path_only == "/api/library":
            data = json.dumps(scan_music(DIR)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path_only == "/api/manifest":
            manifest = os.path.join(DIR, "music", "import", "manifest.json")
            if os.path.isfile(manifest):
                with open(manifest, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            else:
                self.send_response(404)
                self.end_headers()
            return
        if path_only == "/api/cover":
            qs = parse_qs(urlparse(self.path).query)
            artist = (qs.get("artist") or [""])[0]
            title = (qs.get("title") or [""])[0]
            url = fetch_itunes_cover(artist, title) or fetch_itunes_cover(
                artist, re.sub(r"\s*\([^)]*\)", "", title).strip()
            )
            data = json.dumps({"url": url}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "public, max-age=86400")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path_only == "/api/lyrics":
            qs = parse_qs(urlparse(self.path).query)
            artist = (qs.get("artist") or [""])[0]
            title = (qs.get("title") or [""])[0]
            duration = int((qs.get("duration") or ["0"])[0] or 0)
            data = json.dumps(resolve_lyrics(artist, title, duration)).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return super().do_GET()

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()


class LocalOnly(socketserver.TCPServer):
    allow_reuse_address = True

    def server_bind(self):
        self.socket.setsockopt(socketserver.socket.SOL_SOCKET, socketserver.socket.SO_REUSEADDR, 1)
        super().server_bind()

    def verify_request(self, request, client_address):
        host = client_address[0]
        return host in ("127.0.0.1", "::1")


if __name__ == "__main__":
    with LocalOnly(("127.0.0.1", PORT), Handler) as httpd:
        print(f"Motto at http://localhost:{PORT}")
        print("Private to this PC. Other devices on the network cannot open it.")
        httpd.serve_forever()
