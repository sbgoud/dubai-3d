# Runtime notes (for the build agent)

- overpass-api.de and related Overpass mirrors return 406 / TLS failures from this box. Do not keep retrying Overpass.
- Use a Geofabrik extract instead: https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf (~245 MB). Filter to Dubai bbox, simplify, write static compressed files under public/.
- `npx vercel whoami` is logged out and VERCEL_TOKEN is unset. After build + GitHub push, write BUILT_NOT_DEPLOYED to DEPLOYED_URL.txt per BRIEF.md (do not loop on Vercel login).
