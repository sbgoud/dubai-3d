/**
 * Dubai 3D — application entry point.
 */

import * as THREE from 'three';
import { Viewer } from './core/viewer.js';
import { UI } from './ui/ui.js';
import { loadCityMeta, loadBuildingIndex, loadBuildingChunk, loadRoads } from './data/load.js';
import { createGround } from './world/ground.js';
import { createBuildings } from './world/buildings.js';
import { createRoads } from './world/roads.js';
import { createLandmarks } from './world/landmarks.js';
import { CENTER, TOWERS, lonToX, latToZ, xToLon, zToLat } from './core/config.js';

const DATA = 'data/';

function detectQuality() {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  const mobile = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile/i.test(ua);
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile || (touch && window.innerWidth < 900)) return 'low';
  if (cores >= 8) return 'high';
  return 'medium';
}

const KIND_BLURB = {
  'y-plan': 'A stepped buttressed tower, modelled as it rises from a tapering core.',
  sail: 'A soaring sail of white concrete, anchored on its own island.',
  tri: 'A tapering triangular tower of blue-green glass.',
  twist: 'A tower that turns through a hundred degrees as it climbs.',
  crown: 'A slender tower with a flared crown and a hole through the top.',
  ring: 'A torus of glass set into a sculpted plinth.',
  wheel: 'A 250 metre observation wheel turning over the coast.',
  frame: 'Two towers joined by a vast frame with the sky inside it.',
  opus: 'A cube hollowed out by a single vast void.',
  atlantis: 'Two wings and an arch, crowning the apex of the Palm.',
  palace: 'A low, wide palace with a gilded dome, standing on its own island.',
};

function main() {
  const params = new URLSearchParams(location.search);
  const quality = params.get('q') || detectQuality();
  const skyline = params.get('skyline');
  const noShadow = params.get('noshadow') === '1';
  const container = document.getElementById('scene');

  let viewer;
  try {
    viewer = new Viewer(container, { quality, shadows: !noShadow });
  } catch (err) {
    console.error(err);
    const status = document.getElementById('load-status');
    if (status) status.textContent = 'This browser cannot open a WebGL context';
    return;
  }

  const ui = new UI(viewer, {
    onSelect: (lm) => {
      const target = new THREE.Vector3(lonToX(lm.lon), lm.height ? lm.height * 0.45 : 120, latToZ(lm.lat));
      viewer.flyTo(target, {
        distance: lm.focus.distance,
        yaw: lm.focus.yaw,
        pitch: lm.focus.pitch,
      });
    },
    onReturn: () => {
      ui.clearSelection();
      viewer.flyTo(new THREE.Vector3(0, 0, 0), { distance: 5400, yaw: 2.1, pitch: 0.62 });
    },
    onMode: () => {},
  });

  // opening framing: downtown with the Gulf beyond
  const phi = Math.PI / 2 - 0.62;
  const d = 5400;
  viewer.camera.position.set(
    d * Math.sin(phi) * Math.sin(2.1),
    d * Math.cos(phi),
    -d * Math.sin(phi) * Math.cos(2.1)
  );
  viewer.controls.target.set(0, 0, 0);
  viewer.controls.update();

  const world = { ground: null, buildings: null, roads: null, landmarks: null };

  function loadTexture(url) {
    return new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => {
          tex.wrapS = THREE.ClampToEdgeWrapping;
          tex.wrapT = THREE.ClampToEdgeWrapping;
          tex.colorSpace = THREE.NoColorSpace;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
          tex.magFilter = THREE.LinearFilter;
          tex.generateMipmaps = true;
          tex.anisotropy = Math.min(8, viewer.renderer.capabilities.getMaxAnisotropy());
          tex.needsUpdate = true;
          resolve(tex);
        },
        undefined,
        () => reject(new Error(`could not load ${url}`))
      );
    });
  }

  function makeFallbackTexture(value) {
    const tex = new THREE.DataTexture(new Uint8Array([value]), 1, 1, THREE.RedFormat);
    tex.needsUpdate = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.NearestFilter;
    tex.magFilter = THREE.NearestFilter;
    return tex;
  }

  function chunkDistance(chunk, target) {
    const x0 = chunk.x0 - CENTER.x;
    const x1 = chunk.x1 - CENTER.x;
    const z0 = CENTER.y - chunk.y1;
    const z1 = CENTER.y - chunk.y0;
    const dx = target.x < x0 ? x0 - target.x : target.x > x1 ? target.x - x1 : 0;
    const dz = target.z < z0 ? z0 - target.z : target.z > z1 ? target.z - z1 : 0;
    return Math.hypot(dx, dz);
  }

  function streamBuildings(index, meta, minHeight, suppressors) {
    const buildings = world.buildings;
    const all = (index.chunks || []).slice();
    const status = { total: all.length, succeeded: 0, failed: 0, ready: false };
    if (window.__dubai) window.__dubai.chunkStatus = status;

    if (!all.length) {
      ui.showLoaderError('The city index is empty.');
      return;
    }

    all.sort((a, b) => chunkDistance(a, viewer.controls.target) - chunkDistance(b, viewer.controls.target));

    // Keep the first screen under ~3 MB even on an uncompressed response.
    const BOOT_BYTES = 1000 * 1024;
    const boot = [];
    let bootBytes = 0;
    for (const chunk of all) {
      if (boot.length && bootBytes + chunk.bytes > BOOT_BYTES) break;
      boot.push(chunk);
      bootBytes += chunk.bytes;
    }
    const bootIds = new Set(boot.map((chunk) => chunk.id));

    const queue = all.slice();
    let bootLeft = boot.length;
    let inFlight = 0;
    let ready = false;

    function markReady() {
      if (ready) return;
      ready = true;
      status.ready = true;
      ui.setProgress(1, 'Ready');
      setTimeout(() => ui.hideLoader(), 220);
    }

    function updateBootProgress() {
      if (ready) return;
      const f = boot.length ? (boot.length - bootLeft) / boot.length : 0;
      ui.setProgress(0.28 + 0.62 * Math.min(1, f), 'Raising the skyline');
    }

    function sortQueue() {
      const target = viewer.controls.target;
      queue.sort((a, b) => chunkDistance(a, target) - chunkDistance(b, target));
    }

    async function loadOne(chunk) {
      inFlight++;
      try {
        const data = await loadBuildingChunk(DATA, meta, chunk.file);
        await new Promise((resolve) => setTimeout(resolve, 0));
        buildings.addTile(data.tile(), minHeight, suppressors);
        status.succeeded++;
        markReady();
      } catch (err) {
        status.failed++;
        console.warn(`[dubai] building chunk ${chunk.id} failed:`, err);
      } finally {
        if (bootIds.has(chunk.id) && bootLeft > 0) bootLeft--;
        updateBootProgress();
        inFlight--;
        pump();
      }
    }

    function pump() {
      if (ready) sortQueue();
      const max = ready ? 4 : bootLeft > 0 ? 2 : 3;
      while (inFlight < max && queue.length) {
        loadOne(queue.shift());
      }
      if (!queue.length && inFlight === 0) {
        if (!status.succeeded) {
          ui.showLoaderError('We could not load the city buildings. Check your connection and try again.');
        } else {
          markReady();
        }
      }
    }

    pump();
  }

  async function boot() {
    try {
      ui.setProgress(0.02, 'Reading the survey');
      const meta = await loadCityMeta(DATA);

      ui.setProgress(0.06, 'Charting the shoreline');
      const [index, water, green, urban, roadFile] = await Promise.all([
        loadBuildingIndex(DATA, meta).catch((err) => {
          console.warn('[dubai] building index failed:', err);
          return null;
        }),
        loadTexture(`${DATA}water.png`).catch(() => makeFallbackTexture(255)),
        loadTexture(`${DATA}green.png`).catch(() => makeFallbackTexture(0)),
        loadTexture(`${DATA}urban.png`).catch(() => makeFallbackTexture(0)),
        loadRoads(DATA, meta).catch((err) => {
          console.warn('[dubai] roads failed:', err);
          return null;
        }),
      ]);

      if (!index) throw new Error('The city index could not be loaded.');

      ui.setProgress(0.18, 'Laying out the ground');
      const ground = createGround({ water, green, urban }, viewer.palette);
      viewer.scene.add(ground.mesh);
      world.ground = ground;

      if (roadFile) {
        ui.setProgress(0.22, 'Tracing the road network');
        const roads = createRoads(roadFile);
        viewer.scene.add(roads.mesh);
        world.roads = roads;
      }

      ui.setProgress(0.25, 'Modelling the landmarks');
      const landmarks = createLandmarks();
      viewer.scene.add(landmarks.group);
      world.landmarks = landmarks;
      applyPalette(viewer.palette);

      const suppressors = TOWERS.map((t) => ({
        x: lonToX(t.lon),
        z: latToZ(t.lat),
        r: t.kind === 'atlantis' || t.kind === 'wheel' ? 170 : t.kind === 'sail' ? 130 : 95,
      }));
      const minHeight = skyline !== null ? parseFloat(skyline) || 40 : quality === 'low' ? 7.5 : 0;

      const buildings = createBuildings();
      viewer.scene.add(buildings.group);
      world.buildings = buildings;

      ui.setProgress(0.28, 'Raising the skyline');
      await new Promise((resolve) => setTimeout(resolve, 0));
      streamBuildings(index, meta, minHeight, suppressors);
    } catch (err) {
      console.error(err);
      ui.showLoaderError('We could not load the city. Check your connection and try again.');
    }
  }

  function applyPalette(p) {
    if (world.ground) world.ground.apply(p);
    if (world.buildings) world.buildings.apply(p);
    if (world.roads) world.roads.apply(p);
    if (world.landmarks) world.landmarks.apply(p);
  }

  /* ---------------------------------------------------------------- */

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  function pick(ev) {
    const rect = viewer.renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, viewer.camera);

    if (world.landmarks) {
      const hits = raycaster.intersectObjects(world.landmarks.group.children, false);
      if (hits.length) return { type: 'tower', data: hits[0].object.userData.landmark };
    }
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) return { type: 'ground', point: hit };
    return null;
  }

  function wireInteraction() {
    const canvas = viewer.renderer.domElement;
    let down = null;

    canvas.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });

    canvas.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 420;
      down = null;
      if (moved > 6 || !quick) return;
      ui.dismissHint();
      const hit = pick(e);
      if (!hit) return;
      if (hit.type === 'tower' && hit.data) {
        const t = hit.data;
        ui.showPlace(
          t.name || 'Tower',
          t.height ? `${t.height} m` : '',
          `${KIND_BLURB[t.kind] || 'A tower modelled at its published height.'}`
        );
        viewer.flyTo(new THREE.Vector3(lonToX(t.lon), (t.height || 120) * 0.5, latToZ(t.lat)), {
          distance: Math.max(420, (t.height || 120) * 2.6),
          yaw: 2.2,
          pitch: 0.6,
        });
      }
    });

    canvas.addEventListener('dblclick', (e) => {
      const hit = pick(e);
      if (!hit || hit.type !== 'ground') return;
      const p = hit.point;
      viewer.flyTo(new THREE.Vector3(p.x, 0, p.z), {
        distance: Math.max(600, viewer.distance * 0.55),
        yaw: viewer.controls.getAzimuthalAngle(),
        pitch: 0.72,
        duration: 1500,
      });
      ui.showPlace(
        `${zToLat(p.z).toFixed(4)}° N, ${xToLon(p.x).toFixed(4)}° E`,
        `${Math.round(viewer.distance)} m view`,
        'A point on the ground plane, positioned from the OpenStreetMap survey of central Dubai.'
      );
    });

    canvas.addEventListener('pointermove', () => ui.dismissHint());
  }

  /* ---------------------------------------------------------------- */

  function start() {
    const manual = params.get('render') === 'manual';
    let raf = 0;
    const frame = () => {
      viewer.update();
      applyPalette(viewer.palette);
      ui.update();
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      frame();
    };
    if (!manual) loop();
    window.__dubai = {
      viewer,
      ui,
      world,
      render: frame,
      pause: () => cancelAnimationFrame(raf),
      resume: () => loop(),
    };
  }

  wireInteraction();
  start();
  boot();

}

main();
