/**
 * Binary decoders for the static Dubai extract in /public/data.
 *
 * buildings.bin.gz  "DB3B"  tiled footprint + height tiles
 * roads.bin.gz      "DB3R"  road centrelines
 *
 * Both files are plain little-endian structures written by scripts/extract.py.
 */

const BUILDING_MAGIC = 0x42334244; // 'DB3B' read as LE uint32
const ROAD_MAGIC = 0x52334244; // 'DB3R'

function hexHead(buffer, n = 8) {
  const u8 = new Uint8Array(buffer, 0, Math.min(n, buffer.byteLength));
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export class BuildingFile {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.buffer = buffer;

    if (this.view.getUint32(0, true) !== BUILDING_MAGIC) {
      throw new Error(`buildings.bin.gz: bad magic [${hexHead(buffer)}]`);
    }
    this.version = this.view.getUint32(4, true);
    this.tileCount = this.view.getUint32(8, true);

    this.lon0 = this.view.getFloat64(12, true);
    this.lat0 = this.view.getFloat64(20, true);
    this.mPerDegLat = this.view.getFloat32(28, true);
    this.mPerDegLon = this.view.getFloat32(32, true);
    this.tileM = this.view.getFloat32(36, true);
    this.quant = this.view.getFloat32(40, true);
    this.cols = this.view.getUint32(44, true);
    this.rows = this.view.getUint32(48, true);

    const off = 52;
    this.offsets = new Uint32Array(buffer, off, this.tileCount);
    this.blobStart = off + this.tileCount * 4;
    this.blobEnd = buffer.byteLength;
  }

  /** Raw byte range of a tile body inside the decompressed buffer. */
  tileRange(i) {
    const start = this.blobStart + this.offsets[i];
    const end = i + 1 < this.tileCount ? this.blobStart + this.offsets[i + 1] : this.blobEnd;
    return { start, end };
  }

  /**
   * Views over one tile. Vertices are quantised to `quant` metres relative to
   * the tile origin (ox, oy) which are themselves metres from the bbox origin.
   *
   * The tile body is copied into its own buffer first: the writer packs 16-bit
   * heights and 32-bit metadata back to back, so tile bodies are only ever
   * 2-byte aligned and typed array views over them would be rejected.
   */
  tile(i) {
    const { start, end } = this.tileRange(i);
    const bytes = new Uint8Array(this.buffer, start, end - start).slice();
    const dv = new DataView(bytes.buffer);

    const nB = dv.getUint32(0, true);
    const ox = dv.getFloat32(4, true);
    const oy = dv.getFloat32(8, true);

    const bldRingStart = new Uint32Array(bytes.buffer, 12, nB + 1);
    const nRing = bldRingStart[nB];

    const ringIdxAt = 12 + (nB + 1) * 4;
    const ringIdx = new Uint32Array(bytes.buffer, ringIdxAt, nRing);

    const ringVAt = ringIdxAt + nRing * 4;
    const ringVStart = new Uint32Array(bytes.buffer, ringVAt, nRing + 1);

    const vertsAt = ringVAt + (nRing + 1) * 4;
    const nVerts = (end - start - vertsAt - nB * 6) / 4;
    const verts = new Int16Array(bytes.buffer, vertsAt, nVerts * 2);

    const heightsAt = vertsAt + nVerts * 4;
    const heights = new Uint16Array(bytes.buffer, heightsAt, nB);

    const metasAt = heightsAt + nB * 2;
    const metas = new Uint32Array(nB);
    for (let k = 0; k < nB; k++) metas[k] = dv.getUint32(metasAt + k * 4, true);

    return { nB, ox, oy, bldRingStart, ringIdx, ringVStart, verts, heights, metas, quant: this.quant };
  }
}

/**
 * Iterate the buildings of one tile.
 * cb(points, count, heightMetres, facadeType, seed) — points is a flat
 * [x, y, x, y, ...] array of quantised local coordinates.
 */
export function eachBuilding(tile, cb) {
  const { nB, ox, oy, bldRingStart, ringIdx, ringVStart, verts, heights, metas, quant } = tile;
  for (let b = 0; b < nB; b++) {
    const ring = ringIdx[bldRingStart[b]];
    const a = ringVStart[ring];
    const z = ringVStart[ring + 1];
    const count = z - a;
    if (count < 3) continue;
    const meta = metas[b];
    cb(
      verts.subarray(a * 2, z * 2),
      count,
      heights[b] / 10,
      meta & 0xf,
      (meta >> 4) & 0xfff,
      ox,
      oy,
      quant
    );
  }
}

export class RoadFile {
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.buffer = buffer;
    if (this.view.getUint32(0, true) !== ROAD_MAGIC) {
      throw new Error(`roads.bin.gz: bad magic [${hexHead(buffer)}]`);
    }
    this.version = this.view.getUint32(4, true);
    this.count = this.view.getUint32(8, true);
    const off = 12;
    this.polyStart = new Uint32Array(buffer, off, this.count + 1);
    const nPts = this.polyStart[this.count];
    this.verts = new Int32Array(buffer, off + (this.count + 1) * 4, nPts * 2);
    this.classes = new Uint8Array(buffer, off + (this.count + 1) * 4 + nPts * 8, this.count);
  }
}

export const ROAD_WIDTH = [20, 15, 11, 8, 6];
export const ROAD_NAME = ['Sheikh Zayed Road & highways', 'Trunk roads', 'Primary avenues', 'Secondary streets', 'Local streets'];
