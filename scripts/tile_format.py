#!/usr/bin/env python3
"""Shared writer for the split building chunks and road file.

The browser only ever downloads small spatial chunks. Each building chunk is a
standalone ``DB3C`` file: a tiny header followed by the same packed tile body
that the old monolithic ``DB3B`` file used. Building data is deliberately
written uncompressed so no browser needs ``DecompressionStream`` and the CDN
never has to deal with a ``.gz`` file that already carries a gzip payload.
"""

import json
import math
import struct
import time
from pathlib import Path

TILE_Q = 0.25
MAX_BODY = 560 * 1024  # keep every chunk comfortably below the 600 kB target

# Keep in sync with src/core/config.js.
CENTER_LON = 55.2722
CENTER_LAT = 25.1968


def _ring_area(ring):
    a = 0.0
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return abs(a) * 0.5


def _centroid(ring):
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    return cx, cy


def _kept(rings, h, cx, cy, m_lat, m_lon, lon0, lat0):
    """Drop the least visible clutter in the outskirts of the survey."""
    if not rings or len(rings[0]) < 3:
        return False
    wdx = (cx - (CENTER_LON - lon0) * m_lon)
    wdz = -(cy - (CENTER_LAT - lat0) * m_lat)
    dist = math.hypot(wdx, wdz)
    if dist <= 5000:
        return True
    area = _ring_area(rings[0])
    if dist > 16000:
        return not (area < 260.0 and h < 16.0)
    if dist > 10000:
        return not (area < 120.0 and h < 12.0)
    return not (area < 70.0 and h < 9.0)


def _simplify_ring(ring, max_points):
    """Very small helper for distant footprints: keep the extreme points."""
    if len(ring) <= max_points:
        return ring
    step = len(ring) / max_points
    out = [ring[int(i * step)] for i in range(max_points)]
    return out


def _body_size(items):
    nb = len(items)
    nrings = 0
    nverts = 0
    for rings, _h, _ft, _seed in items:
        nrings += len(rings)
        for r in rings:
            nverts += len(r)
    return 12 + 4 * (nb + 1) + 4 * nrings + 4 * (nrings + 1) + 4 * nverts + 2 * nb + 4 * nb


def _encode_body(items, ox, oy):
    nb = len(items)
    bld_ring_start = [0]
    ring_idx = []
    ring_vstart = []
    verts = []
    heights = []
    metas = []
    for rings, h, ft, seed in items:
        for ring in rings:
            ring_idx.append(len(ring_vstart))
            ring_vstart.append(len(verts) // 2)
            for x, y in ring:
                verts.append(int(round((x - ox) / TILE_Q)))
                verts.append(int(round((y - oy) / TILE_Q)))
        heights.append(int(round(h * 10)))
        metas.append((ft & 0xF) | ((seed & 0xFFF) << 4) | ((len(rings) - 1) << 16))
        bld_ring_start.append(len(ring_idx))

    body = bytearray()
    body += struct.pack("<Iff", nb, ox, oy)
    body += struct.pack("<%dI" % len(bld_ring_start), *bld_ring_start)
    body += struct.pack("<%dI" % len(ring_idx), *ring_idx)
    body += struct.pack("<%dI" % (len(ring_vstart) + 1), *ring_vstart, len(verts) // 2)
    body += struct.pack("<%dh" % len(verts), *verts)
    body += struct.pack("<%dH" % len(heights), *heights)
    body += struct.pack("<%dI" % len(metas), *metas)
    return bytes(body)


def write_building_chunks(buildings, out_dir, lon0, lat0, m_lat, m_lon,
                          tile_m=5000.0, log=print):
    """Write ``buildings/index.json`` plus spatial ``*.bin`` chunks.

    ``buildings`` is an iterable of ``(rings, height_m, facade, seed[, name])``
    where each ring is a list of ``(x, y)`` survey metres.
    """
    out_dir = Path(out_dir)
    chunk_dir = out_dir / "buildings"
    chunk_dir.mkdir(parents=True, exist_ok=True)
    for old in chunk_dir.glob("*.bin"):
        old.unlink()

    tiles = {}
    total = 0
    dropped = 0
    max_h = 0.0

    for item in buildings:
        rings, h, ft, seed = item[0], item[1], item[2], item[3]
        if not rings:
            continue
        cx, cy = _centroid(rings[0])
        if not _kept(rings, h, cx, cy, m_lat, m_lon, lon0, lat0):
            dropped += 1
            continue
        if h > max_h:
            max_h = h
        tx = max(0, int(cx // tile_m))
        ty = max(0, int(cy // tile_m))
        tiles.setdefault((tx, ty), []).append((rings, float(h), int(ft), int(seed)))
        total += 1

    index = []
    seq = 0
    for (tx, ty) in sorted(tiles):
        items = tiles[(tx, ty)]
        ox = tx * tile_m
        oy = ty * tile_m
        # Spatial locality inside a tile keeps split chunk bounds tight.
        items.sort(key=lambda it: (
            int(_centroid(it[0][0])[1] // 250.0),
            int(_centroid(it[0][0])[0] // 250.0),
        ))

        group = []
        group_size = _body_size(group)
        for it in items:
            one = _body_size([it])
            if group and (group_size + one - 12) > MAX_BODY:
                _flush_chunk(chunk_dir, index, group, ox, oy, seq)
                seq += 1
                group = []
                group_size = 12
            group.append(it)
            group_size += one - 12
        if group:
            _flush_chunk(chunk_dir, index, group, ox, oy, seq)
            seq += 1

    manifest = {
        "version": 2,
        "format": "DB3C",
        "generated": time.strftime("%Y-%m-%d"),
        "tileM": tile_m,
        "quant": TILE_Q,
        "origin": {"lon": lon0, "lat": lat0},
        "totalBuildings": total,
        "chunks": index,
    }
    with open(chunk_dir / "index.json", "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    largest = max((c["bytes"] for c in index), default=0)
    log("wrote %d building chunks (%d buildings, %d dropped, largest %.1f kB)"
        % (len(index), total, dropped, largest / 1024))
    return {"total": total, "chunks": len(index), "maxHeight": max_h,
            "largest": largest, "dropped": dropped}


def _flush_chunk(chunk_dir, index, group, ox, oy, seq):
    body = _encode_body(group, ox, oy)
    data = b"DB3C" + struct.pack("<If", 2, TILE_Q) + body
    if len(data) > 600 * 1024:
        raise ValueError("building chunk exceeds 600 kB: %d bytes" % len(data))

    minx = miny = float("inf")
    maxx = maxy = float("-inf")
    hmax = 0.0
    for rings, h, _ft, _seed in group:
        if h > hmax:
            hmax = h
        for ring in rings:
            for x, y in ring:
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y

    name = "c%03d.bin" % seq
    with open(chunk_dir / name, "wb") as f:
        f.write(data)
    index.append({
        "id": "c%03d" % seq,
        "file": name,
        "ox": ox,
        "oy": oy,
        "x0": round(minx, 1),
        "y0": round(miny, 1),
        "x1": round(maxx, 1),
        "y1": round(maxy, 1),
        "buildings": len(group),
        "bytes": len(data),
        "maxHeight": round(hmax, 1),
    })


def write_roads_file(roads, path, log=print):
    """Write the uncompressed ``DB3R`` road file."""
    out = bytearray()
    out += struct.pack("<4sII", b"DB3R", 1, len(roads))
    poly_start = []
    verts = []
    classes = []
    for entry in roads:
        cls, pts = entry[0], entry[1]
        poly_start.append(len(verts) // 2)
        for x, y in pts:
            verts.append(int(round(x * 10)))
            verts.append(int(round(y * 10)))
        classes.append(cls)
    poly_start.append(len(verts) // 2)
    out += struct.pack("<%dI" % len(poly_start), *poly_start)
    out += struct.pack("<%di" % len(verts), *verts)
    out += struct.pack("<%dB" % len(classes), *classes)
    with open(path, "wb") as f:
        f.write(out)
    log("wrote %s (%.1f kB, %d ways)" % (path.name, len(out) / 1024.0, len(roads)))
    return len(out)
