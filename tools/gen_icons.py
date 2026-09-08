#!/usr/bin/env python3
"""Generate simple PNG app icons with no third-party deps."""
import struct, zlib, os

def png(path, size, draw):
    px = bytearray()
    for y in range(size):
        px.append(0)  # filter type 0
        for x in range(size):
            r, g, b, a = draw(x, y, size)
            px += bytes((r, g, b, a))
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(px), 9)
    with open(path, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))

BG = (0x11, 0x18, 0x27)      # slate-900
BLUE = (0x38, 0x82, 0xf6)    # blue-500
AMBER = (0xf5, 0x9e, 0x0b)   # amber-500

def draw(x, y, s):
    # rounded-ish: keep full square (iOS masks it). diagonal split + circle.
    t = x + y
    base = BLUE if t < s else AMBER
    # center circle
    cx, cy = s / 2, s / 2
    d = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5
    if d < s * 0.20:
        return (*BG, 255)
    if d < s * 0.30:
        return (255, 255, 255, 255)
    return (*base, 255)

here = os.path.dirname(__file__)
out = os.path.join(here, "..", "icons")
for sz in (180, 192, 512):
    png(os.path.join(out, f"icon-{sz}.png"), sz, draw)
    print("wrote", f"icon-{sz}.png")
