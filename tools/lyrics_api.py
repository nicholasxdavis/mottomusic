"""Lyrics lookup: LRCLIB -> Genius -> lyrics.ovh."""

from __future__ import annotations

import html as html_lib
import json
import re
import urllib.parse
import urllib.request

UA = "Motto/1.0"


def _get(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as resp:
        return resp.read().decode("utf-8", errors="replace")


def fetch_lrclib(artist: str, title: str, duration: int) -> dict | None:
    params = urllib.parse.urlencode(
        {
            "artist_name": artist,
            "track_name": title,
            "album_name": "",
            "duration": str(int(duration or 0)),
        }
    )
    try:
        data = json.loads(_get(f"https://lrclib.net/api/get?{params}"))
    except Exception:
        return None
    if not data.get("plainLyrics") and not data.get("syncedLyrics"):
        return None
    return {
        "plain": data.get("plainLyrics") or "",
        "synced": data.get("syncedLyrics") or "",
        "source": "lrclib",
    }


def _html_to_lyrics(raw: str) -> str:
    text = re.sub(r"<br\s*/?>", "\n", raw, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    text = html_lib.unescape(text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def scrape_genius_html(page: str) -> str:
    start = page.find('data-lyrics-container="true"')
    if start < 0:
        return ""
    chunk = page[start:]
    open_i = chunk.find(">") + 1
    end = len(chunk)
    for marker in ("Lyrics__Footer", "SongPage__Section", "RecommendedSongs__Container"):
        i = chunk.find(marker)
        if i > open_i:
            end = min(end, i)
    chunk = chunk[open_i:end]
    chunk = re.sub(
        r"<div data-exclude-from-selection[\s\S]*?</div>\s*</div>",
        "",
        chunk,
        count=1,
        flags=re.I,
    )
    plain = _html_to_lyrics(chunk)
    lines = [ln for ln in plain.split("\n") if ln.strip()]
    for i, ln in enumerate(lines):
        if ln.strip().startswith("[") or len(ln.strip()) > 20:
            return "\n".join(lines[i:]).strip()
    return plain


def fetch_genius(artist: str, title: str) -> dict | None:
    import subprocess
    from pathlib import Path

    script = Path(__file__).resolve().parent / "genius_lookup.mjs"
    try:
        proc = subprocess.run(
            ["node", str(script), artist, title],
            capture_output=True,
            text=True,
            timeout=35,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            data = json.loads(proc.stdout)
            if data.get("source") == "genius" and data.get("plain"):
                return data
    except Exception:
        pass
    return None


def fetch_ovh(artist: str, title: str) -> dict | None:
    try:
        url = f"https://api.lyrics.ovh/v1/{urllib.parse.quote(artist)}/{urllib.parse.quote(title)}"
        data = json.loads(_get(url))
    except Exception:
        return None
    lyrics = (data.get("lyrics") or "").strip()
    if not lyrics:
        return None
    return {"plain": lyrics, "synced": "", "source": "lyrics.ovh"}


def resolve_lyrics(artist: str, title: str, duration: int = 0) -> dict:
    title_clean = re.sub(r"\s*\([^)]*\)\s*", " ", title).strip()
    for a, t in ((artist, title), (artist, title_clean)):
        if not t:
            continue
        hit = fetch_lrclib(a, t, duration)
        if hit:
            return hit
        hit = fetch_genius(a, t)
        if hit:
            return hit
        hit = fetch_ovh(a, t)
        if hit:
            return hit
    return {"plain": "", "synced": "", "source": "none"}
