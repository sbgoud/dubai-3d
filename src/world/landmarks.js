/**
 * Hand-built landmark models.
 *
 * The OSM extract caps tower heights at 420 m and has no geometry for the
 * Burj Khalifa's setbacks, so the icons of Dubai are modelled here and
 * dropped onto their real coordinates at their real heights.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { lonToX, latToZ, TOWERS } from '../core/config.js';

const GLASS = 0x9fb6c6;
const GLASS_DARK = 0x51697d;
const CONCRETE = 0xd9cdb6;
const CONCRETE_DARK = 0xa89d88;
const GOLD = 0xd8b273;
const GLASS_WARM = 0xbcc6cc;

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function paint(geo, hex) {
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!geo.attributes.uv) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  return geo;
}

function box(w, h, d, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y + h / 2, z);
  return g;
}

function cyl(rTop, rBot, h, seg, x = 0, y = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, false);
  g.translate(x, y + h / 2, z);
  return g;
}

/** A stack of polygon cross-sections turned into a solid. */
function loft(sections, cap = true) {
  const n = sections[0].pts.length;
  const count = sections.length;
  const positions = new Float32Array(count * n * 3);
  const uvs = new Float32Array(count * n * 2);

  let o = 0;
  let u = 0;
  for (const sec of sections) {
    for (let i = 0; i < n; i++) {
      positions[o++] = sec.pts[i][0];
      positions[o++] = sec.y;
      positions[o++] = sec.pts[i][1];
      uvs[u++] = i / n;
      uvs[u++] = sec.y * 0.02;
    }
  }

  const indices = [];
  for (let s = 0; s < count - 1; s++) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = s * n + i;
      const b = s * n + j;
      const c = (s + 1) * n + j;
      const d = (s + 1) * n + i;
      indices.push(a, b, c, a, c, d);
    }
  }

  if (cap) {
    const last = sections[count - 1];
    const centre = last.pts.reduce((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n], [0, 0]);
    const ci = count * n;
    const pos2 = new Float32Array(positions.length + 3);
    pos2.set(positions);
    pos2[ci * 3] = centre[0];
    pos2[ci * 3 + 1] = last.y;
    pos2[ci * 3 + 2] = centre[1];
    const uv2 = new Float32Array(uvs.length + 2);
    uv2.set(uvs);
    for (let i = 0; i < n; i++) {
      indices.push(ci, (count - 1) * n + i, (count - 1) * n + ((i + 1) % n));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv2, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function circlePts(r, n = 20, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return pts;
}

function triPts(r, rot) {
  const pts = [];
  for (let c = 0; c < 3; c++) {
    const a0 = rot + c * ((Math.PI * 2) / 3);
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k - 1) * 0.2;
      const rr = r * (1 - 0.07 * Math.abs(k - 1));
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  }
  return pts;
}

function squarePts(r, rot) {
  return [
    [Math.cos(rot + Math.PI / 4) * r * 1.42, Math.sin(rot + Math.PI / 4) * r * 1.42],
    [Math.cos(rot - Math.PI / 4) * r * 1.42, Math.sin(rot - Math.PI / 4) * r * 1.42],
    [Math.cos(rot + (3 * Math.PI) / 4) * r * 1.42, Math.sin(rot + (3 * Math.PI) / 4) * r * 1.42],
    [Math.cos(rot - (3 * Math.PI) / 4) * r * 1.42, Math.sin(rot - (3 * Math.PI) / 4) * r * 1.42],
  ];
}

/* ------------------------------------------------------------------ */
/* model kit                                                           */
/* ------------------------------------------------------------------ */

function yPlanTower(h, opts = {}) {
  const parts = [];
  const coreTop = h * 0.86;
  const sections = [];
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = 3 + 36 * Math.pow(1 - t, 0.78);
    sections.push({ y: t * coreTop, pts: circlePts(r, 18, t * 0.2) });
  }
  parts.push(paint(loft(sections), GLASS));

  // three buttressed wings that step back as they climb
  for (let w = 0; w < 3; w++) {
    const steps2 = 16;
    for (let k = 0; k < steps2; k++) {
      const t = k / steps2;
      const ang = w * ((Math.PI * 2) / 3) + t * 1.35;
      const r = 32 * (1 - t * 0.78);
      const hh = (coreTop / steps2) * 1.05;
      const size = 30 * (1 - t * 0.66);
      const depth = 24 * (1 - t * 0.55);
      parts.push(
        paint(box(size, hh, depth, Math.cos(ang) * r, k * hh, Math.sin(ang) * r, -ang), t > 0.6 ? GLASS_DARK : GLASS)
      );
    }
  }

  parts.push(paint(cyl(0.6, 3.4, h - coreTop, 10, 0, coreTop, 0), CONCRETE));
  if (opts.podium !== false) {
    parts.push(paint(cyl(46, 52, 26, 24), CONCRETE_DARK));
  }
  return parts;
}

function sailTower(h) {
  const parts = [];
  const s = new THREE.Shape();
  s.moveTo(-52, 0);
  s.lineTo(58, 0);
  s.quadraticCurveTo(48, 118, 8, 196);
  s.lineTo(-16, 196);
  s.quadraticCurveTo(-40, 104, -52, 0);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: 26,
    bevelEnabled: true,
    bevelSize: 2.4,
    bevelThickness: 2.4,
    bevelSegments: 2,
    curveSegments: 18,
  });
  g.translate(0, 0, -13);
  parts.push(paint(g, CONCRETE));

  // the mast
  parts.push(paint(cyl(0.8, 2.6, h - 196, 10, 6, 196, 0), CONCRETE));
  // helipad ring
  const ring = new THREE.TorusGeometry(15, 1.6, 6, 22);
  ring.rotateX(Math.PI / 2);
  ring.translate(18, 92, 0);
  parts.push(paint(ring, GOLD));
  return parts;
}

function triTower(h, baseR = 26, twist = 0.22) {
  const sections = [];
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = baseR * (1 - 0.32 * t);
    sections.push({ y: t * h, pts: triPts(r, twist * t) });
  }
  const parts = [paint(loft(sections), GLASS)];
  parts.push(paint(cyl(baseR * 0.9, baseR * 1.05, 12, 18), CONCRETE_DARK));
  return parts;
}

function twistTower(h, size = 22, turns = 1.5) {
  const sections = [];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const r = size * (1 - 0.16 * t);
    sections.push({ y: t * h, pts: squarePts(r, t * turns * Math.PI) });
  }
  const parts = [paint(loft(sections), GLASS)];
  parts.push(paint(box(size * 3.4, 10, size * 3.4, 0, 0, 0, Math.PI / 4), CONCRETE_DARK));
  return parts;
}

function crownTower(h, r = 20) {
  const sections = [];
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    let rr = r * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(t, 0.85)));
    if (t > 0.9) rr *= 1.0 - (t - 0.9) * 2.2;
    sections.push({ y: t * h, pts: circlePts(Math.max(1.5, rr), 18) });
  }
  const parts = [paint(loft(sections), GLASS)];
  // the crown ring
  const ring = new THREE.TorusGeometry(r * 0.72, 2.6, 6, 26);
  ring.rotateX(Math.PI / 2);
  ring.translate(0, h * 0.9, 0);
  parts.push(paint(ring, GOLD));
  return parts;
}

function ringLandmark(h) {
  const parts = [];
  const r = h * 0.42;
  const torus = new THREE.TorusGeometry(r, r * 0.21, 14, 64);
  torus.rotateY(Math.PI / 2);
  torus.rotateZ(0.12);
  torus.translate(0, h * 0.52, 0);
  parts.push(paint(torus, GLASS_WARM));

  // plinth
  const mound = new THREE.SphereGeometry(h * 0.85, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  mound.scale(1.35, 0.42, 1.0);
  mound.translate(0, 0, 0);
  parts.push(paint(mound, CONCRETE));
  return parts;
}

function wheelLandmark(h) {
  const parts = [];
  const R = h * 0.42;
  const cy = h - R;
  const wheel = new THREE.TorusGeometry(R, R * 0.035, 8, 72);
  wheel.translate(0, cy, 0);
  parts.push(paint(wheel, CONCRETE));

  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = box(R, 1.4, 1.4, R / 2, 0, 0);
    spoke.rotateZ(a);
    spoke.translate(0, cy, 0);
    parts.push(paint(spoke, CONCRETE_DARK));
  }

  const hub = cyl(R * 0.09, R * 0.09, R * 0.5, 14, 0, cy - R * 0.25, 0);
  hub.rotateX(Math.PI / 2);
  parts.push(paint(hub, GLASS_DARK));

  // cabins
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const pod = new THREE.SphereGeometry(R * 0.05, 10, 8);
    pod.scale(1, 1.4, 1);
    pod.translate(Math.cos(a) * R, cy + Math.sin(a) * R, 0);
    parts.push(paint(pod, GOLD));
  }

  // legs
  parts.push(paint(box(3, cy, 3, -R * 0.16, 0, 0, 0), CONCRETE));
  parts.push(paint(box(3, cy, 3, R * 0.16, 0, 0, 0), CONCRETE));
  return parts;
}

function frameLandmark(h) {
  const parts = [];
  const legW = 26;
  const depth = 44;
  parts.push(paint(box(legW, h, depth, -46, 0, 0), GLASS));
  parts.push(paint(box(legW, h, depth, 46, 0, 0), GLASS));

  // the picture frame that spans the void
  const outer = new THREE.Shape();
  outer.moveTo(-70, h * 0.42);
  outer.lineTo(70, h * 0.42);
  outer.lineTo(70, h);
  outer.lineTo(-70, h);
  outer.lineTo(-70, h * 0.42);
  const hole = new THREE.Path();
  hole.moveTo(-44, h * 0.48);
  hole.lineTo(-44, h * 0.93);
  hole.lineTo(44, h * 0.93);
  hole.lineTo(44, h * 0.48);
  hole.lineTo(-44, h * 0.48);
  outer.holes.push(hole);
  const plate = new THREE.ExtrudeGeometry(outer, { depth: depth * 0.55, bevelEnabled: false });
  plate.translate(0, 0, -depth * 0.275);
  parts.push(paint(plate, GLASS_DARK));
  parts.push(paint(box(150, 8, depth * 0.8, 0, 0, 0), CONCRETE_DARK));
  return parts;
}

function opusLandmark(h) {
  const parts = [];
  const r = h * 0.44;
  // side elevation with a circular void, extruded sideways so the tunnel is
  // horizontal — the signature of The Opus.
  const s = new THREE.Shape();
  s.moveTo(-r, 0);
  s.lineTo(r, 0);
  s.lineTo(r, h);
  s.lineTo(-r, h);
  s.lineTo(-r, 0);
  const hole = new THREE.Path();
  hole.absarc(0, h * 0.68, r * 0.66, 0, Math.PI * 2, false);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: h * 0.86, bevelEnabled: false, curveSegments: 24 });
  g.translate(0, 0, -h * 0.43);
  parts.push(paint(g, GLASS));
  return parts;
}

function atlantisLandmark(h) {
  const parts = [];
  const w = 46;
  const d = 58;
  const wing = (x) => {
    const secs = [];
    const steps = 10;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const rw = w * (1 - 0.3 * t);
      const rd = d * (1 - 0.22 * t);
      const pts = [];
      const N = 16;
      for (let k = 0; k < N; k++) {
        const a = (k / N) * Math.PI * 2;
        const cx = Math.cos(a) * rw;
        const cz = Math.sin(a) * rd;
        const bulge = 1 + 0.12 * Math.cos(a * 2);
        pts.push([cx * bulge, cz * bulge]);
      }
      secs.push({ y: t * h, pts });
    }
    return secs;
  };
  parts.push(paint(loft(wing(-46)), CONCRETE));
  parts.push(paint(loft(wing(46)), CONCRETE));

  // arch between the towers
  const arch = new THREE.TorusGeometry(46, 13, 10, 26, Math.PI);
  arch.rotateY(Math.PI / 2);
  arch.translate(0, h * 0.52, 0);
  parts.push(paint(arch, CONCRETE));

  // crown sphere
  const crown = new THREE.SphereGeometry(15, 18, 12);
  crown.translate(0, h + 6, 0);
  parts.push(paint(crown, GOLD));
  return parts;
}

function palaceLandmark(h) {
  const parts = [];
  parts.push(paint(box(230, 26, 96, 0, 0, 0), CONCRETE));
  parts.push(paint(box(120, 46, 70, 0, 26, 0), CONCRETE));
  const dome = new THREE.SphereGeometry(30, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1, 0.75, 1);
  dome.translate(0, 72, 0);
  parts.push(paint(dome, GOLD));
  parts.push(paint(cyl(1.6, 2.2, 26, 8, 0, 92, 0), GOLD));
  for (const sx of [-1, 1]) {
    parts.push(paint(cyl(11, 13, 34, 12, sx * 105, 26, 0), CONCRETE));
  }
  return parts;
}

function windTower(h = 18) {
  const parts = [];
  parts.push(paint(box(12, 12, 12, 0, 0, 0), CONCRETE));
  parts.push(paint(box(4, h, 4, 0, 12, 0), CONCRETE));
  parts.push(paint(box(9, 2.4, 9, 0, 12 + h - 2.4, 0), CONCRETE_DARK));
  return parts;
}

/* ------------------------------------------------------------------ */

const MODELS = {
  'y-plan': yPlanTower,
  sail: sailTower,
  tri: (h) => triTower(h, 26),
  twist: (h) => twistTower(h, 22),
  crown: (h) => crownTower(h, 20),
  ring: ringLandmark,
  wheel: wheelLandmark,
  frame: frameLandmark,
  opus: opusLandmark,
  atlantis: atlantisLandmark,
  palace: palaceLandmark,
};

export function createLandmarks() {
  const group = new THREE.Group();
  group.name = 'landmarks';

  const uniforms = {
    uNight: { value: 0 },
    uGlow: { value: new THREE.Color(0xffc478) },
  };

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.12,
    emissive: new THREE.Color(0x1b2733),
    side: THREE.DoubleSide,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vLandPos;')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n vLandPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\n uniform float uNight;\n uniform vec3 uGlow;\n varying vec3 vLandPos;'
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         if (uNight > 0.001) {
           float fy = vLandPos.y / 3.6;
           float cx = (vLandPos.x + vLandPos.z) / 3.6;
           float f = fract(fy);
           float c = fract(cx);
           float win = step(0.18, f) * step(f, 0.80) * step(0.16, c) * step(c, 0.82);
           float r = fract(sin(floor(fy) * 31.7 + floor(cx) * 17.3 + vLandPos.x * 0.031) * 43758.5);
           totalEmissiveRadiance += uGlow * win * step(0.5, r) * uNight * 0.85;
         }`
      );
  };

  const entries = [];

  for (const t of TOWERS) {
    const make = MODELS[t.kind] || triTower;
    const parts = make(t.height);
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.position.set(lonToX(t.lon), 0, latToZ(t.lat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = t.id;
    mesh.userData.landmark = t;
    group.add(mesh);
    entries.push({ mesh, data: t, height: t.height });
  }

  // a little Deira skyline of wind towers and low courtyard houses
  const deira = [
    [55.3119, 25.2703, 20],
    [55.3126, 25.2694, 17],
    [55.3108, 25.2686, 19],
    [55.3134, 25.2712, 16],
    [55.3095, 25.2711, 18],
    [55.3141, 25.2681, 15],
  ];
  for (const [lon, lat, h] of deira) {
    const parts = windTower(h);
    const merged = mergeGeometries(parts, false);
    parts.forEach((p) => p.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.position.set(lonToX(lon), 0, latToZ(lat));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    entries.push({ mesh, data: { name: 'Wind tower', height: h, lon, lat }, height: h });
  }

  return {
    group,
    material,
    entries,
    apply(p) {
      uniforms.uNight.value = p.night;
      uniforms.uGlow.value.set(p.night > 0.5 ? 0xffbe70 : 0xffd7a2);
    },
  };
}
