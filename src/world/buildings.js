/**
 * The building stock.
 *
 * OpenStreetMap footprints arrive in small spatial chunks and are extruded as
 * each chunk arrives, so the city appears within seconds and fills in as the
 * rest streams. Everything is quantised: positions are int16 at 0.25 m
 * relative to a chunk origin, colours are 8-bit sRGB and indices are uint16.
 */

import * as THREE from 'three';
import { eachBuilding } from '../data/decode.js';
import { CENTER } from '../core/config.js';

const MAX_VERTS = 60000;
const QUANT = 0.25;
const MAX_SPAN = 7000; // metres, keeps int16 deltas in range

/** Base facade colours by the extractor's height/type bucket. */
const FACADE = [
  [0xb4, 0xaa, 0x98], // 0  low rise
  [0xc1, 0xb6, 0xa2], // 1  13-28 m
  [0xcb, 0xc2, 0xb2], // 2  28-60 m
  [0xa2, 0xb0, 0xbe], // 3  60-150 m
  [0x8f, 0xa1, 0xb3], // 4  150-240 m
  [0x80, 0x95, 0xac], // 5  supertall
  [0x97, 0x91, 0x82], // 6  industrial
  [0xd0, 0xc6, 0xad], // 7  civic
];

function rand01(seed) {
  let t = (seed + 0x9e3779b9) | 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

export function createBuildings() {
  const group = new THREE.Group();
  group.name = 'buildings';

  const material = new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: true,
    shininess: 22,
    specular: new THREE.Color(0x16232c),
    dithering: true,
  });

  const uniforms = {
    uNight: { value: 0 },
    uGlow: { value: new THREE.Color(0xffc477) },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aWall;
         attribute float aSeed;
         varying float vWall;
         varying float vSeed;
         varying vec3 vWPos;`
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
         vWall = aWall;
         vSeed = aSeed;
         vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uNight;
         uniform vec3 uGlow;
         varying float vWall;
         varying float vSeed;
         varying vec3 vWPos;
         float h11(float n) { return fract(sin(n) * 43758.5453123); }`
      )
      .replace(
        '#include <color_fragment>',
        `#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
           diffuseColor.rgb *= pow(vColor.rgb, vec3(2.2));
         #endif`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if (vWall >= 0.0 && uNight > 0.001) {
           float seed = vSeed;
           float fy = vWPos.y / 3.55;
           float cx = vWall / 3.35;
           float row = floor(fy);
           float col = floor(cx);
           float f = fract(fy);
           float c = fract(cx);
           float win = step(0.20, f) * step(f, 0.78) * step(0.18, c) * step(c, 0.80);
           float r = h11(row * 37.0 + col * 11.0 + seed * 0.731);
           float lit = step(0.46, r) * win;
           float base = 0.5 + 0.5 * step(vWPos.y, 70.0);
           totalEmissiveRadiance += uGlow * lit * uNight * base * 0.9;
           float podium = 1.0 - smoothstep(0.0, 7.0, vWPos.y);
           totalEmissiveRadiance += uGlow * uNight * podium * 0.14;
         }`
      );
  };

  const meshes = [];
  const stats = { buildings: 0, vertices: 0, chunks: 0 };

  // scratch buffers reused for every chunk
  const fpos = new Float32Array(MAX_VERTS * 3);
  const col = new Uint8Array(MAX_VERTS * 3);
  const sed = new Uint8Array(MAX_VERTS);
  const wal = new Int16Array(MAX_VERTS);
  const idx = new Uint32Array(MAX_VERTS * 3);

  let vCount = 0;
  let iCount = 0;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  let ring = new Float64Array(512);

  function flush() {
    if (!vCount) return;

    const ox = Math.floor(minX / QUANT) * QUANT;
    const oz = Math.floor(minZ / QUANT) * QUANT;

    const geo = new THREE.BufferGeometry();
    const p = new Int16Array(vCount * 3);
    for (let i = 0; i < vCount; i++) {
      p[i * 3] = Math.round((fpos[i * 3] - ox) / QUANT);
      p[i * 3 + 1] = Math.round(fpos[i * 3 + 1] / QUANT);
      p[i * 3 + 2] = Math.round((fpos[i * 3 + 2] - oz) / QUANT);
    }
    const c = new Uint8Array(col.buffer, 0, vCount * 3).slice();
    const s = new Uint8Array(sed.buffer, 0, vCount).slice();
    const w = new Int16Array(wal.buffer, 0, vCount).slice();
    const index = new Uint16Array(iCount);
    for (let i = 0; i < iCount; i++) index[i] = idx[i];

    geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3, true));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    geo.setAttribute('aWall', new THREE.BufferAttribute(w, 1));
    geo.setIndex(new THREE.BufferAttribute(index, 1));
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(ox, 0, oz);
    group.add(mesh);
    meshes.push(mesh);

    stats.chunks++;
    vCount = 0;
    iCount = 0;
    minX = Infinity;
    minZ = Infinity;
    maxX = -Infinity;
    maxZ = -Infinity;
  }

  /** Extrude every footprint in one spatial chunk. */
  function addTile(tile, minHeight = 0, suppressors = []) {
    eachBuilding(tile, (pts, n, height, facade, seed) => {
        if (height < minHeight) return;
        if (n * 2 > ring.length) ring = new Float64Array(n * 2);

        let bMinX = Infinity;
        let bMaxX = -Infinity;
        let bMinZ = Infinity;
        let bMaxZ = -Infinity;
        for (let i = 0; i < n; i++) {
          const wx = tile.ox + pts[i * 2] * tile.quant - CENTER.x;
          const wz = -(tile.oy + pts[i * 2 + 1] * tile.quant - CENTER.y);
          ring[i * 2] = wx;
          ring[i * 2 + 1] = wz;
          if (wx < bMinX) bMinX = wx;
          if (wx > bMaxX) bMaxX = wx;
          if (wz < bMinZ) bMinZ = wz;
          if (wz > bMaxZ) bMaxZ = wz;
        }

        // buildings modelled by hand replace their OSM footprint
        if (suppressors.length) {
          const cx = (bMinX + bMaxX) * 0.5;
          const cz = (bMinZ + bMaxZ) * 0.5;
          let hidden = false;
          for (const s of suppressors) {
            const dx = cx - s.x;
            const dz = cz - s.z;
            if (dx * dx + dz * dz < s.r * s.r) {
              hidden = true;
              break;
            }
          }
          if (hidden) return;
        }

        // signed area in (x, z)
        let area = 0;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
        }
        if (area > 0) {
          // reverse so the winding yields outward walls and an upward roof
          for (let i = 0, k = n - 1; i < k; i++, k--) {
            const a = ring[i * 2];
            const b = ring[i * 2 + 1];
            ring[i * 2] = ring[k * 2];
            ring[i * 2 + 1] = ring[k * 2 + 1];
            ring[k * 2] = a;
            ring[k * 2 + 1] = b;
          }
        }

        const verts = 3 * n;
        const spanX = Math.max(maxX, bMaxX) - Math.min(minX, bMinX);
        const spanZ = Math.max(maxZ, bMaxZ) - Math.min(minZ, bMinZ);
        if (vCount && (vCount + verts > MAX_VERTS || spanX > MAX_SPAN || spanZ > MAX_SPAN)) {
          flush();
        }
        if (vCount + verts > MAX_VERTS) {
          // a single building larger than a chunk: skip the overflow safely
          if (verts > MAX_VERTS) return;
        }

        const base = vCount;
        const r = rand01(seed);
        const tone = 0.86 + r * 0.26;
        const warm = (r - 0.5) * 9;
        const fc = FACADE[Math.min(facade, FACADE.length - 1)];
        const wallR = Math.max(0, Math.min(255, fc[0] * tone + warm));
        const wallG = Math.max(0, Math.min(255, fc[1] * tone));
        const wallB = Math.max(0, Math.min(255, fc[2] * tone - warm * 0.6));
        const roofR = wallR * 0.72 + 26;
        const roofG = wallG * 0.72 + 26;
        const roofB = wallB * 0.72 + 28;
        const seedByte = Math.round(rand01(seed * 7 + 13) * 255);
        const botR = wallR * 0.6;
        const botG = wallG * 0.6;
        const botB = wallB * 0.62;

        // walls: bottom + top vertex for every ring point
        let dist = 0;
        for (let i = 0; i < n; i++) {
          const x = ring[i * 2];
          const z = ring[i * 2 + 1];
          const j = (i + 1) % n;
          const segLen = Math.hypot(ring[j * 2] - x, ring[j * 2 + 1] - z);
          const u = Math.min(32000, Math.round(dist));

          let vi = (base + i * 2) * 3;
          fpos[vi] = x;
          fpos[vi + 1] = 0;
          fpos[vi + 2] = z;
          let ci = (base + i * 2) * 3;
          col[ci] = botR;
          col[ci + 1] = botG;
          col[ci + 2] = botB;
          sed[base + i * 2] = seedByte;
          wal[base + i * 2] = u;

          vi = (base + i * 2 + 1) * 3;
          fpos[vi] = x;
          fpos[vi + 1] = height;
          fpos[vi + 2] = z;
          ci = (base + i * 2 + 1) * 3;
          col[ci] = wallR;
          col[ci + 1] = wallG;
          col[ci + 2] = wallB;
          sed[base + i * 2 + 1] = seedByte;
          wal[base + i * 2 + 1] = u;

          dist += segLen;
        }

        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const b1 = base + j * 2;
          const t1 = base + j * 2 + 1;
          const t0 = base + i * 2 + 1;
          const b0 = base + i * 2;
          idx[iCount++] = b1;
          idx[iCount++] = t1;
          idx[iCount++] = t0;
          idx[iCount++] = b1;
          idx[iCount++] = t0;
          idx[iCount++] = b0;
        }

        // roof cap
        const rbase = base + n * 2;
        for (let i = 0; i < n; i++) {
          const vi = (rbase + i) * 3;
          fpos[vi] = ring[i * 2];
          fpos[vi + 1] = height;
          fpos[vi + 2] = ring[i * 2 + 1];
          const ci = (rbase + i) * 3;
          col[ci] = roofR;
          col[ci + 1] = roofG;
          col[ci + 2] = roofB;
          sed[rbase + i] = seedByte;
          wal[rbase + i] = -1;
        }
        for (let i = 0; i < n - 2; i++) {
          idx[iCount++] = rbase + i;
          idx[iCount++] = rbase + i + 1;
          idx[iCount++] = rbase + i + 2;
        }

        vCount += verts;
        stats.buildings++;
        stats.vertices += verts;
        if (bMinX < minX) minX = bMinX;
        if (bMaxX > maxX) maxX = bMaxX;
        if (bMinZ < minZ) minZ = bMinZ;
        if (bMaxZ > maxZ) maxZ = bMaxZ;
    });
    flush();
    return stats;
  }

  return {
    group,
    material,
    meshes,
    stats,
    addTile,
    apply(p) {
      uniforms.uNight.value = p.night;
      uniforms.uGlow.value.set(p.night > 0.5 ? 0xffc078 : 0xffd9a0);
    },
  };
}
