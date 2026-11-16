#!/usr/bin/env python3
"""One-off migration from the old monolithic .bin.gz files to spatial chunks.

Reads ``public/data/buildings.bin.gz`` and ``public/data/roads.bin.gz`` (the
format emitted by the original extract.py), writes the split uncompressed
files used by the current app, shrinks the ground masks, and removes the old
gzip payloads.
"""

import gzip
import json
import os
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
OUT = ROOT / "public" / "data"

sys.path.insert(0, str(HERE))
from tile_format import write_building_chunks, write_roads_file  # noqa: E402


def parse_buildings(path):
    raw = gzip.open(path, "rb").read()
    magic, _ver, tile_count = struct.unpack_from("<4sII", raw, 0)
    if magic != b"DB3B":
        raise SystemExit("unexpected buildings magic %r" % magic)
    lon0, lat0, m_lat, m_lon = struct.unpack_from("<2d2f", raw, 12)
    tile_m, quant = struct.unpack_from("<2f", raw, 36)
    cols, rows = struct.unpack_from("<2I", raw, 44)
    offsets = struct.unpack_from("<%dI" % tile_count, raw, 52)
    blob = 52 + tile_count * 4

    out = []
    for i in range(tile_count):
        start = blob + offsets[i]
        end = blob + offsets[i + 1] if i + 1 < tile_count else len(raw)
        body = raw[start:end]
        nb, ox, oy = struct.unpack_from("<Iff", body, 0)
        bld_at = 12
        bld_ring_start = struct.unpack_from("<%dI" % (nb + 1), body, bld_at)
        n_rings = bld_ring_start[nb]
        ring_idx_at = bld_at + (nb + 1) * 4
        ring_idx = struct.unpack_from("<%dI" % n_rings, body, ring_idx_at)
        ring_v_at = ring_idx_at + n_rings * 4
        ring_vstart = struct.unpack_from("<%dI" % (n_rings + 1), body, ring_v_at)
        verts_at = ring_v_at + (n_rings + 1) * 4
        n_verts = (len(body) - verts_at - nb * 6) // 4
        verts = struct.unpack_from("<%dh" % (n_verts * 2), body, verts_at)
        heights_at = verts_at + n_verts * 4
        heights = struct.unpack_from("<%dH" % nb, body, heights_at)
        metas_at = heights_at + nb * 2
        metas = struct.unpack_from("<%dI" % nb, body, metas_at)

        for b in range(nb):
            rings = []
            for ridx in range(bld_ring_start[b], bld_ring_start[b + 1]):
                a = ring_vstart[ring_idx[ridx]]
                z = ring_vstart[ring_idx[ridx] + 1]
                ring = []
                for k in range(a, z):
                    ring.append((ox + verts[k * 2] * quant,
                                 oy + verts[k * 2 + 1] * quant))
                if len(ring) >= 3:
                    rings.append(ring)
            if not rings:
                continue
            meta = metas[b]
            out.append((rings, heights[b] / 10.0, meta & 0xF, (meta >> 4) & 0xFFF))

    return out, {
        "lon0": lon0,
        "lat0": lat0,
        "mPerDegLat": m_lat,
        "mPerDegLon": m_lon,
        "tileM": tile_m,
        "quant": quant,
        "cols": cols,
        "rows": rows,
    }


def parse_roads(path):
    raw = gzip.open(path, "rb").read()
    magic, _ver, count = struct.unpack_from("<4sII", raw, 0)
    if magic != b"DB3R":
        raise SystemExit("unexpected roads magic %r" % magic)
    off = 12
    poly_start = struct.unpack_from("<%dI" % (count + 1), raw, off)
    n_pts = poly_start[count]
    verts_at = off + (count + 1) * 4
    verts = struct.unpack_from("<%di" % (n_pts * 2), raw, verts_at)
    classes_at = verts_at + n_pts * 8
    classes = struct.unpack_from("<%dB" % count, raw, classes_at)
    roads = []
    for i in range(count):
        a, z = poly_start[i], poly_start[i + 1]
        pts = [(verts[k * 2] / 10.0, verts[k * 2 + 1] / 10.0) for k in range(a, z)]
        roads.append((classes[i], pts))
    return roads


def shrink_masks():
    try:
        from PIL import Image
    except Exception as exc:  # pragma: no cover - optional dependency
        print("PIL unavailable, keeping original masks:", exc)
        return None
    targets = {"water.png": 1024, "green.png": 512, "urban.png": 512}
    for name, size in targets.items():
        path = OUT / name
        if not path.exists():
            continue
        img = Image.open(path).convert("L")
        if img.size != (size, size):
            img = img.resize((size, size), Image.LANCZOS)
        img.save(path, format="PNG", optimize=True)
    return {"water": targets["water.png"], "green": targets["green.png"],
            "urban": targets["urban.png"]}


def main():
    old_buildings = OUT / "buildings.bin.gz"
    old_roads = OUT / "roads.bin.gz"
    if not old_buildings.exists():
        raise SystemExit("missing %s (run this before deleting it)" % old_buildings)
    if not old_roads.exists():
        raise SystemExit("missing %s" % old_roads)

    buildings, geo = parse_buildings(old_buildings)
    print("parsed %d buildings from %s" % (len(buildings), old_buildings.name))
    result = write_building_chunks(
        buildings, OUT, geo["lon0"], geo["lat0"],
        geo["mPerDegLat"], geo["mPerDegLon"], geo["tileM"],
    )

    roads = parse_roads(old_roads)
    print("parsed %d roads from %s" % (len(roads), old_roads.name))
    write_roads_file(roads, OUT / "roads.bin")

    resolutions = shrink_masks()
    sizes = {}
    for p in sorted((OUT / "buildings").glob("*.bin")):
        sizes[p.name] = p.stat().st_size
    total_chunk_bytes = sum(sizes.values())
    print("building chunks: %d files, %.1f kB total, largest %.1f kB"
          % (len(sizes), total_chunk_bytes / 1024.0, max(sizes.values()) / 1024.0))

    meta_path = OUT / "city.json"
    meta = json.loads(meta_path.read_text())
    meta["dataVersion"] = 2
    meta["buildings"] = {
        "count": result["total"],
        "index": "buildings/index.json",
        "chunkDir": "buildings/",
        "tile": geo["tileM"],
        "quant": geo["quant"],
        "cols": geo["cols"],
        "rows": geo["rows"],
        "chunks": result["chunks"],
    }
    meta["roads"]["file"] = "roads.bin"
    if resolutions:
        meta["masks"]["res"] = resolutions
    meta["stats"]["buildings"] = result["total"]
    meta["stats"]["droppedLowDetail"] = result["dropped"]
    meta_path.write_text(json.dumps(meta, indent=1))
    print("updated city.json")

    old_buildings.unlink()
    old_roads.unlink()
    print("removed old monolithic gzip files")


if __name__ == "__main__":
    main()
