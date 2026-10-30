"""Distinct station marks: TIIO (outage), WTF (chaos), WFM (office)."""

from __future__ import annotations

from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets"
IMPACT = Path(r"C:\Windows\Fonts\impact.ttf")
ARIALBD = Path(r"C:\Windows\Fonts\arialbd.ttf")
AGENCY = Path(r"C:\Windows\Fonts\AGENCYB.TTF")


def font_info(path: Path) -> tuple[TTFont, object, dict, int, int]:
    font = TTFont(str(path))
    gs = font.getGlyphSet()
    cmap = font.getBestCmap()
    upm = font["head"].unitsPerEm
    cap = getattr(font["OS/2"], "sCapHeight", None) or int(upm * 0.72)
    return font, gs, cmap, upm, cap


def glyph_d(gs, cmap, ch: str) -> tuple[str, float]:
    name = cmap[ord(ch)]
    g = gs[name]
    pen = SVGPathPen(gs)
    g.draw(TransformPen(pen, (1, 0, 0, -1, 0, 0)))
    return pen.getCommands(), g.width


def word_group(path: Path, text: str, cx: float, cy: float, cap_px: float, tracking: float = 0.04, rotates: list[float] | None = None, dy: list[float] | None = None, fill: str = "#fff") -> str:
    _, gs, cmap, upm, cap = font_info(path)
    scale = cap_px / cap
    gap = upm * tracking
    glyphs = [glyph_d(gs, cmap, ch) for ch in text]
    total = sum(w for _, w in glyphs) + gap * (len(glyphs) - 1)
    x = cx - total * scale / 2
    parts = []
    for i, (d, w) in enumerate(glyphs):
        rot = rotates[i] if rotates else 0
        nudge = dy[i] if dy else 0
        gx = x + w * scale / 2
        gy = cy + nudge
        parts.append(
            f'<g transform="translate({gx:.2f} {gy:.2f}) rotate({rot}) scale({scale:.5f}) translate({-w/2:.2f} {cap/2:.2f})">'
            f'<path d="{d}" fill="{fill}"/></g>'
        )
        x += (w + gap) * scale
    return "\n    ".join(parts)


def wrap(inner: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">
  <defs>
    <clipPath id="c"><circle cx="500" cy="500" r="478"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <circle cx="500" cy="500" r="478" fill="#000"/>
    {inner}
  </g>
</svg>
'''


def tiio() -> str:
    letters = word_group(IMPACT, "TIIO", 500, 508, 236, tracking=0.02)
    inner = f'''
    <circle cx="500" cy="500" r="428" fill="none" stroke="#fff" stroke-width="28" stroke-dasharray="148 58" transform="rotate(16 500 500)"/>
    {letters}
    <line x1="232" y1="232" x2="768" y2="768" stroke="#000" stroke-width="70" stroke-linecap="square"/>
    <line x1="232" y1="232" x2="768" y2="768" stroke="#fff" stroke-width="30" stroke-linecap="square"/>
    '''
    return wrap(inner)


def wtf() -> str:
    letters = word_group(
        IMPACT, "WTF", 455, 530, 232, tracking=0.0,
        rotates=[-10, 3, 11],
        dy=[18, -28, 22],
    )
    q = word_group(AGENCY, "?", 730, 455, 150, tracking=0)
    inner = f'''
    <circle cx="500" cy="500" r="455" fill="none" stroke="#fff" stroke-width="12"/>
    {letters}
    {q}
    '''
    return wrap(inner)


def wfm() -> str:
    letters = word_group(ARIALBD, "WFM", 500, 470, 172, tracking=0.14)
    inner = f'''
    <circle cx="500" cy="500" r="450" fill="none" stroke="#fff" stroke-width="20"/>
    <circle cx="500" cy="500" r="412" fill="none" stroke="#fff" stroke-width="7"/>
    {letters}
    <rect x="378" y="640" width="46" height="72" rx="14" fill="#fff"/>
    <rect x="477" y="608" width="46" height="104" rx="14" fill="#fff"/>
    <rect x="576" y="640" width="46" height="72" rx="14" fill="#fff"/>
    '''
    return wrap(inner)


def main() -> None:
    (OUT / "radio-tiio.svg").write_text(tiio(), encoding="utf-8")
    (OUT / "radio-wtf.svg").write_text(wtf(), encoding="utf-8")
    (OUT / "radio-wfm.svg").write_text(wfm(), encoding="utf-8")
    print("wrote distinct tiio / wtf / wfm marks")


if __name__ == "__main__":
    main()
