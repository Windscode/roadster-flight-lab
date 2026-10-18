# City architecture and sparse street accents — 3.3

## Direction and inspected primary references

- [Dan Hargreaves / Cyberpunk 2077 environment work](https://www.danhargreaves.com/Cyberpunk_2077.html). This run opened and visually inspected the full `CP_Kabuki_1.png` and `CP_Kabuki_5.png` originals in an isolated browser. The useful cues were a continuous architectural street wall, shopfronts embedded into structure, deep openings, layered circulation, bridges and strong upper/lower-scale separation. A market stall is one local activity, not the urban fabric.
- [Kacper Niepokólczycki / Phantom Liberty district](https://kacperniepoklczycki.artstation.com/projects/Jvzeem). The original `Kacper-Dogtown-A.jpg` already recorded in `qa/city-references/manifest.json` was actually opened at full size. Exposed diagonal structure, large massing breaks, narrow/wide structural volumes and mechanical roofs informed the original modular changes.

The references are visual research. No CDPR models, image textures, billboards, logos or extracted game assets are added to the runtime.

## Implemented asset work

The 132 original parcels, building centrelines/heights, all route and bridge locations and the destination reservations stay fixed. Each building is now a shared, storey-aligned physical massing plan instead of an invisible full-height collision box beneath smaller visual setbacks. Five profile families include deep offset terraces, narrowed and re-expanded wings, a rotated upper tower, and a stepped mechanical profile. Lower-city upper tiers retreat away from the driving street. The architecture has 660 shared tiers, 396 exposed terraces, 27 rotated upper towers and 264 structural diagonal members. Terrace decks close at the physical tier top; deep cornices and sparse rails make the new silhouette readable in daylight.

Outdoor street kiosks decrease from 160 to 20 across 10 small pockets. Old procedural people decrease from 152 to 14; bicycles decrease from 35 to 4. The building shopfronts form the continuous street, with open pavement between the activity pockets. The main lower-city carriageway retains 10 m clear width. No extra kiosks are used to imply city quality.

Two original Quaternius CC0 skinned models provide small accents: one fox on a 5 m lower-city pavement and one shiba in an upper garden pocket. Each uses an authored idle clip. They are distance culled at 160 m and only animate inside 90 m; they have no collision or crowd/navigation simulation. Their licence, source, hash and rig/animation checks are recorded in `dist/assets/characters/manifest.json` and `qa/media-3.3-runtime-acceptance.json`. Neither is an existing game/anime IP.

## Geometry faults fixed

Previously the generic parcel sidewalk extended 2.5 m beyond the lower shop face, while a separate street-life slab covered the same area with an exactly equal top height. The two overlapping slabs caused conflicting material/shadow surfaces. The parcel foundation now stops at the shop face; its outer side retains the original extension. The 5 m authored strip begins at that face, meeting along an edge with zero shared area. Both the rendered city geometry and tire-contact proxies consume this corrected plan.

Previously a full-height box remained in the physics world above visible upper setbacks. The renderer and world now consume the same massing profiles and tier rotations. This affects the irradiance geometry hash and requires a GI rebake. Broad building envelopes still approximate thin facade details and balconies; this is not a room/interior collision mesh.

The parent integration was separately notified of duplicated lower-city line markings and coplanar upper-city road planes in `city-environment.js`, outside this asset task's ownership.

## Budget and acceptance

| Metric | Before | After |
|---|---:|---:|
| Architecture triangles | 2,371,252 | 2,308,216 |
| Street kit triangles, excluding animals | 1,474,428 | 297,180 |
| Architecture + street draw batches | 398 | 348 |
| Street collision proxies | 284 | 114 |
| Outdoor kiosks | 160 | 20 |
| Procedural residents | 152 | 14 |
| Animated CC0 animals | 0 | 2 / 3,798 triangles |

Counts use the same headless asset factories and original pre-3.3 snapshots. Browser observations confirmed the two GLBs, both idle clips, zero asset failures and no new console errors/warnings in the isolated review tab.

Run `node qa/city-3.3-geometry-check.mjs` from the project folder. It validates finite geometry and budgets, all 660 tiers staying within the original parcels, 303 terrace-height ray contacts, 24 recessed-facade horizontal rays without the old ghost box, all 16 lower pavement pairs having zero overlapping area, and 26 relevant street proxies leaving the 10 m carriageway clear. The six pre-existing city/seal regression families also passed after the changed proxy layout.

Screenshots `city-3.3-street-assets.png`, `city-3.3-skyline-assets.png`, `city-3.3-fox.png` and `city-3.3-shiba.png` are actual browser renders from a separate asset-review page using the normal environment and camera adaptation. The screenshots were made before the parent re-baked GI for the changed massing; they are asset/placement checks, not final GI acceptance or a claim of Cyberpunk 2077 visual parity. The camera has no car and omits the main SSAO/postprocess chain. `city-3.3-asset-preview.html` preserves that review page; serve the project folder locally to reopen it. The user's main preview tab was never operated by this task.

## Remaining limits

The original modular buildings remain much simpler than unique authored AAA architecture. The project still lacks a streamed, hand-composed open-world block plan, model-specific texture baking, traffic/crowd behavior and interior rooms. The new profiles and reduced props are an improvement to the existing modular city, not a reproduction of Night City or an equivalent asset library.
