/**
 * Network + decode pipeline for the static Dubai extract.
 *
 * Every request has a hard timeout and is retried with exponential backoff.
 * Building chunks are independent, so a single bad chunk never prevents the
 * rest of the city from rendering.
 */

import { BuildingChunk, RoadFile } from './decode.js';

const RETRIES = 3;
const TIMEOUT = 15000;
const BACKOFF = 350;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(err) {
  if (!err) return 'unknown error';
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timed out';
  return err.message || String(err);
}

async function fetchBuffer(url, onProgress = null, options = {}) {
  const retries = options.retries ?? RETRIES;
  const timeout = options.timeout ?? TIMEOUT;
  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(BACKOFF * 2 ** (attempt - 1) + Math.random() * 180);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, { cache: 'default', signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const total = Number(res.headers.get('content-length')) || 0;
      if (!res.body || !onProgress) {
        const buffer = await res.arrayBuffer();
        clearTimeout(timer);
        if (onProgress) onProgress(buffer.byteLength, buffer.byteLength);
        return buffer;
      }

      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        onProgress(received, total);
      }
      clearTimeout(timer);

      const merged = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) {
        merged.set(chunk, at);
        at += chunk.length;
      }
      return merged.buffer;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
    }
  }

  throw new Error(`${url}: ${describe(lastError)}`);
}

async function fetchJSON(url) {
  const buffer = await fetchBuffer(url);
  return JSON.parse(new TextDecoder().decode(buffer));
}

export async function loadCityMeta(base = 'data/') {
  return fetchJSON(`${base}city.json`);
}

export async function loadBuildingIndex(base, meta) {
  const path = (meta && meta.buildings && meta.buildings.index) || 'buildings/index.json';
  return fetchJSON(`${base}${path}`);
}

export async function loadBuildingChunk(base, meta, file) {
  const dir = (meta && meta.buildings && meta.buildings.chunkDir) || 'buildings/';
  const buffer = await fetchBuffer(`${base}${dir}${file}`);
  return new BuildingChunk(buffer);
}

export async function loadRoads(base, meta, onProgress = null) {
  const file = (meta && meta.roads && meta.roads.file) || 'roads.bin';
  const buffer = await fetchBuffer(`${base}${file}`, onProgress, { timeout: 30000 });
  return new RoadFile(buffer);
}
