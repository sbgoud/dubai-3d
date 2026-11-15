/**
 * The ground: a single shader-driven plane that reads the shoreline signed
 * distance field, vegetation and built-up density masks that were baked at
 * extract time. Land, beach, shallow water and deep sea all come from one
 * surface so there is never a seam.
 */

import * as THREE from 'three';
import { GEO, CENTER, SCENE } from '../core/config.js';

const VERT_HEAD = /* glsl */ `
  varying vec3 vWPos;
  varying vec2 vMaskUv;
  uniform vec2 uOrigin;   // stored-metre origin of the bbox (x, y)
  uniform vec2 uSpan;     // stored-metre size of the bbox
`;

const VERT_BODY = /* glsl */ `
  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec2 stored = vec2(vWPos.x + uOrigin.x, -vWPos.z + uOrigin.y);
  vMaskUv = stored / uSpan;
`;

const FRAG_HEAD = /* glsl */ `
  varying vec3 vWPos;
  varying vec2 vMaskUv;
  uniform sampler2D uWater;
  uniform sampler2D uGreen;
  uniform sampler2D uUrban;
  uniform vec3 uSand;
  uniform vec3 uUrbanCol;
  uniform vec3 uGreenCol;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uFoam;
  uniform float uNight;
  uniform float uTime;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
`;

const FRAG_COLOR = /* glsl */ `
  vec2 muv = clamp(vMaskUv, 0.0, 1.0);
  float raw = texture2D(uWater, muv).r;
  float sdf = (raw * 255.0 - 127.0) * 10.0;
  float greenM = texture2D(uGreen, muv).r;
  float urbanM = texture2D(uUrban, muv).r;

  float inside = step(0.0, vMaskUv.x) * step(vMaskUv.x, 1.0) * step(0.0, vMaskUv.y) * step(vMaskUv.y, 1.0);
  sdf = mix(-600.0, sdf, inside);

  // --- land -------------------------------------------------------------
  float grain = valueNoise(vWPos.xz * 0.0022) * 0.5 + valueNoise(vWPos.xz * 0.011) * 0.28;
  vec3 land = uSand * (0.86 + grain * 0.34);
  land = mix(land, uUrbanCol * (0.86 + grain * 0.38), smoothstep(0.08, 0.92, urbanM) * 0.72);
  land = mix(land, uGreenCol * (0.84 + grain * 0.4), smoothstep(0.10, 0.62, greenM) * 0.85);
  float beach = 1.0 - smoothstep(0.0, 110.0, sdf);
  land = mix(land, mix(land, uFoam * 0.86 + vec3(0.05), 0.55), beach * 0.8);

  // --- water ------------------------------------------------------------
  float depth = clamp(-sdf / 620.0, 0.0, 1.0);
  vec3 water = mix(uShallow, uDeep, pow(depth, 0.72));
  float foam = smoothstep(-16.0, -1.0, sdf) * (1.0 - smoothstep(-1.0, 4.0, sdf));
  float ripple = valueNoise(vWPos.xz * 0.012 + uTime * 0.02) * 0.5 + valueNoise(vWPos.xz * 0.05 - uTime * 0.035) * 0.5;
  water += (ripple - 0.5) * 0.035;

  float isWater = smoothstep(6.0, -6.0, sdf);
  vec3 albedo = mix(land, water, isWater);
  albedo = mix(albedo, uFoam, foam * 0.55);
`;

export function createGround(textures, palette) {
  const geo = new THREE.PlaneGeometry(SCENE.far, SCENE.far, 1, 1);
  geo.rotateX(-Math.PI / 2);

  const uniforms = {
    uWater: { value: textures.water },
    uGreen: { value: textures.green },
    uUrban: { value: textures.urban },
    uSand: { value: new THREE.Color(palette.ground.sand) },
    uUrbanCol: { value: new THREE.Color(palette.ground.urban) },
    uGreenCol: { value: new THREE.Color(palette.ground.green) },
    uDeep: { value: new THREE.Color(palette.water.deep) },
    uShallow: { value: new THREE.Color(palette.water.shallow) },
    uFoam: { value: new THREE.Color(palette.water.foam) },
    uNight: { value: palette.night },
    uTime: { value: 0 },
    uOrigin: { value: new THREE.Vector2(CENTER.x, CENTER.y) },
    uSpan: { value: new THREE.Vector2(GEO.widthM, GEO.heightM) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0.0,
    dithering: true,
  });

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>\n${VERT_BODY}`
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>\n${FRAG_COLOR}\n diffuseColor.rgb *= albedo;`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n roughnessFactor = mix(0.94, 0.07, isWater);`
      )
      .replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\n metalnessFactor = mix(0.0, 0.35, isWater);`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         if (isWater > 0.01) {
           float w1 = sin(vWPos.x * 0.055 + vWPos.z * 0.031 + uTime * 1.15);
           float w2 = sin(vWPos.x * -0.037 + vWPos.z * 0.062 + uTime * 0.87);
           float w3 = sin(vWPos.x * 0.011 - vWPos.z * 0.014 + uTime * 0.41);
           vec3 wn = vec3(w1 * 0.045 + w3 * 0.03, 1.0, w2 * 0.045 + w3 * 0.03);
           normal = normalize(normal + (viewMatrix * vec4(wn, 0.0)).xyz * 0.85);
         }`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float glowMask = smoothstep(0.12, 0.6, urbanM) * (1.0 - isWater);
         totalEmissiveRadiance += vec3(0.95, 0.62, 0.30) * glowMask * uNight * 0.30;
         totalEmissiveRadiance += vec3(0.35, 0.55, 0.8) * isWater * uNight * 0.05;`
      );

    material.userData.shader = shader;
  };

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;

  return {
    mesh,
    uniforms,
    apply(p) {
      uniforms.uSand.value.set(p.ground.sand);
      uniforms.uUrbanCol.value.set(p.ground.urban);
      uniforms.uGreenCol.value.set(p.ground.green);
      uniforms.uDeep.value.set(p.water.deep);
      uniforms.uShallow.value.set(p.water.shallow);
      uniforms.uFoam.value.set(p.water.foam);
      uniforms.uNight.value = p.night;
    },
    update(t) {
      uniforms.uTime.value = t;
    },
  };
}
