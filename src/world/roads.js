/**
 * Road network: every mapped motorway, trunk road and avenue becomes a slim
 * ribbon on the ground, brightest for the highways.
 */

import * as THREE from 'three';
import { CENTER } from '../core/config.js';

const WIDTH = [21, 15, 11, 8, 6];
const COLOR = [
  [0xf2, 0xe8, 0xd4],
  [0xdd, 0xd6, 0xc7],
  [0xc0, 0xba, 0xaf],
  [0xa1, 0x9c, 0x94],
  [0x8b, 0x87, 0x80],
];

export function createRoads(file) {
  const n = file.count;
  const pts = new Float32Array(n * 2);
  const segs = new Uint32Array(n + 1);

  // first pass: count the vertices we need
  let total = 0;
  for (let i = 0; i < n; i++) {
    segs[i] = total;
    total += file.polyStart[i + 1] - file.polyStart[i];
  }
  segs[n] = total;

  const positions = new Float32Array(total * 2 * 3);
  const colors = new Uint32Array(total * 2);
  const indices = new Uint32Array(Math.max(0, total - n) * 6);

  let vi = 0;
  let ii = 0;
  const p = { x: 0, z: 0 };
  const prev = { x: 0, z: 0 };
  const next = { x: 0, z: 0 };

  for (let w = 0; w < n; w++) {
    const cls = file.classes[w];
    const half = WIDTH[cls] * 0.5;
    const c = COLOR[cls];
    const start = file.polyStart[w];
    const end = file.polyStart[w + 1];
    const count = end - start;
    if (count < 2) continue;

    const base = vi;

    for (let k = 0; k < count; k++) {
      const i = start + k;
      const x = file.verts[i * 2] / 10 - CENTER.x;
      const z = -(file.verts[i * 2 + 1] / 10 - CENTER.y);

      // direction from the neighbouring points
      const a = Math.max(0, k - 1);
      const b = Math.min(count - 1, k + 1);
      const ax = file.verts[(start + a) * 2] / 10 - CENTER.x;
      const az = -(file.verts[(start + a) * 2 + 1] / 10 - CENTER.y);
      const bx = file.verts[(start + b) * 2] / 10 - CENTER.x;
      const bz = -(file.verts[(start + b) * 2 + 1] / 10 - CENTER.y);
      let dx = bx - ax;
      let dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;

      const offX = -dz * half;
      const offZ = dx * half;

      const o = vi * 3;
      positions[o] = x + offX;
      positions[o + 1] = 0.25;
      positions[o + 2] = z + offZ;
      positions[o + 3] = x - offX;
      positions[o + 4] = 0.25;
      positions[o + 5] = z - offZ;
      colors[vi] = (c[0] << 24) | (c[1] << 16) | (c[2] << 8) | 255;
      colors[vi + 1] = colors[vi];
      vi += 2;

      if (k > 0) {
        const a0 = base + (k - 1) * 2;
        indices[ii++] = a0;
        indices[ii++] = a0 + 2;
        indices[ii++] = a0 + 1;
        indices[ii++] = a0 + 1;
        indices[ii++] = a0 + 2;
        indices[ii++] = a0 + 3;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Uint8Array(colors.buffer, 0, vi * 4), 4, true));
  geo.setIndex(new THREE.BufferAttribute(indices.subarray(0, ii), 1));
  geo.computeVertexNormals();

  const uniforms = {
    uNight: { value: 0 },
    uLamp: { value: new THREE.Color(0xffab52) },
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.0,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vRoadPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n vRoadPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n uniform float uNight;\n uniform vec3 uLamp;\n varying vec3 vRoadPos;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float lamps = 0.55 + 0.45 * sin(vRoadPos.x * 0.09 + vRoadPos.z * 0.07);
         totalEmissiveRadiance += uLamp * uNight * (0.16 + 0.1 * lamps);`
      );
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'roads';
  mesh.receiveShadow = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    material,
    stats: { ways: n, vertices: vi, triangles: ii / 3 },
    apply(p) {
      uniforms.uNight.value = p.night;
    },
  };
}
