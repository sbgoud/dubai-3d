# Task: Build a stunning 3D model of Dubai as a website, then deploy it to Vercel. Work fully autonomously; never ask questions, make every decision yourself.

## Reference (match or beat its quality and feel)
https://mumbai-3d.easemyhood.workers.dev/  — fetch it, study its HTML/JS (view source, the loaded scripts) to learn the approach (data source, rendering lib, camera, UI). Build the Dubai equivalent, better looking.

## Requirements
- Real Dubai geometry: building footprints + heights from OpenStreetMap (Overpass API) for central Dubai (Downtown/Burj Khalifa, Business Bay, DIFC, Sheikh Zayed Rd, Marina/JBR, Palm Jumeirah, Burj Al Arab, Deira/Creek). Pre-fetch the data at build time into static compressed files in /public (do NOT call Overpass at runtime). Keep total payload reasonable (<15 MB), simplify if needed.
- Coastline/water (Arabian Gulf, Dubai Creek, Palm), roads as subtle lines, landmarks highlighted with accurate heights (Burj Khalifa 828 m etc.).
- Three.js (or deck.gl/MapLibre if the reference uses it) with Vite. Smooth orbit/zoom/pan, fly-to landmark buttons, clickable labels, day/sunset/night toggle with glowing windows at night, fog, soft shadows, good performance on laptops and phones.
- Premium, non-generic design: minimal elegant UI, refined typography, glass panels. Avoid generic AI-looking layouts.
- Title "Dubai 3D".

## Process
1. Scaffold in this folder, write a data-fetch script, run it, build the app.
2. Run `npm run build` and fix ALL errors until it passes. Run it locally with a quick headless check if possible.
3. Git: create public GitHub repo `sbgoud/dubai-3d` with `gh repo create sbgoud/dubai-3d --public --source=. --push` (gh is already logged in).
4. Deploy: if `npx vercel whoami` works or $VERCEL_TOKEN is set, run `npx vercel --prod --yes` (add `--token "$VERCEL_TOKEN"` if set) and write the URL to DEPLOYED_URL.txt. If no Vercel auth is available, do NOT keep retrying: just make sure the build passes and the repo is pushed, then write "BUILT_NOT_DEPLOYED" to /workspace/dubai-3d/DEPLOYED_URL.txt.
5. When finished, write the production URL as the only line in /workspace/dubai-3d/DEPLOYED_URL.txt. If deploy fails, write the reason to /workspace/dubai-3d/FAILED.txt.

## IMPORTANT data notes (learned from a failed attempt)
- Overpass API is UNREACHABLE from this machine (all mirrors time out / 406). Do NOT use Overpass.
- Instead download the Geofabrik extract: `curl -L -o /tmp/gcc.osm.pbf https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf`, install a parser (`pip install --user osmium` or npm `osm-pbf-parser`), and extract buildings (with height / building:levels; default heights sensibly) + coastline/water + major roads for the Dubai bbox (approx 24.95,55.05 to 25.35,55.45) into compact static files in /public.
- If that also fails after ~20 minutes, do NOT stall: fall back to a procedurally generated, geographically faithful Dubai (correct coastline shape, Palm Jumeirah, Creek, Sheikh Zayed Rd tower corridor, Marina, accurate landmark models/heights) and ship it.
- Never wait on a hung command; always use timeouts (curl --max-time, timeout).

## UPDATE 2 (overrides earlier data notes) — previous attempt wasted 6 hours hand-writing a PBF parser. STOP doing that.
- Python `osmium` (pyosmium) is now INSTALLED. Delete scripts/lib/osm.mjs and debug scripts. Write ONE Python script scripts/extract.py using pyosmium (osmium.FileProcessor or SimpleHandler with locations=True, plus `osmium` area handling) to pull buildings, water/coastline, major roads for the Dubai bbox from the Geofabrik GCC pbf, already downloaded at /tmp/osm/gcc.osm.pbf (re-download it if not present, curl -L --max-time 900). Output compact files to public/data. Budget: 30 minutes max for data.
- Then IMMEDIATELY build the Three.js/Vite app (src/, index.html) — this is the actual deliverable and nothing exists yet. Landmarks hand-modelled with accurate heights even if OSM data is thin.
- Then build, push to GitHub, deploy per steps 3-5.
