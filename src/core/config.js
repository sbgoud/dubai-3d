/**
 * Shared geometry constants, world helpers and lighting palettes.
 *
 * World space: X = east metres, Y = up metres, Z = south metres.
 * The city origin is placed at the Downtown / Burj Khalifa cluster so the
 * default camera framing is centred on the densest part of the map.
 */

export const GEO = {
  lon0: 55.02,
  lat0: 24.96,
  mPerDegLat: 110574.0,
  mPerDegLon: 100923.00247360316,
  widthM: 40369.200989441124,
  heightM: 44229.599999999846,
};

const CENTER_LON = 55.2722;
const CENTER_LAT = 25.1968;

export const CENTER = {
  x: (CENTER_LON - GEO.lon0) * GEO.mPerDegLon,
  y: (CENTER_LAT - GEO.lat0) * GEO.mPerDegLat,
};

/** longitude -> world X (metres) */
export function lonToX(lon) {
  return (lon - GEO.lon0) * GEO.mPerDegLon - CENTER.x;
}

/** latitude -> world Z (metres, negative is north) */
export function latToZ(lat) {
  return -((lat - GEO.lat0) * GEO.mPerDegLat - CENTER.y);
}

/** world X -> longitude */
export function xToLon(x) {
  return (x + CENTER.x) / GEO.mPerDegLon + GEO.lon0;
}

/** world Z -> latitude */
export function zToLat(z) {
  return (-z + CENTER.y) / GEO.mPerDegLat + GEO.lat0;
}

export const SCENE = {
  groundY: 0,
  roadY: 0.55,
  far: 240000,
};

/**
 * Lighting presets. `sun` is an azimuth (radians, clockwise from north) plus
 * an elevation (radians above the horizon).
 */
export const MODES = {
  day: {
    label: 'Day',
    sun: { azimuth: 2.24, elevation: 0.95, color: 0xfff3df, intensity: 2.55 },
    sky: { zenith: 0x2f6bb0, horizon: 0xc6dced, ground: 0x9c8a6f, haze: 0xdfeaf3 },
    ambient: { sky: 0x9dc4e8, ground: 0xc3ae8b, intensity: 1.0 },
    fog: { color: 0xc3d8e8, density: 0.0000165 },
    exposure: 1.0,
    night: 0.0,
    water: { deep: 0x061a29, shallow: 0x12808f, foam: 0xdff2f4 },
    ground: { sand: 0xcdb28a, urban: 0xa39a8a, green: 0x67794f, road: 0x2b2f36 },
    glow: 0.0,
  },
  sunset: {
    label: 'Golden',
    sun: { azimuth: 4.86, elevation: 0.115, color: 0xffb56b, intensity: 2.35 },
    sky: { zenith: 0x2a3f6e, horizon: 0xf2a066, ground: 0x6a4b3a, haze: 0xf6bb8a },
    ambient: { sky: 0x8e9fd0, ground: 0x8a6144, intensity: 0.82 },
    fog: { color: 0xe9a878, density: 0.000021 },
    exposure: 1.04,
    night: 0.22,
    water: { deep: 0x0b2033, shallow: 0x1d7f88, foam: 0xffd9b0 },
    ground: { sand: 0xcba476, urban: 0x8d7a69, green: 0x525f3e, road: 0x2a2622 },
    glow: 0.42,
  },
  night: {
    label: 'Night',
    sun: { azimuth: 1.05, elevation: 0.82, color: 0x9fb6d8, intensity: 0.42 },
    sky: { zenith: 0x030711, horizon: 0x12253c, ground: 0x060a10, haze: 0x1b3249 },
    ambient: { sky: 0x33445f, ground: 0x0d1219, intensity: 0.55 },
    fog: { color: 0x0a1422, density: 0.000023 },
    exposure: 1.12,
    night: 1.0,
    water: { deep: 0x02080f, shallow: 0x07303c, foam: 0x9fd8e0 },
    ground: { sand: 0x2c2c29, urban: 0x20242a, green: 0x141c16, road: 0x0d0f13 },
    glow: 1.0,
  },
};

/** sun direction vector for a given azimuth/elevation pair */
export function sunVector(azimuth, elevation, out) {
  const ce = Math.cos(elevation);
  const v = out || { x: 0, y: 0, z: 0 };
  v.x = Math.sin(azimuth) * ce;
  v.y = Math.sin(elevation);
  v.z = -Math.cos(azimuth) * ce;
  return v;
}

/**
 * Landmarks with real coordinates and real heights.
 * `focus` is the point the camera looks at when the landmark is selected.
 */
export const LANDMARKS = [
  {
    id: 'burj-khalifa',
    name: 'Burj Khalifa',
    district: 'Downtown Dubai',
    height: 828,
    year: 2010,
    lon: 55.27451,
    lat: 25.19721,
    blurb:
      'The tallest building on Earth. Its 828 m spire rises in a spiralling Y-plan of three wings that step back 27 times, wrapped in a stainless-steel and glass curtain that reshapes itself through the day.',
    focus: { distance: 2100, pitch: 0.62, yaw: 2.35 },
  },
  {
    id: 'sheikh-zayed',
    name: 'Sheikh Zayed Road',
    district: 'Al Wasl & DIFC',
    height: 0,
    year: 2011,
    lon: 55.2632,
    lat: 25.2143,
    blurb:
      'The spine of the new city: a 12 km ribbon of towers running from the Trade Centre to the Palm, with the Museum of the Future and the Ain-adjacent waterfront rising along its edge.',
    focus: { distance: 4200, pitch: 0.72, yaw: 1.05 },
  },
  {
    id: 'emirates-towers',
    name: 'Emirates Towers',
    district: 'Emirates Towers',
    height: 355,
    year: 2012,
    lon: 55.28355,
    lat: 25.2175,
    blurb:
      'Two triangular stainless-steel towers of 355 m. Their facades catch the desert light so completely that the pair is called "the open hand" — a gesture to the trade that built it.',
    focus: { distance: 1750, pitch: 0.66, yaw: 2.05 },
  },
  {
    id: 'business-bay',
    name: 'Business Bay',
    district: 'Business Bay',
    height: 245,
    year: 2018,
    lon: 55.3132,
    lat: 25.1883,
    blurb:
      'The old creek-side oil fields redeveloped into a district of curving glass slabs around a canal, threaded with running water and mid-rise walk-ups.',
    focus: { distance: 2600, pitch: 0.7, yaw: 1.5 },
  },
  {
    id: 'marina',
    name: 'Marina & JBR',
    district: 'Dubai Marina',
    height: 306,
    year: 2020,
    lon: 55.1448,
    lat: 25.0884,
    blurb:
      'A private canal cut into the desert and lined with yacht berths, watched over by the 306 m Cayan Tower, the first twisted skyscraper in the region.',
    focus: { distance: 2900, pitch: 0.68, yaw: 0.6 },
  },
  {
    id: 'palm',
    name: 'Palm Jumeirah',
    district: 'Palm Jumeirah',
    height: 179,
    year: 2006,
    lon: 55.1169,
    lat: 25.1302,
    blurb:
      'The Palm: a 94 million cubic metres of sand laid over 16 million pilings, shaped into a fronded crescent with a 21 km breakwater that makes Dubai’s first artificial island.',
    focus: { distance: 6400, pitch: 0.8, yaw: 2.7 },
  },
  {
    id: 'burj-al-arab',
    name: 'Burj Al Arab',
    district: 'Jumeirah',
    height: 321,
    year: 1999,
    lon: 55.18529,
    lat: 25.14123,
    blurb:
      'The original sail. 321 m of white fabric on its own island, cantilevers 180 m from the shore and lit by a colour-changing façade at night.',
    focus: { distance: 1800, pitch: 0.58, yaw: 2.9 },
  },
  {
    id: 'deira',
    name: 'Deira & the Creek',
    district: 'Old Dubai',
    height: 0,
    year: 0,
    lon: 55.3036,
    lat: 25.2648,
    blurb:
      'Where the city began: the wind-towers of Deira, the gold and spice souks of Al Fahidi, and the abra ferry that still crosses the Creek between the two halves of old Dubai.',
    focus: { distance: 3300, pitch: 0.74, yaw: 0.2 },
  },
];

/** Extra tower models placed in the city with their true heights. */
export const TOWERS = [
  { id: 'baj', name: 'Burj Al Arab', lon: 55.18529, lat: 25.14123, height: 321, kind: 'sail' },
  { id: 'bkh', name: 'Burj Khalifa', lon: 55.27451, lat: 25.19721, height: 828, kind: 'y-plan' },
  { id: 'emt', name: 'Emirates Tower', lon: 55.28345, lat: 25.21748, height: 355, kind: 'tri' },
  { id: 'emt2', name: 'Emirates Tower', lon: 55.28385, lat: 25.21766, height: 355, kind: 'tri' },
  { id: 'motf', name: 'Museum of the Future', lon: 55.28196, lat: 25.21773, height: 107, kind: 'ring' },
  { id: 'frame', name: 'The Frame', lon: 55.28376, lat: 25.21394, height: 250, kind: 'frame' },
  { id: 'creek', name: 'Dubai Creek Tower', lon: 55.33031, lat: 25.2408, height: 356, kind: 'twist' },
  { id: 'ain', name: 'Ain Dubai', lon: 55.11301, lat: 24.98548, height: 250, kind: 'wheel' },
  { id: 'atl', name: 'Atlantis The Palm', lon: 55.11704, lat: 25.13038, height: 179, kind: 'atlantis' },
  { id: 'opus', name: 'The Opus', lon: 55.29027, lat: 25.22733, height: 93, kind: 'opus' },
  { id: 'princess', name: 'Princess Tower', lon: 55.14677, lat: 25.08865, height: 240, kind: 'crown' },
  { id: 'cayan', name: 'Cayan Tower', lon: 55.28036, lat: 25.21583, height: 306, kind: 'twist' },
  { id: 'marquois', name: 'JW Marriott Marquis', lon: 55.28047, lat: 25.21739, height: 355, kind: 'twin' },
  { id: 'spiral', name: 'Dubai Creek Tower', lon: 55.30626, lat: 25.24612, height: 356, kind: 'twist' },
  { id: 'marina1', name: 'Marina Gate', lon: 55.14003, lat: 25.07807, height: 245, kind: 'crown' },
  { id: 'marina2', name: 'Marina Tower', lon: 55.14372, lat: 25.08066, height: 280, kind: 'twist' },
  { id: 'dwt', name: 'Dubai Waterfront Tower', lon: 55.15963, lat: 25.09631, height: 310, kind: 'crown' },
  { id: 'baygate', name: 'B2B Tower', lon: 55.31188, lat: 25.18582, height: 269, kind: 'twist' },
  { id: 'bay1', name: 'Business Bay Tower', lon: 55.30975, lat: 25.19031, height: 220, kind: 'tri' },
  { id: 'bay2', name: 'Business Bay Tower', lon: 55.31578, lat: 25.18681, height: 200, kind: 'crown' },
  { id: 'bay3', name: 'Business Bay Tower', lon: 55.30651, lat: 25.18322, height: 185, kind: 'y-plan' },
  { id: 'alhabtoor', name: 'Al Habtoor City', lon: 55.29181, lat: 25.22538, height: 93, kind: 'crown' },
  { id: 'zabeel', name: 'Zabeel Towers', lon: 55.27127, lat: 25.22945, height: 145, kind: 'tri' },
  { id: 'citytower', name: 'City Tower 1', lon: 55.27924, lat: 25.21888, height: 277, kind: 'tri' },
  { id: 'emirates', name: 'Emirates Palace', lon: 55.17162, lat: 25.14142, height: 105, kind: 'palace' },
  { id: 'faris', name: 'Al Faris Tower', lon: 55.26931, lat: 25.22261, height: 245, kind: 'crown' },
  { id: 'safa', name: 'Safa One', lon: 55.25172, lat: 25.18121, height: 248, kind: 'crown' },
  { id: 'd1', name: 'Sobha Hartland', lon: 55.30205, lat: 25.20348, height: 320, kind: 'twist' },
  { id: 'd2', name: 'Sobha Hartland', lon: 55.3061, lat: 25.20612, height: 265, kind: 'crown' },
  { id: 'creek2', name: 'Creek Tower', lon: 55.33317, lat: 25.23617, height: 260, kind: 'tri' },
];
