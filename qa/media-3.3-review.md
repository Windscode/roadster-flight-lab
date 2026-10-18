# 3.3 media acquisition acceptance

Checked on 2026-10-18. Only the media directories and media-specific inspection
scripts were changed. No music was played through speakers.

## Recordings

Five original, unmodified encoded recordings are in `dist/assets/music/`.
Each entry in `manifest.json` includes the author, recording/album page, direct
download source, specific CC BY 4.0 URL, exact credit, file size and SHA-256.

| Recording | Type | Duration | Authorization evidence |
| --- | --- | --- | --- |
| Cylinder Five — Chris Zabriskie | instrumental | 2:54 | Author album JSON-LD identifies the recordings and CC BY 4.0; author usage page covers all music |
| Cylinder Seven — Chris Zabriskie | instrumental | 8:52 | Same album and author usage page |
| Swansong — Josh Woodward | English vocal | 4:22 | Author song page gives the MP3 and explicitly identifies CC BY 4.0 |
| Learn To Fly — Josh Woodward | English vocal | 3:27 | Author song page gives the MP3 and explicitly identifies CC BY 4.0 |
| 岁月的痕迹 — Adeline Yeo (HP) | Mandarin vocal, AI assisted | 4:03 | FMA artist-upload recording page credits lyrics/composition/arrangement and CC BY 4.0; matching official artist YouTube release also states CC BY 4.0 |

The AI disclosure is carried in the manifest and should be displayed beside the
Mandarin track in the radio. Neither the listed licenses nor this review asserts
that an upload can never attract an erroneous automated copyright claim. The
selected recordings have explicit reuse terms; they are not described as chart
hits. FMA reported roughly 3K plays for the Mandarin track at inspection, which
does not support calling it a popular hit.

Author sources:

- https://chriszabriskie.com/cylinders/
- https://chriszabriskie.com/use/
- https://www.joshwoodward.com/song/Swansong
- https://www.joshwoodward.com/song/LearnToFly
- https://www.joshwoodward.com/faq
- https://freemusicarchive.org/music/adeline-yeo-hp/single/suiyuedehenji/
- https://www.youtube.com/watch?v=bi7AOXYm0ik

Josh Woodward requests that game credit appear during startup or in the game
while the recording plays, in every session. Keep the track title/artist/license
visible next to the player and provide clickable source/credit links. Merely
placing attribution in a hidden ending-credits drawer does not meet that stated
preference. Gameplay uploads should include the music attribution in their
description. Do not submit these tracks to Content ID as original music.

Rejected alternatives included commercial-song covers with uploader-selected
CC labels (underlying composition rights unclear), CC BY-NC recordings, metadata
licensed under CC while its recording remained reserved, and Chinese original
《开源人之歌》, whose author repository is CC BY-SA 4.0. The latter can be a
separately reviewed option, but is not silently bundled under CC BY.

## Animal assets

Two original Quaternius CC0 animals were acquired via the author's pack page and
linked Drive folder. Conversion from glTF with embedded base64 to GLB preserves
the binary payload, materials, skin and 12 clips. There are no external images,
buffers or texture paths. These are intentionally small visual accents.

| Model | GLB bytes | Triangles | Skin joints | Source height | Suggested scale / world height |
| --- | ---: | ---: | ---: | ---: | --- |
| Fox | 1,909,976 | 1,848 | 51 | 2.6767 | 0.22 / 0.589 m |
| Shiba Inu | 1,752,268 | 1,950 | 46 | 3.0956 | 0.20 / 0.619 m |

Dimensions refer to bind-pose POSITION accessor bounds, not an animation-wide
collision envelope. Models face +Z and use +Y up. Source bottom Y is -0.00193 for
fox and +0.004425 for dog; recenter after world scaling if needed. The palette
materials have no textures and no source-author trademark or anime likeness.

Both models have Attack, Death, Eating, Gallop, Gallop_Jump, Idle, Idle_2,
Idle_2_HeadLow, Idle_HitReact1, Idle_HitReact2, Jump_ToIdle and Walk. Prefer
Idle/Eating or short sidewalk paths; do not place them in vehicle lanes. Use
skeleton-aware cloning when duplicating. Two single instances need no cloning.

Author source: https://quaternius.com/packs/ultimateanimatedanimals.html
CC0: https://creativecommons.org/publicdomain/zero/1.0/

## Acceptance scope

`scripts/media-3.3-inspect.py` checks MP3 MPEG frame durations, M4A container
duration, GLB length/chunks, no external URIs, triangle/bone/clip counts and exact
hashes. `qa/media-3.3-acceptance.json` contains the result. This structural test
does not substitute for browser audio decode or visual rig/animation acceptance.
The app owner handles those integration checks in the live page.

The original Three r180 GLTFLoader and required BufferGeometryUtils modules were
added under `dist/vendor/addons/` with only their bare `three` import rewritten
to the existing local module. The retained `THREE-LICENSE.txt` covers these MIT
modules. Upstream and local SHA-256 values are in
`qa/media-3.3-loader-provenance.json`.

`scripts/media-3.3-runtime-check.mjs` additionally loads both GLBs through that
actual loader and advances every clip to an intermediate pose. All 24 clips
have finite bone matrices. These checks are captured in
`qa/media-3.3-runtime-acceptance.json`; browser rendering is still an integration
check and not claimed by this media-only task.
