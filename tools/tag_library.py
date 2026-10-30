#!/usr/bin/env python3
"""Write ID3 tags (artist, title, album) for tracks missing metadata."""

from __future__ import annotations

import re
from pathlib import Path

from mutagen.id3 import ID3, TALB, TIT2, TPE1
from mutagen.mp3 import MP3

ROOT = Path(__file__).resolve().parents[1]
MUSIC = ROOT / "music"


def safe(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def artist_from_path(path: Path) -> str | None:
    rel = path.relative_to(MUSIC)
    parts = rel.parts
    if len(parts) >= 2:
        return parts[0]
    return None


def title_from_name(name: str) -> str:
    return safe(Path(name).stem)


def tag_file(path: Path) -> bool:
    artist = artist_from_path(path)
    if not artist:
        return False
    title = title_from_name(path.name)
    album = safe(path.parent.name) if path.parent != MUSIC / artist else "Singles"

    audio = MP3(path, ID3=ID3)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    cur_artist = str(tags.get("TPE1", "")) if tags.get("TPE1") else ""
    if cur_artist and cur_artist.lower() not in ("unknown", "unknown artist", ""):
        return False

    tags["TPE1"] = TPE1(encoding=3, text=artist)
    tags["TIT2"] = TIT2(encoding=3, text=title)
    tags["TALB"] = TALB(encoding=3, text=album)
    audio.save()
    print(f"tagged: {artist} — {title}")
    return True


def main() -> None:
    count = 0
    for mp3 in MUSIC.rglob("*.mp3"):
        if tag_file(mp3):
            count += 1
    print(f"Done. {count} file(s) tagged.")


if __name__ == "__main__":
    main()
