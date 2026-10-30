"""Flood-fill knockout + centered HD PNG / favicon export."""

from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "ip" / "motto-b2.jpg"
OUT = ROOT / "assets" / "logo.png"
OUT_IP = ROOT / "assets" / "ip" / "motto-ip.png"
FAV32 = ROOT / "assets" / "favicon-32.png"
APPLE = ROOT / "assets" / "apple-touch-icon.png"
ICO = ROOT / "assets" / "favicon.ico"

BG_THRESH = 42.0
PAD = 0.11


def sample_bg(rgb: np.ndarray) -> np.ndarray:
    h, w, _ = rgb.shape
    patches = [rgb[:40, :40], rgb[:40, w - 40 :], rgb[h - 40 :, :40]]
    samples = np.concatenate([p.reshape(-1, 3) for p in patches], axis=0)
    return np.median(samples, axis=0).astype(np.float32)


def flood_background(rgb: np.ndarray, bg: np.ndarray) -> np.ndarray:
    h, w = rgb.shape[:2]
    dist = np.linalg.norm(rgb.astype(np.float32) - bg, axis=2)
    is_bg = dist < BG_THRESH
    seen = np.zeros((h, w), dtype=bool)
    q = deque()

    seeds = [(0, 0), (0, w - 1), (h - 1, 0)]
    for y in range(0, h, 8):
        seeds.append((y, 0))
    for x in range(0, w, 8):
        seeds.append((0, x))

    for y, x in seeds:
        if is_bg[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx] and is_bg[ny, nx]:
                seen[ny, nx] = True
                q.append((ny, nx))
    return seen


def edge_aa(mask_fg: np.ndarray) -> np.ndarray:
    """1px antialias only — keep interior fully opaque."""
    fg = mask_fg.astype(np.float32)
    h, w = fg.shape
    padded = np.pad(fg, 1, mode="edge")
    acc = np.zeros_like(fg)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            acc += padded[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w]
    ring = (acc > 0) & (acc < 9) & (~mask_fg)
    alpha = np.where(mask_fg, 1.0, 0.0)
    alpha[ring] = acc[ring] / 9.0
    return alpha


def knockout(img: Image.Image) -> Image.Image:
    rgb = np.array(img.convert("RGB"), dtype=np.float32)
    bg = sample_bg(rgb)
    bg_mask = flood_background(rgb, bg)
    fg_mask = ~bg_mask
    alpha = edge_aa(fg_mask)

    a = np.maximum(alpha, 1e-5)[..., None]
    fg = (rgb - (1.0 - a) * bg) / a
    fg = np.clip(fg, 0, 255)

    out = np.zeros((rgb.shape[0], rgb.shape[1], 4), dtype=np.uint8)
    out[..., :3] = np.round(fg).astype(np.uint8)
    out[..., 3] = np.round(alpha * 255).astype(np.uint8)
    out[alpha <= 0.04] = 0
    return Image.fromarray(out, "RGBA")


def center_square(img: Image.Image) -> Image.Image:
    bbox = img.getbbox()
    if not bbox:
        return img
    cropped = img.crop(bbox)
    w, h = cropped.size
    side = int(round(max(w, h) / (1.0 - 2 * PAD)))
    side = max(side, w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(cropped, ((side - w) // 2, (side - h) // 2), cropped)
    return canvas


def save_ico(src: Image.Image, path: Path) -> None:
    sizes = [(16, 16), (32, 32), (48, 48)]
    frames = [src.resize(s, Image.Resampling.BOX) for s in sizes]
    frames[0].save(path, format="ICO", sizes=sizes, append_images=frames[1:])


def main() -> None:
    logo = center_square(knockout(Image.open(SRC)))
    logo.save(OUT, "PNG", optimize=True)
    logo.save(OUT_IP, "PNG", optimize=True)

    apple = Image.new("RGBA", (180, 180), (18, 18, 18, 255))
    mark = logo.resize((148, 148), Image.Resampling.BOX)
    apple.paste(mark, ((180 - 148) // 2, (180 - 148) // 2), mark)
    apple.save(APPLE, "PNG", optimize=True)

    fav = logo.resize((32, 32), Image.Resampling.BOX)
    fav.save(FAV32, "PNG", optimize=True)
    save_ico(logo, ICO)

    print(f"logo {logo.size} -> {OUT}")
    print(f"favicon {ICO}")
    print(f"apple {APPLE}")


if __name__ == "__main__":
    main()
