/**
 * DOM chrome: loader, landmark index, info card, projected labels and the
 * small instruments along the right edge.
 */

import * as THREE from 'three';
import { LANDMARKS, lonToX, latToZ, xToLon, zToLat } from '../core/config.js';

const $ = (id) => document.getElementById(id);

const NICE = [1, 2, 5];

export class UI {
  constructor(viewer, handlers) {
    this.viewer = viewer;
    this.handlers = handlers;
    this.active = -1;
    this.markers = [];
    this._v = new THREE.Vector3();

    this.el = {
      loader: $('loader'),
      bar: $('load-bar'),
      status: $('load-status'),
      pct: $('load-pct'),
      panel: $('landmark-panel'),
      panelToggle: $('panel-toggle'),
      panelBody: document.querySelector('#landmark-panel .panel-body'),
      panelCount: document.querySelector('#landmark-panel .panel-meta b'),
      list: $('landmark-list'),
      info: $('info'),
      infoEyebrow: $('info-eyebrow'),
      infoTitle: $('info-title'),
      infoHeight: $('info-height'),
      infoMeta: $('info-meta'),
      infoDesc: $('info-desc'),
      infoReturn: $('info-return'),
      markers: $('markers'),
      compassN: $('compass-n'),
      compassRose: $('compass-rose'),
      scaleBar: $('scale-bar'),
      scaleLabel: $('scale-label'),
      coords: $('coord-readout'),
      hint: $('hint'),
      modes: Array.from(document.querySelectorAll('.mode-switch button')),
    };

    this._buildList();
    this._buildMarkers();
    this._wire();
  }

  /* ---------------------------------------------------------------- */

  _buildList() {
    const frag = document.createDocumentFragment();
    LANDMARKS.forEach((lm, i) => {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lm-btn';
      btn.dataset.index = String(i);
      btn.innerHTML = `
        <span class="lm-idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="lm-main">
          <span class="lm-name"></span>
          <span class="lm-sub"></span>
        </span>
        <svg class="lm-arrow" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/></svg>`;
      btn.querySelector('.lm-name').textContent = lm.name;
      btn.querySelector('.lm-sub').textContent = lm.height
        ? `${lm.district} · ${lm.height} m`
        : lm.district;
      btn.addEventListener('click', () => this.select(i, true));
      li.appendChild(btn);
      frag.appendChild(li);
    });
    this.el.list.appendChild(frag);
    if (this.el.panelCount) this.el.panelCount.textContent = String(LANDMARKS.length).padStart(2, '0');
  }

  _buildMarkers() {
    LANDMARKS.forEach((lm, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mk';
      btn.setAttribute('aria-label', lm.name);
      btn.innerHTML = '<span class="mk-dot"></span><span class="mk-label"></span>';
      const label = btn.querySelector('.mk-label');
      label.textContent = lm.name;
      if (lm.height) {
        const em = document.createElement('em');
        em.textContent = `${lm.height} m`;
        label.appendChild(em);
      }
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(i, true);
      });
      this.el.markers.appendChild(btn);
      this.markers.push({
        el: btn,
        index: i,
        pos: new THREE.Vector3(lonToX(lm.lon), lm.height ? lm.height * 0.86 : 90, latToZ(lm.lat)),
        visible: true,
      });
    });
  }

  _wire() {
    this.el.modes.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        this.el.modes.forEach((b) => {
          const on = b === btn;
          b.classList.toggle('is-active', on);
          b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        this.viewer.setMode(mode);
        this.handlers.onMode?.(mode);
      });
    });

    this.el.panelToggle.addEventListener('click', () => {
      const open = this.el.panelToggle.getAttribute('aria-expanded') === 'true';
      this.el.panelToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      this.el.panelBody.classList.toggle('open', !open);
    });

    this.el.infoReturn.addEventListener('click', () => this.handlers.onReturn?.());
  }

  /* ---------------------------------------------------------------- */

  setProgress(fraction, label) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    this.el.bar.style.width = `${pct}%`;
    this.el.pct.textContent = `${pct}%`;
    if (label) this.el.status.textContent = label;
  }

  hideLoader() {
    this.el.loader.classList.add('done');
    setTimeout(() => {
      this.el.loader.style.display = 'none';
    }, 1100);
  }

  showLoaderError(message) {
    this.el.status.textContent = 'Could not load the city data';
    this.el.pct.textContent = '!';
    let err = document.getElementById('load-error');
    if (!err) {
      err = document.createElement('p');
      err.id = 'load-error';
      err.style.cssText = 'margin-top:14px;font-size:12px;color:#ffb4a8;line-height:1.5';
      this.el.loader.querySelector('.loader-inner').appendChild(err);
    }
    err.textContent = message;
  }

  select(index, fly) {
    this.active = index;
    const lm = LANDMARKS[index];
    this.el.list.querySelectorAll('.lm-btn').forEach((b, i) => {
      b.classList.toggle('is-active', i === index);
    });
    this.markers.forEach((m) => m.el.classList.toggle('is-active', m.index === index));

    if (!lm) {
      this.el.info.hidden = true;
      return;
    }

    this.el.info.hidden = false;
    this.el.infoEyebrow.textContent = 'Now viewing';
    this.el.infoTitle.textContent = lm.name;
    this.el.infoHeight.textContent = lm.height ? `${lm.height} m` : `${lm.district}`;
    this.el.infoMeta.textContent = lm.year ? String(lm.year) : lm.district;
    this.el.infoDesc.textContent = lm.blurb;

    if (fly) this.handlers.onSelect?.(lm, index);
  }

  clearSelection() {
    this.active = -1;
    this.el.info.hidden = true;
    this.el.list.querySelectorAll('.lm-btn').forEach((b) => b.classList.remove('is-active'));
    this.markers.forEach((m) => m.el.classList.remove('is-active'));
  }

  showPlace(title, sub, desc) {
    this.el.info.hidden = false;
    this.el.infoEyebrow.textContent = 'Now viewing';
    this.el.infoTitle.textContent = title;
    this.el.infoHeight.textContent = sub;
    this.el.infoMeta.textContent = '';
    this.el.infoDesc.textContent = desc;
  }

  dismissHint() {
    this.el.hint.classList.add('gone');
  }

  /* ---------------------------------------------------------------- */

  update() {
    const cam = this.viewer.camera;
    const target = this.viewer.controls.target;
    const w = this.viewer.renderer.domElement.clientWidth;
    const h = this.viewer.renderer.domElement.clientHeight;

    // --- markers ------------------------------------------------------
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    for (const m of this.markers) {
      this._v.copy(m.pos).project(cam);
      const inFront = this._v.z < 1;
      const x = (this._v.x * 0.5 + 0.5) * w;
      const y = (-this._v.y * 0.5 + 0.5) * h;
      const off = x < -80 || x > w + 80 || y < -40 || y > h + 40;
      if (!inFront || off) {
        if (m.visible) {
          m.el.classList.add('is-hidden');
          m.visible = false;
        }
        continue;
      }
      if (!m.visible) {
        m.el.classList.remove('is-hidden');
        m.visible = true;
      }
      m.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }

    // --- compass ------------------------------------------------------
    const dir = new THREE.Vector3().subVectors(target, cam.position);
    const azimuth = Math.atan2(dir.x, -dir.z);
    this.el.compassRose.style.transform = `rotate(${-azimuth}rad)`;
    this.el.compassN.style.transform = `translate(-50%, -50%) rotate(${-azimuth}rad) translateY(-13px) rotate(${azimuth}rad)`;

    // --- scale --------------------------------------------------------
    const dist = cam.position.distanceTo(target);
    const vFov = (cam.fov * Math.PI) / 180;
    const worldH = 2 * Math.tan(vFov / 2) * dist;
    const perPx = worldH / Math.max(1, h);
    const targetPx = 96;
    let metres = perPx * targetPx;
    let nice = NICE[0];
    let power = Math.pow(10, Math.floor(Math.log10(metres)));
    while (nice * power < metres) nice = nice === 5 ? NICE[0] * power * 10 : nice;
    metres = nice * power;
    if (metres < power) metres = power;
    const px = Math.round(metres / perPx);
    this.el.scaleBar.style.width = `${Math.max(24, Math.min(220, px))}px`;
    this.el.scaleLabel.textContent =
      metres >= 1000 ? `${(metres / 1000).toFixed(metres % 1000 ? 1 : 0)} km` : `${Math.round(metres)} m`;

    // --- coordinates ---------------------------------------------------
    const lon = xToLon(target.x);
    const lat = zToLat(target.z);
    this.el.coords.textContent = `${lat.toFixed(4)}° N  ${lon.toFixed(4)}° E`;
  }
}
