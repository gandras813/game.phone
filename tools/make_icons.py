#!/usr/bin/env python3
"""Render Emberwing's app icons.

Pure standard library: shapes are defined in a normalised 0..1 space and
rasterised with 3x3 supersampling, then written out as PNG. Run it after
changing the artwork:  python3 tools/make_icons.py
"""

import math
import os
import struct
import zlib

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

# ---------------------------------------------------------------- artwork
HEAD = [
    (0.205, 0.430), (0.250, 0.330), (0.375, 0.285), (0.520, 0.302),
    (0.680, 0.350), (0.860, 0.430), (0.868, 0.500), (0.700, 0.540),
    (0.560, 0.585), (0.430, 0.648), (0.300, 0.660), (0.215, 0.590),
    (0.180, 0.500),
]
HORN_BIG = [(0.400, 0.300), (0.075, 0.115), (0.150, 0.230), (0.262, 0.332)]
HORN_SMALL = [(0.300, 0.372), (0.040, 0.270), (0.120, 0.352), (0.250, 0.412)]
MOUTH = [
    (0.855, 0.480), (0.660, 0.520), (0.470, 0.570), (0.352, 0.592),
    (0.352, 0.614), (0.470, 0.592), (0.660, 0.542), (0.855, 0.500),
]
SPIKES = [
    [(0.200, 0.445), (0.095, 0.400), (0.183, 0.515)],
    [(0.188, 0.530), (0.085, 0.520), (0.222, 0.600)],
]
NOSTRIL = (0.795, 0.462, 0.020, 0.013)
EYE = (0.430, 0.415, 0.058, 0.048)
PUPIL = (0.444, 0.415, 0.017, 0.040)
ART_SCALE = 0.88

BG_TOP = (0x33, 0x14, 0x63)
BG_BOT = (0x09, 0x05, 0x14)
GLOW = (0xA2, 0x59, 0xFF)
HEAD_TOP = (0xD2, 0x94, 0xFF)
HEAD_BOT = (0x5E, 0x22, 0xA4)
HORN = (0xFF, 0xE4, 0xA8)
EYE_C = (0xFF, 0xE0, 0x66)
DARK = (0x20, 0x06, 0x2E)


def inside(poly, x, y):
    hit = False
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if (y0 > y) != (y1 > y):
            xi = x0 + (y - y0) * (x1 - x0) / (y1 - y0)
            if x < xi:
                hit = not hit
    return hit


def in_ellipse(e, x, y):
    cx, cy, rx, ry = e
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0


def rounded(x, y, r):
    """Signed inside test for a rounded square covering the whole tile."""
    dx, dy = abs(x - 0.5) - (0.5 - r), abs(y - 0.5) - (0.5 - r)
    if dx <= 0 or dy <= 0:
        return max(dx, dy) <= 0
    return math.hypot(dx, dy) <= r


def blend(dst, src, a):
    return tuple(int(round(d + (s - d) * a)) for d, s in zip(dst, src))


def shade(top, bottom, t):
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(top, bottom))


def sample(x, y, maskable):
    """Colour + alpha at a normalised point."""
    if not maskable and not rounded(x, y, 0.22):
        return None

    col = shade(BG_TOP, BG_BOT, min(1.0, max(0.0, (y - 0.05) / 0.95)))
    # soft glow behind the head
    d = math.hypot((x - 0.5) * 1.05, (y - 0.46))
    col = blend(col, GLOW, max(0.0, 0.42 * (1 - min(1.0, d / 0.52)) ** 2))

    # Shrink the artwork for breathing room (and again for the maskable safe zone).
    art = ART_SCALE * (0.74 if maskable else 1.0)
    x = 0.5 + (x - 0.5) / art
    y = 0.5 + (y - 0.5) / art
    if not (-0.05 < x < 1.05 and -0.05 < y < 1.05):
        return col

    for poly in SPIKES:
        if inside(poly, x, y):
            col = blend(col, HEAD_BOT, 1.0)
    for poly in (HORN_BIG, HORN_SMALL):
        if inside(poly, x, y):
            col = shade(HORN, (0xC9, 0x9A, 0x55), (y - 0.12) / 0.4)
    if inside(HEAD, x, y):
        col = shade(HEAD_TOP, HEAD_BOT, min(1.0, max(0.0, (y - 0.27) / 0.42)))
        if inside(MOUTH, x, y):
            col = blend(col, DARK, 0.62)
        if in_ellipse(NOSTRIL, x, y):
            col = blend(col, DARK, 0.6)
        if in_ellipse(EYE, x, y):
            col = DARK
            inner = (EYE[0] + 0.004, EYE[1], EYE[2] * 0.78, EYE[3] * 0.78)
            if in_ellipse(inner, x, y):
                col = EYE_C
                if in_ellipse(PUPIL, x, y):
                    col = DARK
    return col


def render(size, maskable=False, ss=3):
    px = bytearray(size * size * 4)
    step = 1.0 / (size * ss)
    for j in range(size):
        for i in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (i * ss + sx + 0.5) * step
                    y = (j * ss + sy + 0.5) * step
                    c = sample(x, y, maskable)
                    if c is not None:
                        r += c[0]; g += c[1]; b += c[2]; a += 255
            n = ss * ss
            o = (j * size + i) * 4
            if a:
                cover = a / (255 * n)
                px[o] = min(255, round(r / (a / 255)))
                px[o + 1] = min(255, round(g / (a / 255)))
                px[o + 2] = min(255, round(b / (a / 255)))
                px[o + 3] = round(cover * 255)
    return px


def write_png(path, size, px):
    raw = b"".join(b"\x00" + bytes(px[y * size * 4:(y + 1) * size * 4]) for y in range(size))

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    print(f"{os.path.relpath(path)}  {size}x{size}  {len(png) / 1024:.1f} KB")


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, name, maskable in [
        (512, "icon-512.png", False),
        (192, "icon-192.png", False),
        (180, "apple-touch-icon.png", False),
        (512, "maskable-512.png", True),
    ]:
        write_png(os.path.join(OUT, name), size, render(size, maskable))


if __name__ == "__main__":
    main()
