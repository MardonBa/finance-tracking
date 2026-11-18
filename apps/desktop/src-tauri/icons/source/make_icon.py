"""Draws the app icon: an 8-bit $100 bill floating over the pixel-waves sea.

64x64 pixel grid, scaled 16x to a 1024x1024 PNG (no dependencies).
Regenerate the Tauri icon set from it with:
    python3 src-tauri/icons/source/make_icon.py
    npx tauri icon src-tauri/icons/source/icon-1024.png
"""
import math
import os
import struct
import zlib

N = 64
SCALE = 16

# Palette: from ui/tokens.css and the pixel-waves scene.
CLEAR = None
NAVY = (0x14, 0x23, 0x3F)
SKY = (0xF4, 0xEC, 0xD8)
CLOUD = (0xFB, 0xF6, 0xEA)
CLOUD_SHADE = (0xE9, 0xDC, 0xC0)
FOAM = (0xFF, 0xFF, 0xFF)
WAVE = [(0x8C, 0xC4, 0xF0), (0x5C, 0x9F, 0xE3), (0x3F, 0x7F, 0xD0),
        (0x2A, 0x62, 0xB5), (0x1D, 0x4C, 0x9E), (0x14, 0x3C, 0x85), (0x0D, 0x2B, 0x66)]
G_DARK = (0x1F, 0x4A, 0x35)
G_MID = (0x3F, 0x7A, 0x3A)
G_SOFT = (0x8F, 0xB8, 0x7F)
G_PAPER = (0xD6, 0xE6, 0xC0)
G_LIGHT = (0xEE, 0xF5, 0xE2)

px = [[CLEAR] * N for _ in range(N)]


def put(x, y, c):
    if 0 <= x < N and 0 <= y < N:
        px[y][x] = c


def rect(x, y, w, h, c):
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            put(xx, yy, c)


# ---- Tile: rounded pixel square with a navy outline and hard offset shadow,
# like the app's raised windows.
T0, T1 = 5, 56  # tile spans T0..T1 inclusive
SH = 2          # shadow offset


def in_tile(x, y, x0, x1):
    if not (x0 <= x <= x1 and x0 <= y <= x1):
        return False
    # stair-step corners
    cut = [3, 1, 1]
    for i, c in enumerate(cut):
        for (cx, cy, dx, dy) in ((x0, x0, 1, 1), (x1, x0, -1, 1), (x0, x1, 1, -1), (x1, x1, -1, -1)):
            if y == cy + dy * i and (x - cx) * dx < c:
                return False
    return True


for y in range(N):
    for x in range(N):
        if in_tile(x - SH, y - SH, T0, T1):
            put(x, y, NAVY)
for y in range(N):
    for x in range(N):
        if in_tile(x, y, T0, T1):
            put(x, y, NAVY)
        if in_tile(x, y, T0 + 1, T1 - 1):
            put(x, y, SKY)


def in_inner(x, y):
    return in_tile(x, y, T0 + 1, T1 - 1)


# ---- Clouds
def cloud(x, y, w):
    rect(x, y + 1, w, 3, CLOUD)
    rect(x + 2, y - 1, w // 2, 2, CLOUD)
    rect(x + w // 2, y - 2, w // 3, 2, CLOUD)
    rect(x, y + 4, w, 1, CLOUD_SHADE)


cloud(9, 11, 12)
cloud(38, 9, 10)

# ---- Sea: a light back wave and a darker front wave, foam on the crests.
def wave_layer(base, amp, period, phase, shades):
    for y in range(N):
        for x in range(N):
            if not in_inner(x, y):
                continue
            crest = base + round(amp * math.sin((x + phase) * 2 * math.pi / period))
            if y < crest:
                continue
            d = y - crest
            if d == 0:
                nxt = base + round(amp * math.sin((x + 1 + phase) * 2 * math.pi / period))
                prv = base + round(amp * math.sin((x - 1 + phase) * 2 * math.pi / period))
                put(x, y, FOAM if crest <= min(nxt, prv) else shades[0])
            else:
                put(x, y, shades[min(len(shades) - 1, 1 + (d - 1) // 3)])


wave_layer(42, 1.5, 16, 0, WAVE[0:4])
wave_layer(47, 1.5, 20, 9, WAVE[1:])

# ---- The bill: 44x22, bobbing just above the sea.
BX, BY, BW, BH = 11, 17, 40, 20
# shadow on the water/sky
for y in range(BY + 1, BY + BH + 1):
    for x in range(BX + 1, BX + BW + 1):
        if in_inner(x, y):
            put(x, y, NAVY)
rect(BX, BY, BW, BH, G_DARK)
rect(BX + 1, BY + 1, BW - 2, BH - 2, G_MID)
rect(BX + 2, BY + 2, BW - 4, BH - 4, G_PAPER)
# inner frame line
for x in range(BX + 3, BX + BW - 3):
    put(x, BY + 3, G_SOFT)
    put(x, BY + BH - 4, G_SOFT)
for y in range(BY + 3, BY + BH - 3):
    put(BX + 3, y, G_SOFT)
    put(BX + BW - 4, y, G_SOFT)

# center portrait oval
OX, OY, OW, OH = BX + 16, BY + 2, 8, 16


def ellipse(x0, y0, w, h, c):
    for y in range(h):
        for x in range(w):
            nx = (x + 0.5 - w / 2) / (w / 2)
            ny = (y + 0.5 - h / 2) / (h / 2)
            if nx * nx + ny * ny <= 1.15:
                put(x0 + x, y0 + y, c)


ellipse(OX, OY, OW, OH, G_DARK)
ellipse(OX + 1, OY + 1, OW - 2, OH - 2, G_LIGHT)
# portrait: head + shoulders
rect(OX + 3, OY + 4, 2, 1, G_SOFT)
rect(OX + 2, OY + 5, 4, 4, G_SOFT)
rect(OX + 3, OY + 9, 2, 1, G_SOFT)
rect(OX + 1, OY + 10, 6, 3, G_SOFT)
rect(OX + 3, OY + 4, 2, 1, G_MID)  # hair
rect(OX + 2, OY + 5, 1, 2, G_MID)

# 3x5 digits for "100"
FONT = {
    "1": ["010", "110", "010", "010", "111"],
    "0": ["111", "101", "101", "101", "111"],
}


def text(s, x, y, c):
    for i, ch in enumerate(s):
        for r, row in enumerate(FONT[ch]):
            for k, bit in enumerate(row):
                if bit == "1":
                    put(x + i * 4 + k, y + r, c)


text("100", BX + 4, BY + 4, G_DARK)
text("100", BX + BW - 15, BY + BH - 9, G_DARK)

# round seals in the other two corners
def seal(cx, cy):
    rect(cx - 1, cy - 2, 3, 5, G_SOFT)
    rect(cx - 2, cy - 1, 5, 3, G_SOFT)
    put(cx, cy, G_MID)


seal(BX + 8, BY + BH - 7)
seal(BX + BW - 9, BY + 6)

# ---- Write PNG (RGBA, nearest-neighbour scale)
def write_png(path, scale):
    size = N * scale
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        row = px[y // scale]
        for x in range(size):
            c = row[x // scale]
            raw += bytes((0, 0, 0, 0)) if c is None else bytes((*c, 255))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


here = os.path.dirname(os.path.abspath(__file__))
write_png(os.path.join(here, "icon-1024.png"), SCALE)
