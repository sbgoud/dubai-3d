#!/usr/bin/env python3
"""Extract Dubai geometry from the Geofabrik GCC OSM extract into compact
static files for the Dubai 3D web app.

Outputs (public/data):
    city.json          metadata, landmark hints, statistics
    buildings.bin.gz   tiled building footprints + heights
    roads.bin.gz       major road centrelines
    water.png          signed distance field to the shoreline (2048^2)
    green.png          vegetation density (1024^2)
    urban.png          built-up density (1024^2)

Nothing here runs at page load time; the app only fetches these static files.
"""

import gzip
import json
import math
import os
import struct
import sys
import time
import zlib

import numpy as np
import osmium
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "data")

# Central Dubai bounding box (west, south, east, north).
BBOX = (55.02, 24.96, 55.42, 25.36)
LON0, LAT0 = BBOX[0], BBOX[1]
M_LAT = 110574.0
M_LON = 111320.0 * math.cos(math.radians(LAT0))
WSPAN = (BBOX[2] - BBOX[0]) * M_LON
HSPAN = (BBOX[3] - BBOX[1]) * M_LAT

TILE_M = 5000.0          # tile size in metres
TILE_Q = 0.25            # metres per stored vertex unit (i16)
WATER_RES = 2048         # water / coastline raster resolution
MASK_RES = 1024          # green + urban raster resolution

ROAD_CLASSES = {
    "motorway": 0, "motorway_link": 0,
    "trunk": 1, "trunk_link": 1,
    "primary": 2, "primary_link": 2,
    "secondary": 3, "secondary_link": 3,
    "tertiary": 4, "tertiary_link": 4,
}

# Default heights in metres when a building carries no height information.
DEFAULT_H = {
    "yes": 11.0, "house": 7.5, "detached": 7.5, "semidetached_house": 8.5,
    "bungalow": 6.5, "hut": 4.5, "cabin": 5.0, "static_caravan": 4.0,
    "apartments": 21.0, "residential": 18.0, "dormitory": 18.0,
    "commercial": 30.0, "office": 32.0, "retail": 15.0, "supermarket": 9.0,
    "hotel": 42.0, "industrial": 14.0, "warehouse": 13.0, "factory": 15.0,
    "manufacture": 14.0, "garage": 6.0, "garages": 6.0, "carport": 4.0,
    "shed": 5.5, "roof": 6.0, "greenhouse": 4.5, "agricultural": 5.0,
    "mosque": 17.0, "church": 15.0, "temple": 15.0, "chapel": 9.0,
    "school": 16.0, "university": 18.0, "college": 16.0, "kindergarten": 8.0,
    "hospital": 24.0, "civic": 16.0, "public": 14.0, "government": 18.0,
    "train_station": 12.0, "transport_hall": 12.0, "stadium": 22.0,
    "toilets": 4.0, "bunker": 9.0, "construction": 10.0, "tomb": 4.0,
    "grave_yard": 3.0, "storage_tank": 18.0, "water_tower": 22.0,
    "silo": 20.0, "farm": 6.0,
}

GREEN_KEYS = {
    ("landuse", "forest"), ("landuse", "grass"), ("landuse", "meadow"),
    ("landuse", "village_green"), ("landuse", "allotments"), ("landuse", "orchard"),
    ("landuse", "greenfield"), ("landuse", "cemetery"),
    ("leisure", "park"), ("leisure", "garden"), ("leisure", "pitch"),
    ("leisure", "golf_course"), ("leisure", "nature_reserve"),
    ("leisure", "playground"), ("leisure", "recreation_ground"),
    ("natural", "wood"), ("natural", "scrub"), ("natural", "grassland"),
    ("natural", "heath"), ("natural", "sand"), ("natural", "beach"),
    ("natural", "bare_rock"), ("natural", "wetland"),
}
URBAN_KEYS = {
    ("landuse", "residential"), ("landuse", "commercial"),
    ("landuse", "industrial"), ("landuse", "retail"),
    ("landuse", "brownfield"), ("landuse", "construction"),
}


def mx(lon):
    return (lon - BBOX[0]) * M_LON


def my(lat):
    return (lat - BBOX[1]) * M_LAT


def simp(pts, eps):
    """Douglas-Peucker on a polyline given as a list of (x, y) tuples."""
    if len(pts) < 3:
        return list(pts)
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]
        bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            cx, cy = pts[i]
            if den < 1e-9:
                d = math.hypot(cx - ax, cy - ay)
            else:
                d = abs(dy * (cx - ax) - dx * (cy - ay)) / den
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack.append((a, bi))
            stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def ring_area(pts):
    a = 0.0
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def parse_height(tags, btype):
    """Return height in metres, or None when nothing is mapped."""
    for key in ("height", "building:height"):
        v = tags.get(key)
        if v:
            try:
                s = str(v).strip().lower().replace(",", ".")
                for unit in ("meters", "meter", "metres", "metre", "m"):
                    if s.endswith(unit):
                        s = s[: -len(unit)].strip()
                h = float(s)
                if 1.0 <= h <= 1500.0:
                    return h
            except ValueError:
                pass
    lv = tags.get("building:levels") or tags.get("levels")
    if lv:
        try:
            n = float(str(lv).strip())
            if 1 <= n <= 200:
                step = 3.6 if btype in ("commercial", "office", "hotel", "retail") else 3.15
                h = n * step + 1.6
                rf = tags.get("roof:levels")
                if rf:
                    try:
                        h += float(str(rf).strip()) * 3.0
                    except ValueError:
                        pass
                return h
        except ValueError:
            pass
    return None


def facade_type(h, btype):
    if btype in ("industrial", "warehouse", "factory", "manufacture", "hangar",
                 "storage_tank", "silo", "greenhouse", "agricultural", "farm"):
        return 6
    if btype in ("mosque", "church", "temple", "chapel", "civic", "government",
                 "public", "hospital", "university", "college", "school"):
        return 7
    if h >= 150:
        return 5
    if h >= 60:
        return 3
    if h >= 28:
        return 2
    if h >= 13:
        return 1
    if btype in ("apartments", "residential", "dormitory"):
        return 1
    return 0


class Collector(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.buildings = []
        self.way_cache = {}
        self.roads = []
        self.water_rings = []
        self.coast = []
        self.green = []
        self.urban = []
        self.tall = []

    def _pts(self, w):
        return [(mx(n.lon), my(n.lat)) for n in w.nodes if n.location.valid()]

    def _in_box(self, pts):
        for x, y in pts:
            lon = BBOX[0] + x / M_LON
            lat = BBOX[1] + y / M_LAT
            if BBOX[0] - 0.02 <= lon <= BBOX[2] + 0.02 and BBOX[1] - 0.02 <= lat <= BBOX[3] + 0.02:
                return True
        return False

    def way(self, w):
        t = w.tags
        if not t:
            return
        pts = self._pts(w)
        if len(pts) < 2:
            return

        btype = t.get("building")
        if btype:
            if not self._in_box(pts):
                return
            closed = len(pts) > 3 and pts[0] == pts[-1]
            ring = pts[:-1] if closed else pts
            if len(ring) < 3:
                return
            ring = simp(ring, 1.1)
            if len(ring) < 3 or abs(ring_area(ring)) < 20.0:
                return
            h = parse_height(t, btype)
            if h is None:
                h = DEFAULT_H.get(btype, DEFAULT_H["yes"])
            h = min(max(h, 2.5), 420.0)
            ft = facade_type(h, btype)
            name = t.get("name") or t.get("name:en")
            seed = (w.id * 2654435761) & 0xFFFFF
            self.buildings.append(([ring], h, ft, seed, name))
            self.way_cache[w.id] = (ring, t)
            if name and h >= 100:
                cx = sum(p[0] for p in ring) / len(ring)
                cy = sum(p[1] for p in ring) / len(ring)
                self.tall.append((name, round(h, 1), round(BBOX[0] + cx / M_LON, 5),
                                  round(BBOX[1] + cy / M_LAT, 5), btype))
            return

        hw = t.get("highway")
        if hw in ROAD_CLASSES:
            if not self._in_box(pts):
                return
            sp = simp(pts, 3.5)
            if len(sp) >= 2:
                self.roads.append((ROAD_CLASSES[hw], sp))
            return

        nat = t.get("natural")
        if nat == "coastline":
            if self._in_box(pts):
                ids = [n.ref for n in w.nodes if n.location.valid()]
                self.coast.append((ids[0], ids[-1], pts))
            return

        if nat == "water" or t.get("waterway") in ("riverbank", "dock", "canal") or \
                t.get("landuse") in ("reservoir", "basin"):
            if len(pts) > 3 and pts[0] == pts[-1] and self._in_box(pts):
                ring = simp(pts[:-1], 3.0)
                if len(ring) >= 3:
                    self.water_rings.append(ring)
                    self.way_cache[w.id] = (ring, t)
            return

        key = None
        if ("landuse", t.get("landuse")) in GREEN_KEYS or ("leisure", t.get("leisure")) in GREEN_KEYS \
                or ("natural", nat) in GREEN_KEYS:
            key = "green"
        elif ("landuse", t.get("landuse")) in URBAN_KEYS:
            key = "urban"
        if key and len(pts) > 3 and pts[0] == pts[-1] and self._in_box(pts):
            ring = simp(pts[:-1], 4.0)
            if len(ring) >= 3:
                getattr(self, key).append(ring)
                self.way_cache[w.id] = (ring, t)

    def relation(self, r):
        t = r.tags
        if not t or t.get("type") not in ("multipolygon", "boundary"):
            return
        members = [m for m in r.members if m.type == "w" and m.role in ("outer", "inner", "")]
        if not members:
            return
        outers, inners = [], []
        for m in members:
            cached = self.way_cache.get(m.ref)
            if cached is None:
                continue
            ring = cached[0]
            (inners if m.role == "inner" else outers).append(ring)
        if not outers:
            return
        if "building" in t:
            btype = t.get("building")
            h = parse_height(t, btype)
            if h is None:
                h = DEFAULT_H.get(btype, DEFAULT_H["yes"])
            h = min(max(h, 2.5), 420.0)
            ft = facade_type(h, btype)
            name = t.get("name") or t.get("name:en")
            seed = (r.id * 2654435761) & 0xFFFFF
            keep_o, keep_i = [], []
            for ring in outers:
                ring = simp(ring, 1.1)
                if len(ring) >= 3 and abs(ring_area(ring)) > 20.0:
                    keep_o.append(ring)
            for ring in inners:
                ring = simp(ring, 1.1)
                if len(ring) >= 3 and abs(ring_area(ring)) > 20.0:
                    keep_i.append(ring)
            if keep_o:
                self.buildings.append((keep_o + keep_i, h, ft, seed, name))
        elif t.get("natural") == "water" or t.get("waterway") in ("riverbank", "dock") or \
                t.get("landuse") in ("reservoir", "basin"):
            for ring in outers:
                if self._in_box(ring):
                    self.water_rings.append(simp(ring, 3.0))
        elif ("landuse", t.get("landuse")) in GREEN_KEYS or ("leisure", t.get("leisure")) in GREEN_KEYS \
                or ("natural", t.get("natural")) in GREEN_KEYS:
            for ring in outers:
                if self._in_box(ring):
                    self.green.append(simp(ring, 4.0))


# ---------------------------------------------------------------------------
# raster helpers
# ---------------------------------------------------------------------------

def rasterize_polys(polys, res, value=1.0):
    grid = np.zeros((res, res), dtype=np.float32)
    if not polys:
        return grid
    sx = res / WSPAN
    sy = res / HSPAN
    for ring in polys:
        if len(ring) < 3:
            continue
        X = [p[0] * sx for p in ring]
        Y = [(HSPAN - p[1]) * sy for p in ring]
        y0 = max(0, int(math.floor(min(Y))))
        y1 = min(res - 1, int(math.ceil(max(Y))))
        n = len(X)
        for y in range(y0, y1 + 1):
            yy = y + 0.5
            xs = []
            for i in range(n):
                j = (i + 1) % n
                if (Y[i] <= yy < Y[j]) or (Y[j] <= yy < Y[i]):
                    t = (yy - Y[i]) / (Y[j] - Y[i])
                    xs.append(X[i] + t * (X[j] - X[i]))
            if len(xs) < 2:
                continue
            xs.sort()
            for k in range(0, len(xs) - 1, 2):
                xa = max(0, int(math.ceil(xs[k] - 0.5)))
                xb = min(res - 1, int(math.floor(xs[k + 1] - 0.5)))
                if xb >= xa:
                    np.maximum(grid[y, xa:xb + 1], value, out=grid[y, xa:xb + 1])
    return grid


def draw_lines(grid, chains, res, value=1.0):
    sx = res / WSPAN
    sy = res / HSPAN
    for pts in chains:
        if len(pts) < 2:
            continue
        X = [p[0] * sx for p in pts]
        Y = [(HSPAN - p[1]) * sy for p in pts]
        for i in range(len(X) - 1):
            x0, y0 = X[i], Y[i]
            x1, y1 = X[i + 1], Y[i + 1]
            steps = int(max(abs(x1 - x0), abs(y1 - y0)) * 1.6) + 1
            for s in range(steps + 1):
                t = s / steps
                xi = int(round(x0 + (x1 - x0) * t))
                yi = int(round(y0 + (y1 - y0) * t))
                if 0 <= xi < res and 0 <= yi < res:
                    if grid[yi, xi] < value:
                        grid[yi, xi] = value
    return grid


def stitch_chains(chains, tol=150.0):
    """Join coastline ways that share node ids into long polylines."""
    by_node = {}
    for i, c in enumerate(chains):
        by_node.setdefault(c[0], []).append((i, False))
        by_node.setdefault(c[1], []).append((i, True))
    used = [False] * len(chains)
    out = []

    def near(p, q):
        return math.hypot(p[0] - q[0], p[1] - q[1]) <= tol

    for i in range(len(chains)):
        if used[i]:
            continue
        used[i] = True
        pts = list(chains[i][2])
        head, tail = chains[i][0], chains[i][1]
        tail_pos, head_pos = pts[-1], pts[0]
        # extend the tail
        while True:
            nxt = None
            for j, starts in by_node.get(tail, []):
                if used[j]:
                    continue
                cp = chains[j][2]
                far = cp[-1] if starts else cp[0]
                if not near(far, tail_pos):
                    continue
                nxt = (j, starts)
                break
            if nxt is None:
                break
            j, starts = nxt
            used[j] = True
            cp = chains[j][2]
            if starts:
                pts.extend(list(reversed(cp))[:-1])
                tail = chains[j][0]
            else:
                pts.extend(cp[1:])
                tail = chains[j][1]
            tail_pos = pts[-1]
        # extend the head
        while True:
            nxt = None
            for j, starts in by_node.get(head, []):
                if used[j]:
                    continue
                cp = chains[j][2]
                far = cp[0] if starts else cp[-1]
                if not near(far, head_pos):
                    continue
                nxt = (j, starts)
                break
            if nxt is None:
                break
            j, starts = nxt
            used[j] = True
            cp = chains[j][2]
            if starts:
                pts = list(reversed(cp))[:-1] + pts
                head = chains[j][0]
            else:
                pts = cp[:-1] + pts
                head = chains[j][1]
            head_pos = pts[0]
        out.append(pts)
    return out


def _edge_hit(p, d):
    lon, lat = p
    dlon, dlat = d
    ts = []
    if dlon > 1e-12:
        ts.append((BBOX[2] - lon) / dlon)
    elif dlon < -1e-12:
        ts.append((BBOX[0] - lon) / dlon)
    if dlat > 1e-12:
        ts.append((BBOX[3] - lat) / dlat)
    elif dlat < -1e-12:
        ts.append((BBOX[1] - lat) / dlat)
    if not ts:
        return None
    t = min(ts)
    if t <= 0:
        return None
    return (lon + dlon * t * 1.08, lat + dlat * t * 1.08)


def bridge_chains(chains, max_gap, report=None):
    """Close small gaps in the coastline by joining the closest dangling ends."""
    chains = [list(c) for c in chains]
    while True:
        best = None
        n = len(chains)
        ends = []
        for i, c in enumerate(chains):
            if len(c) < 2:
                continue
            if c[0] == c[-1]:
                continue
            ends.append((i, 0, c[0]))
            ends.append((i, 1, c[-1]))
        for a in range(len(ends)):
            ia, sa, pa = ends[a]
            for b in range(a + 1, len(ends)):
                ib, sb, pb = ends[b]
                if ia == ib:
                    continue
                d = math.hypot(pa[0] - pb[0], pa[1] - pb[1])
                if d < max_gap and (best is None or d < best[0]):
                    best = (d, ia, sa, ib, sb)
        if best is None:
            break
        d, ia, sa, ib, sb = best
        ca, cb = chains[ia], chains[ib]
        if sa == 1:
            ca = list(reversed(ca))
        if sb == 0:
            cb = list(reversed(cb))
        merged = ca + cb[1:]
        if report is not None:
            report.append((round(d, 1), (round(pa[0] / M_LON + BBOX[0], 4), round(pa[1] / M_LAT + BBOX[1], 4)),
                           (round(pb[0] / M_LON + BBOX[0], 4), round(pb[1] / M_LAT + BBOX[1], 4))))
        chains = [c for i, c in enumerate(chains) if i not in (ia, ib)]
        chains.append(merged)
    return chains


def _inside(p):
    lon = BBOX[0] + p[0] / M_LON
    lat = BBOX[1] + p[1] / M_LAT
    return BBOX[0] <= lon <= BBOX[2] and BBOX[1] <= lat <= BBOX[3]


# The OSM coastline in this extract has a handful of gaps (mostly around the
# Jumeirah shore). These hand-drawn repairs close them so the flood fill can
# separate the Gulf from the mainland.
COAST_REPAIRS = [
    # north shore of Palm Jumeirah up to the Jumeirah coastline
    [(55.1488, 25.1347), (55.1600, 25.1395), (55.1750, 25.1450),
     (55.1860, 25.1480), (55.1942, 25.1505)],
    # Jumeirah shore: closes the channel west of Palm Jumeirah
    [(55.1241, 25.1381), (55.1252, 25.1560), (55.1246, 25.1760),
     (55.1250, 25.1960), (55.1246, 25.2060), (55.1300, 25.2260),
     (55.1364, 25.2456), (55.1470, 25.2453), (55.1560, 25.2450),
     (55.1592, 25.2450)],
    # creek mouth / Deira shore towards Ras al Khor
    [(55.3321, 25.2053), (55.3380, 25.2058), (55.3430, 25.2110)],
    # Al Mamzar / Ras Al Khor shore: closes the gulf against the desert
    [(55.1700, 25.2450), (55.2000, 25.2500), (55.2400, 25.2600),
     (55.2700, 25.2680), (55.2937, 25.2754)],
]


def extend_to_box(pts):
    """Run the open ends of a coastline chain out to the edge of the box so
    that the land side cannot leak around them."""
    if len(pts) < 2:
        return pts
    out = list(pts)
    if abs(out[0][0] - out[-1][0]) > 1e-9 or abs(out[0][1] - out[-1][1]) > 1e-9:
        d = (out[1][0] - out[0][0], out[1][1] - out[0][1])
        n = math.hypot(d[0], d[1])
        if n > 1e-9 and _inside(out[0]):
            hit = _edge_hit(out[0], (d[0] / n, d[1] / n))
            if hit:
                out.insert(0, hit)
        d = (out[-1][0] - out[-2][0], out[-1][1] - out[-2][1])
        n = math.hypot(d[0], d[1])
        if n > 1e-9 and _inside(out[-1]):
            hit = _edge_hit(out[-1], (d[0] / n, d[1] / n))
            if hit:
                out.append(hit)
    return out


def write_png_gray(path, arr):
    h, w = arr.shape
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(arr[y].tobytes())
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    out += chunk(b"IDAT", comp)
    out += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(out)


def write_buildings(buildings):
    cols = int(math.ceil(WSPAN / TILE_M))
    rows = int(math.ceil(HSPAN / TILE_M))
    tiles = {}
    for rings, h, ft, seed, name in buildings:
        ring = rings[0]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        tx = min(max(int(cx // TILE_M), 0), cols - 1)
        ty = min(max(int(cy // TILE_M), 0), rows - 1)
        tiles.setdefault((tx, ty), []).append((rings, h, ft, seed))

    index = []
    body_blob = bytearray()
    for key in sorted(tiles.keys()):
        items = tiles[key]
        ox = key[0] * TILE_M
        oy = key[1] * TILE_M
        body = bytearray()
        body += struct.pack("<I", len(items))
        body += struct.pack("<2f", ox, oy)
        ring_idx = []
        ring_vstart = []
        bld_ring_start = [0]
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
        body += struct.pack("<%dI" % len(bld_ring_start), *bld_ring_start)
        body += struct.pack("<%dI" % len(ring_idx), *ring_idx)
        body += struct.pack("<%dI" % (len(ring_vstart) + 1), *ring_vstart, len(ring_vstart))
        body += struct.pack("<%dh" % len(verts), *verts)
        body += struct.pack("<%dH" % len(heights), *heights)
        body += struct.pack("<%dI" % len(metas), *metas)
        index.append((key[0], key[1], len(body_blob), len(body)))
        body_blob += body

    out = bytearray()
    out += struct.pack("<4sII", b"DB3B", 1, len(index))
    out += struct.pack("<2d2f", LON0, LAT0, M_LAT, M_LON)
    out += struct.pack("<2f", TILE_M, TILE_Q)
    out += struct.pack("<2I", cols, rows)
    out += struct.pack("<%dI" % len(index), *(i[2] for i in index))
    out += body_blob
    path = os.path.join(OUT, "buildings.bin.gz")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(bytes(out))
    print("wrote buildings.bin.gz (%.1f kB, raw %.1f kB, %d tiles, %d buildings)"
          % (os.path.getsize(path) / 1024, len(out) / 1024, len(index), len(buildings)))


def write_roads(roads):
    out = bytearray()
    out += struct.pack("<4sII", b"DB3R", 1, len(roads))
    poly_start = []
    verts = []
    classes = []
    for cls, pts in roads:
        poly_start.append(len(verts) // 2)
        for x, y in pts:
            verts.append(int(round(x * 10)))
            verts.append(int(round(y * 10)))
        classes.append(cls)
    poly_start.append(len(verts) // 2)
    out += struct.pack("<%dI" % len(poly_start), *poly_start)
    out += struct.pack("<%di" % len(verts), *verts)
    out += struct.pack("<%dB" % len(classes), *classes)
    path = os.path.join(OUT, "roads.bin.gz")
    with gzip.open(path, "wb", compresslevel=9) as f:
        f.write(bytes(out))
    print("wrote roads.bin.gz (%.1f kB, raw %.1f kB, %d ways)"
          % (os.path.getsize(path) / 1024, len(out) / 1024, len(roads)))


def main():
    t0 = time.time()
    pbf = sys.argv[1] if len(sys.argv) > 1 else "/tmp/osm/gcc.osm.pbf"
    if not os.path.exists(pbf):
        print("missing pbf:", pbf)
        sys.exit(1)
    os.makedirs(OUT, exist_ok=True)

    col = Collector()
    col.apply_file(pbf, locations=True)
    print("read %d buildings, %d roads, %d coast chains, %d water rings in %.1fs"
          % (len(col.buildings), len(col.roads), len(col.coast), len(col.water_rings), time.time() - t0))

    # ---- water: coastline flood fill + mapped water areas ---------------
    # The land/sea split is resolved on a coarse grid (the coastline in the
    # extract is fragmented, so a fine grid leaks); the shoreline itself is
    # then taken from the fine grid, which keeps it crisp.
    coarse = 1024
    chains = stitch_chains(col.coast)
    bridges = []
    chains = bridge_chains(chains, 7000.0, bridges)
    for repair in COAST_REPAIRS:
        chains.append([(mx(lon), my(lat)) for lon, lat in repair])
    print("stitched coastline into %d chains (%d gap bridges)" % (len(chains), len(bridges)))
    chains = [extend_to_box(c) for c in chains]

    cbar = np.zeros((coarse, coarse), dtype=bool)
    draw_lines(cbar, chains, coarse, 1.0)
    cfree = ~ndimage.binary_dilation(cbar, np.ones((3, 3), bool))
    labels, nlab = ndimage.label(cfree)
    sizes = np.bincount(labels.ravel())
    sea = np.zeros((coarse, coarse), dtype=bool)
    for lon, lat in [(55.250, 25.280), (55.150, 25.170), (55.360, 25.330),
                     (55.200, 25.270), (55.120, 25.115)]:
        x = int((lon - BBOX[0]) / (BBOX[2] - BBOX[0]) * coarse)
        y = int((BBOX[3] - lat) / (BBOX[3] - BBOX[1]) * coarse)
        lab = labels[min(coarse - 1, max(0, y)), min(coarse - 1, max(0, x))]
        if lab:
            sea |= labels == lab
    print("sea pixels: %.1f%%" % (100.0 * sea.mean()))

    # enclosed water pockets (lagoons, harbours) that are not mapped as water
    wp_c = rasterize_polys(col.water_rings, coarse, 1.0)
    occupied = set()
    for rings, h, ft, seed, name in col.buildings:
        ring = rings[0]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        occupied.add((int(cx / WSPAN * coarse), int((1.0 - cy / HSPAN) * coarse)))
    for lab in np.unique(labels):
        if lab == 0:
            continue
        sel = labels == lab
        area_m2 = sizes[lab] * (WSPAN / coarse) * (HSPAN / coarse)
        if area_m2 > 5.0e6 or area_m2 < 9000:
            continue
        if (wp_c[sel] > 0.5).mean() > 0.3:
            continue
        ys, xs = np.where(sel)
        if len(ys) < 20:
            continue
        if any((x, y) in occupied for x, y in zip(xs, ys)):
            continue
        sea |= sel
        print("  enclosed water pocket %.2f km2 at lon %.4f lat %.4f"
              % (area_m2 / 1e6, BBOX[0] + xs.mean() / coarse * (BBOX[2] - BBOX[0]),
                 BBOX[3] - ys.mean() / coarse * (BBOX[3] - BBOX[1])))

    # fine shoreline: distance to the mapped coastline at full resolution
    res = WATER_RES
    fbar = np.zeros((res, res), dtype=bool)
    draw_lines(fbar, chains, res, 1.0)
    dist_coast = ndimage.distance_transform_edt(~fbar) * (WSPAN / res)
    fine_land = np.repeat(np.repeat(~sea, 2, axis=0), 2, axis=1)[:res, :res]
    if fine_land.shape != (res, res):
        fine_land = np.resize(fine_land, (res, res))
    water_fine = ~fine_land
    sdf = np.where(water_fine, -dist_coast, dist_coast)
    sdf_q = np.clip(np.round(sdf / 10.0) + 127.0, 0, 255).astype(np.uint8)
    write_png_gray(os.path.join(OUT, "water.png"), sdf_q)
    print("wrote water.png (%.1f kB)" % (os.path.getsize(os.path.join(OUT, "water.png")) / 1024))
    water = water_fine

    # ---- green + urban masks -------------------------------------------
    mres = MASK_RES
    green_polys = rasterize_polys(col.green, mres, 1.0)
    urban_polys = rasterize_polys(col.urban, mres, 1.0)
    dens = np.zeros((mres, mres), dtype=np.float32)
    for rings, h, ft, seed, name in col.buildings:
        ring = rings[0]
        cx = sum(p[0] for p in ring) / len(ring)
        cy = sum(p[1] for p in ring) / len(ring)
        gx = int(cx / WSPAN * mres)
        gy = int((1.0 - cy / HSPAN) * mres)
        if 0 <= gx < mres and 0 <= gy < mres:
            dens[gy, gx] += 1.0
    dens = ndimage.gaussian_filter(dens, 3.0)
    dmax = float(dens.max()) or 1.0
    dens_n = np.clip(dens / (0.30 * dmax), 0, 1)
    green = ndimage.gaussian_filter(np.clip(green_polys * 0.9, 0, 1), 1.2)
    urban = ndimage.gaussian_filter(np.clip(np.maximum(urban_polys, dens_n * 1.15), 0, 1), 1.2)
    write_png_gray(os.path.join(OUT, "green.png"), (green * 255).astype(np.uint8))
    write_png_gray(os.path.join(OUT, "urban.png"), (urban * 255).astype(np.uint8))
    print("wrote green.png / urban.png")

    write_buildings(col.buildings)
    write_roads(col.roads)

    heights = np.array([b[1] for b in col.buildings]) if col.buildings else np.zeros(1)
    buckets = {
        "0-12m": int((heights <= 12).sum()),
        "12-30m": int(((heights > 12) & (heights <= 30)).sum()),
        "30-60m": int(((heights > 30) & (heights <= 60)).sum()),
        "60-150m": int(((heights > 60) & (heights <= 150)).sum()),
        "150m+": int((heights > 150).sum()),
    }
    tall_sorted = sorted(col.tall, key=lambda r: -r[1])[:260]
    meta = {
        "generated": time.strftime("%Y-%m-%d"),
        "source": "OpenStreetMap contributors (ODbL), via the Geofabrik GCC extract",
        "bbox": {"west": BBOX[0], "south": BBOX[1], "east": BBOX[2], "north": BBOX[3]},
        "origin": {"lon": LON0, "lat": LAT0},
        "mPerDegLat": M_LAT,
        "mPerDegLon": M_LON,
        "widthM": WSPAN,
        "heightM": HSPAN,
        "buildings": {"count": len(col.buildings), "file": "buildings.bin.gz",
                      "tile": TILE_M, "quant": TILE_Q, "cols": int(math.ceil(WSPAN / TILE_M)),
                      "rows": int(math.ceil(HSPAN / TILE_M))},
        "roads": {"file": "roads.bin.gz", "count": len(col.roads)},
        "masks": {"water": "water.png", "green": "green.png", "urban": "urban.png",
                  "res": {"water": WATER_RES, "green": MASK_RES, "urban": MASK_RES}},
        "stats": {"buildings": len(col.buildings), "heightBuckets": buckets,
                  "maxHeight": float(heights.max()), "tallest": tall_sorted},
    }
    with open(os.path.join(OUT, "city.json"), "w") as f:
        json.dump(meta, f, indent=1)
    print("wrote city.json")
    print("done in %.1fs" % (time.time() - t0))


if __name__ == "__main__":
    main()
