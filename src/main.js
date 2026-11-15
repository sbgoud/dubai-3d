/**
 * Dubai 3D — application entry point.
 */

import * as THREE from 'three';
import { Viewer } from './core/viewer.js';
import { UI } from './ui/ui.js';
import { loadCityMeta, loadBuildings, loadRoads } from './data/load.js';
import { createGround } from './world/ground.js';
import { createBuildings } from './world/buildings.js';
import { createRoads } from './world/roads.js';
import { createLandmarks } from './world/landmarks.js';
import { LANDMARKS, TOWERS, lonToX, latToZ, xToLon, zToLat } from './core/config.js';

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

  async function boot() {
    try {
      ui.setProgress(0.02, 'Reading the survey');
      const meta = await loadCityMeta(DATA);

      ui.setProgress(0.07, 'Charting the shoreline');
      const [water, green, urban] = await Promise.all([
        loadTexture(`${DATA}water.png`),
        loadTexture(`${DATA}green.png`),
        loadTexture(`${DATA}urban.png`),
      ]);

      ui.setProgress(0.16, 'Tracing the road network');
      const roadFile = await loadRoads(DATA, (loaded, total) => {
        const f = total ? loaded / total : 0;
        ui.setProgress(0.16 + 0.1 * f, 'Tracing the road network');
      });

      ui.setProgress(0.28, 'Raising the skyline');
      const buildingFile = await loadBuildings(DATA, (loaded, total) => {
        const f = total ? loaded / total : 0;
        ui.setProgress(0.28 + 0.44 * f, 'Raising the skyline');
      });

      ui.setProgress(0.74, 'Laying out the blocks');
      const roads = createRoads(roadFile);
      viewer.scene.add(roads.mesh);
      world.roads = roads;

      ui.setProgress(0.78, 'Building 273,000 properties');
      const buildings = createBuildings(buildingFile);
      const suppressors = TOWERS.map((t) => ({
        x: lonToX(t.lon),
        z: latToZ(t.lat),
        r: t.kind === 'atlantis' || t.kind === 'wheel' ? 170 : t.kind === 'sail' ? 130 : 95,
      }));
      const minHeight = skyline !== null ? parseFloat(skyline) || 40 : quality === 'low' ? 7.5 : 0;
      await buildings.build(minHeight, suppressors, (f) => {
        ui.setProgress(0.78 + 0.16 * f, 'Building 273,000 properties');
      });
      viewer.scene.add(buildings.group);
      world.buildings = buildings;

      ui.setProgress(0.95, 'Modelling the landmarks');
      const ground = createGround({ water, green, urban }, viewer.palette);
      viewer.scene.add(ground.mesh);
      world.ground = ground;

      const landmarks = createLandmarks();
      viewer.scene.add(landmarks.group);
      world.landmarks = landmarks;

      applyPalette(viewer.palette);

      ui.setProgress(1, 'Ready');
      setTimeout(() => ui.hideLoader(), 320);

      wireInteraction();
      start();
    } catch (err) {
      console.error(err);
      ui.showLoaderError(err && err.message ? err.message : String(err));
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

  boot();

}

main();
