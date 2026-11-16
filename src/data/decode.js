/**
 * Binary decoders for the static Dubai extract in /public/data.
 *
 * buildings/c###.bin  "DB3C"  one spatial building chunk (uncompressed)
 * roads.bin           "DB3R"  road centrelines (uncompressed)
 *
 * Both files are plain little-endian structures written by scripts/tile_format.py.
 */

const CHUNK_MAGIC = 0x43334244; // 'DB3C' read as LE uint32
const ROAD_MAGIC = 0x52334244; // 'DB3R'

function hexHead(buffer, n = 8) {
  const u8 = new Uint8Array(buffer, 0, Math.min(n, buffer.byteLength));
  return Array.from(u8)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
}

export class BuildingChunk {
  /**
   * A standalone chunk:
   *   "DB3C" | uint32 version | float32 quant | packed tile body
   * The body starts with nB, ox, oy then the ring / vertex / height / meta
   * arrays exactly as written by scripts/tile_format.py.
   */
  constructor(buffer) {
    this.view = new DataView(buffer);
    this.buffer = buffer;

    if (this.view.getUint32(0, true) !== CHUNK_MAGIC) {
      throw new Error(`building chunk: bad magic [${hexHead(buffer)}]`);
    }
    this.version = this.view.getUint32(4, true);
    this.quant = this.view.getFloat32(8, true);
  }

  /**
   * Views over the chunk's buildings. Vertices are quantised to `quant` metres
   * relative to the tile origin (ox, oy), which are themselves metres from the
   * bbox origin.
   */
  tile() {
    const buffer = this.buffer;
    const dv = this.view;
    const base = 12;

    const nB = dv.getUint32(base, true);
    const ox = dv.getFloat32(base + 4, true);
    const oy = dv.getFloat32(base + 8, true);

    const bldAt = base + 12;
    const bldRingStart = new Uint32Array(buffer, bldAt, nB + 1);
    const nRing = bldRingStart[nB];

    const ringIdxAt = bldAt + (nB + 1) * 4;
    const ringIdx = new Uint32Array(buffer, ringIdxAt, nRing);

    const ringVAt = ringIdxAt + nRing * 4;
    const ringVStart = new Uint32Array(buffer, ringVAt, nRing + 1);

    const vertsAt = ringVAt + (nRing + 1) * 4;
    const nVerts = (buffer.byteLength - vertsAt - nB * 6) / 4;
    const verts = new Int16Array(buffer, vertsAt, nVerts * 2);

    const heightsAt = vertsAt + nVerts * 4;
    const heights = new Uint16Array(buffer, heightsAt, nB);

    // nB * 2 can leave the metadata 2-byte aligned, so read it through the
    // DataView rather than constructing a Uint32Array over it.
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
      throw new Error(`roads.bin: bad magic [${hexHead(buffer)}]`);
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
