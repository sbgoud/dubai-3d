/**
 * Network + decode pipeline for the static Dubai extract.
 */

import { BuildingFile, RoadFile } from './decode.js';

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;

  const encoding = (res.headers.get('content-encoding') || '').toLowerCase();
  const alreadyDecoded = encoding.includes('gzip');

  if (!res.body) return res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (onProgress) onProgress(received, total);
  }

  if (alreadyDecoded) {
    const merged = new Uint8Array(received);
    let at = 0;
    for (const c of chunks) {
      merged.set(c, at);
      at += c.length;
    }
    return merged.buffer;
  }

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress gzip data (DecompressionStream missing).');
  }
  const stream = new Blob([chunks]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function loadCityMeta(base = 'data/') {
  const res = await fetch(`${base}city.json`, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`city.json: HTTP ${res.status}`);
  return res.json();
}

export async function loadBuildings(base, onProgress) {
  const buf = await fetchWithProgress(`${base}buildings.bin.gz`, onProgress);
  return new BuildingFile(buf);
}

export async function loadRoads(base, onProgress) {
  const buf = await fetchWithProgress(`${base}roads.bin.gz`, onProgress);
  return new RoadFile(buf);
}
