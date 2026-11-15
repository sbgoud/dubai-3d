/**
 * Renderer, camera, sky, lighting and the day / golden / night transitions.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MODES, sunVector } from './config.js';

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  varying vec3 vDir;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGroundCol;
  uniform vec3 uSunCol;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform float uSunSize;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uGroundCol, smoothstep(0.0, -0.22, h));

    float sd = max(dot(d, uSunDir), 0.0);
    col += uSunCol * pow(sd, uSunSize) * 6.0;
    col += uSunCol * pow(sd, 9.0) * 0.30;
    col += uSunCol * pow(sd, 2.2) * 0.09;

    if (uNight > 0.01) {
      vec2 sp = vec2(atan(d.z, d.x) * 1.6, asin(clamp(h, -1.0, 1.0)) * 2.6);
      vec2 g = sp * 118.0;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float r = hash21(cell);
      if (r > 0.955) {
        vec2 p = vec2(hash21(cell + 3.7), hash21(cell + 11.3));
        float dd = length((f - p) * vec2(1.0, 1.6));
        float tw = 0.55 + 0.45 * sin(r * 90.0 + d.x * 12.0);
        col += vec3(0.82, 0.88, 1.0) * smoothstep(0.16, 0.0, dd) * ((r - 0.955) / 0.045) * uNight * tw * 1.6;
      }
      col += vec3(0.05, 0.07, 0.12) * uNight * (1.0 - smoothstep(-0.05, 0.5, h));
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Viewer {
  constructor(container, options = {}) {
    this.container = container;
    this.quality = options.quality || 'high';

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    renderer.setPixelRatio(this._pixelRatio());
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = options.shadows !== false;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x060a10, 1);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xc3d8e8, 0.0000165);

    this.camera = new THREE.PerspectiveCamera(42, 1, 20, 200000);
    this.camera.position.set(1200, 900, 2100);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.rotateSpeed = 0.52;
    this.controls.zoomSpeed = 0.85;
    this.controls.panSpeed = 0.7;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 220;
    this.controls.maxDistance = 62000;
    this.controls.minPolarAngle = 0.06;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.035;
    this.controls.target.set(0, 0, 0);

    // --- sky ------------------------------------------------------------
    const skyGeo = new THREE.SphereGeometry(600, 40, 24);
    this.skyUniforms = {
      uZenith: { value: new THREE.Color(0x2f6bb0) },
      uHorizon: { value: new THREE.Color(0xc6dced) },
      uGroundCol: { value: new THREE.Color(0x9c8a6f) },
      uSunCol: { value: new THREE.Color(0xfff3df) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uNight: { value: 0 },
      uSunSize: { value: 900 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      toneMapped: true,
    });
    this.sky = new THREE.Mesh(skyGeo, skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    // --- lights ---------------------------------------------------------
    this.sun = new THREE.DirectionalLight(0xfff3df, 2.55);
    this.sun.castShadow = true;
    const mapSize = this.quality === 'low' ? 1024 : 2048;
    this.sun.shadow.mapSize.set(mapSize, mapSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 1.8;
    this.sun.shadow.camera.near = 50;
    this.sun.shadow.camera.far = 26000;
    this._shadowExtent = 1800;
    this._applyShadowExtent(this._shadowExtent);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x9dc4e8, 0xc3ae8b, 1.0);
    this.scene.add(this.hemi);

    // --- mode state -----------------------------------------------------
    this.mode = 'day';
    this.palette = structuredClone(MODES.day);
    this._from = structuredClone(MODES.day);
    this._to = structuredClone(MODES.day);
    this._blend = 1;
    this._blendSpeed = 1 / 1.1;

    this._sunDir = new THREE.Vector3();
    this.fly = null;
    this.clock = new THREE.Clock();
    this._tmp = new THREE.Vector3();

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(container);
    }
    this._onResize();
  }

  _pixelRatio() {
    const dpr = window.devicePixelRatio || 1;
    if (this.quality === 'low') return Math.min(dpr, 1.35);
    if (this.quality === 'medium') return Math.min(dpr, 1.7);
    return Math.min(dpr, 2);
  }

  _applyShadowExtent(d) {
    const cam = this.sun.shadow.camera;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.updateProjectionMatrix();
  }

  _onResize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  /** Current camera distance to the orbit target. */
  get distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  setMode(name) {
    if (!MODES[name] || name === this.mode) return;
    this._from = structuredClone(this.palette);
    this._to = structuredClone(MODES[name]);
    this._blend = 0;
    this.mode = name;
  }

  /**
   * Fly the camera to a point of interest.
   * @param {THREE.Vector3} target world position to look at
   */
  flyTo(target, { distance = 2200, yaw = 0.6, pitch = 0.6, duration = 1900 } = {}) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const sph = new THREE.Spherical().setFromVector3(offset);
    const to = new THREE.Spherical(
      distance,
      Math.PI / 2 - pitch,
      yaw
    );
    // shortest angular path
    const dTheta = Math.atan2(Math.sin(to.theta - sph.theta), Math.cos(to.theta - sph.theta));
    this.fly = {
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromSph: sph,
      dTheta,
      toSph: to,
      start: performance.now(),
      duration,
    };
  }

  _updateFly(now) {
    const f = this.fly;
    if (!f) return;
    const t = Math.min(1, (now - f.start) / f.duration);
    const e = easeInOut(t);
    this.controls.target.lerpVectors(f.fromTarget, f.toTarget, e);
    const sph = new THREE.Spherical(
      THREE.MathUtils.lerp(f.fromSph.radius, f.toSph.radius, e),
      THREE.MathUtils.lerp(f.fromSph.phi, f.toSph.phi, e),
      f.fromSph.theta + f.dTheta * e
    );
    this.camera.position.setFromSpherical(sph).add(this.controls.target);
    if (t >= 1) this.fly = null;
  }

  /** Blend the lighting palette and push it into the scene. */
  _applyPalette(dt) {
    if (this._blend < 1) {
      this._blend = Math.min(1, this._blend + dt * this._blendSpeed);
      const k = easeInOut(this._blend);
      const lerp = (a, b) => a + (b - a) * k;
      const lerpC = (a, b) => new THREE.Color(a).lerp(new THREE.Color(b), k);
      const p = this.palette;
      p.sun.azimuth = lerp(this._from.sun.azimuth, this._to.sun.azimuth);
      p.sun.elevation = lerp(this._from.sun.elevation, this._to.sun.elevation);
      p.sun.intensity = lerp(this._from.sun.intensity, this._to.sun.intensity);
      p.sun.color = lerpC(this._from.sun.color, this._to.sun.color).getHex();
      p.sky.zenith = lerpC(this._from.sky.zenith, this._to.sky.zenith).getHex();
      p.sky.horizon = lerpC(this._from.sky.horizon, this._to.sky.horizon).getHex();
      p.sky.ground = lerpC(this._from.sky.ground, this._to.sky.ground).getHex();
      p.ambient.sky = lerpC(this._from.ambient.sky, this._to.ambient.sky).getHex();
      p.ambient.ground = lerpC(this._from.ambient.ground, this._to.ambient.ground).getHex();
      p.ambient.intensity = lerp(this._from.ambient.intensity, this._to.ambient.intensity);
      p.fog.color = lerpC(this._from.fog.color, this._to.fog.color).getHex();
      p.fog.density = lerp(this._from.fog.density, this._to.fog.density);
      p.exposure = lerp(this._from.exposure, this._to.exposure);
      p.night = lerp(this._from.night, this._to.night);
      p.water.deep = lerpC(this._from.water.deep, this._to.water.deep).getHex();
      p.water.shallow = lerpC(this._from.water.shallow, this._to.water.shallow).getHex();
      p.water.foam = lerpC(this._from.water.foam, this._to.water.foam).getHex();
      p.ground.sand = lerpC(this._from.ground.sand, this._to.ground.sand).getHex();
      p.ground.urban = lerpC(this._from.ground.urban, this._to.ground.urban).getHex();
      p.ground.green = lerpC(this._from.ground.green, this._to.ground.green).getHex();
      p.ground.road = lerpC(this._from.ground.road, this._to.ground.road).getHex();
    }

    const p = this.palette;
    sunVector(p.sun.azimuth, p.sun.elevation, this._sunDir);

    this.sun.color.set(p.sun.color);
    this.sun.intensity = p.sun.intensity;
    this.hemi.color.set(p.ambient.sky);
    this.hemi.groundColor.set(p.ambient.ground);
    this.hemi.intensity = p.ambient.intensity;
    this.scene.fog.color.set(p.fog.color);
    this.scene.fog.density = p.fog.density;
    this.renderer.toneMappingExposure = p.exposure;

    this.skyUniforms.uZenith.value.set(p.sky.zenith);
    this.skyUniforms.uHorizon.value.set(p.sky.horizon);
    this.skyUniforms.uGroundCol.value.set(p.sky.ground);
    this.skyUniforms.uSunCol.value.set(p.sun.color);
    this.skyUniforms.uSunDir.value.copy(this._sunDir);
    this.skyUniforms.uNight.value = p.night;
    this.skyUniforms.uSunSize.value = p.night > 0.5 ? 1400 : 900;
  }

  update() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const now = performance.now();

    this._applyPalette(dt);
    this._updateFly(now);
    this.controls.update();

    // keep the sun and its shadow volume over the orbit target
    const t = this.controls.target;
    this.sun.position.copy(t).addScaledVector(this._sunDir, 9000);
    this.sun.target.position.copy(t);
    this.sun.target.updateMatrixWorld();

    const dist = this.distance;
    const wanted = Math.round(
      Math.min(11000, Math.max(700, dist * 0.62)) / 100
    ) * 100;
    if (wanted !== this._shadowExtent) {
      this._shadowExtent = wanted;
      this._applyShadowExtent(wanted);
    }

    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
    return dt;
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    if (this._ro) this._ro.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
