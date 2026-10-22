# Product originals audit — 2026-10-22

## Current instruction and decision

Publication helper materials may be regenerated from actual product files. Old availability indexes, shards, upload receipts, and packaging history are not prerequisites for publication. Preserve original product functionality and uncommitted edits; do not recreate features from summaries or relabel older code as 3.20.

The currently accessible original product bytes are incomplete. No authentic, complete 3.20 candidate can be assembled from the checked sources. This is a product-source finding, not a consequence of missing publication metadata. No claim is made that originals in other sessions or undiscovered remote objects have been permanently deleted.

## Version evidence

- Original 3.19 development identity: commit `4ff324f036b76e886dc958d7de1f17a2a8efff53`, tree `6b7116a98136fef215cc00a54e5591076f52023c`.
- Readable 3.19 validation: blob `ec53aa7c7f433c9f29cf7e58e9cce67dd4e12579`, 268601 bytes, SHA256 `2e1ff2679f7e75a46a392c671340110eb1e7c7400a137d0eb28585f6fdc9c3ca`.
- Its build is `b734be6afe0bc10ed38c403081625b48931e4e24df72512796e7e51797b7d230`; its 191 per-file source hashes are the minimum independently verifiable recovery baseline.
- 157 of those 191 files now have exact bytes recovered (4716360 bytes). 11 logical paths are absent; 23 have only nonmatching older versions. These counts are not a 3.20 completeness percentage.
- Historical 3.20 source identity: `3b2c13b9f747f7d9205d79a7e538da2c2ab0968d`; historical build `52af2eb312ab2b30cb11566c036d41a9253ee148c7c932e13c2f1ff74b44917c`, reported 200 source files. The actual corresponding per-file inventory and complete original bytes are not available in the checked sources.

## Actual product implementation read

- Recovered `dist/physics.js` has 127777 bytes, Git blob `5ab083992dca431896b4bade6b4726d6a666a060`, SHA256 `3aa89a4a111b7a4001220f284077c6f5fe51d58d8b3fa7f6105dfce208aec107`. Its lines 730–731 and associated energy ledger implement passive wheel-work dissipation with no battery energy credit. It cannot stand in for the previously implemented real 3.20 battery regeneration.
- Its real imports require `dist/contact-friction.js` and `dist/contact-ledger.js`, whose original bytes have not been recovered.
- Current old `dist/input-session.js` stores raw event codes/keys. Current old `dist/main.js` uses fixed input handling and raw gamepad axes. The actual 3.20 semantic binding/calibration lifecycle has not been recovered.
- Recovered 3.19 `dist/route-experience.js` contains the older descriptor/run preparation. The 3.20 resource-preparation and replay/practice context implementation has not been recovered.
- All six current uncommitted runtime changes were read and preserved: `city-continuity.js`, `main.js`, `model-build.js`, `operation-hud.js`, `style.css`, `urban-architecture.js`. The `main.js` diff adds a pause callback; these are the older 3.16 working changes, not the previously recorded 3.20 increments.

## Exact source gaps against the readable 3.19 baseline

Full SHA256 values and checked candidate paths are in `checks/product-source-gaps-20261022.json`.

| Logical path | Current result | Expected 3.19 SHA256 prefix |
|---|---|---|
| `dist/app-shell.js` | Only older/nonmatching bytes | `01318ff38479f85b` |
| `dist/audio.js` | Only older/nonmatching bytes | `29248d7c1f64c5a2` |
| `dist/city-behavior-monitor.js` | Path absent | `7286d31478f7ec26` |
| `dist/city-continuity.js` | Only older/nonmatching bytes | `031d7b465f7ad2a3` |
| `dist/city-corridor-plan.js` | Only older/nonmatching bytes | `4d121702e283329d` |
| `dist/city-environment.js` | Only older/nonmatching bytes | `4839766012a86708` |
| `dist/city-flight-challenge.js` | Only older/nonmatching bytes | `a0df7dc49ac72d98` |
| `dist/city-flight-review.js` | Path absent | `4a8f60a88b379149` |
| `dist/city-flight-ui.js` | Only older/nonmatching bytes | `6ed6a19a2074577a` |
| `dist/city-frontage-design.js` | Only older/nonmatching bytes | `98f0e8f779a2c182` |
| `dist/city-map.js` | Only older/nonmatching bytes | `9f3c9c03c0d3a1ca` |
| `dist/city-material-lighting.js` | Only older/nonmatching bytes | `0433957213054d2c` |
| `dist/city-practical-lights.js` | Only older/nonmatching bytes | `0f310408b1dadaec` |
| `dist/city-render-budget.js` | Only older/nonmatching bytes | `0d97a5bbce09a63c` |
| `dist/city-route-detail.js` | Path absent | `c7bd3293238e5680` |
| `dist/city-street-edge.js` | Path absent | `9a1208ec25d71b7c` |
| `dist/contact-friction.js` | Path absent | `165882c28194bff5` |
| `dist/contact-ledger.js` | Path absent | `031a00a892ebbe04` |
| `dist/driver-feedback.js` | Path absent | `69d553e5dfc537e3` |
| `dist/experiment-console.js` | Only older/nonmatching bytes | `e1d6ade6037cef7e` |
| `dist/experiment-records.js` | Only older/nonmatching bytes | `f306f68fa7fe4a3d` |
| `dist/export-download.js` | Only older/nonmatching bytes | `2e4a4f2650367063` |
| `dist/export-encoder.js` | Only older/nonmatching bytes | `8ec6913b785a6196` |
| `dist/i18n-release-317-en.js` | Path absent | `60941a3e3243d3e4` |
| `dist/i18n-release-318-en.js` | Path absent | `f5de085af67cbfad` |
| `dist/i18n-release-319-en.js` | Path absent | `a43bd3fca8fd3952` |
| `dist/index.html` | Only older/nonmatching bytes | `7c196bbc73203ed0` |
| `dist/input-session.js` | Only older/nonmatching bytes | `853df1e5a6ce0a56` |
| `dist/landing-archive-store.js` | Path absent | `d8cc93a4fec4d511` |
| `dist/landing-challenge.js` | Only older/nonmatching bytes | `4e69b12040f93bd1` |
| `dist/landing-research-ui.js` | Only older/nonmatching bytes | `f61f9eb969029b6e` |
| `dist/landing-research-worker.js` | Only older/nonmatching bytes | `8d85383c00163a5a` |
| `dist/main.js` | Only older/nonmatching bytes | `1ee6fff0433672c5` |
| `dist/operation-hud.js` | Only older/nonmatching bytes | `96e479d0eff989c1` |

There are 29 actual import/URL edges from recovered files into 16 missing targets. In addition to the physics imports, `app.js` needs `app-shell.js`/`main.js`; `research-console.js` needs `export-download.js`/`landing-research-ui.js`/`experiment-console.js`; the replay/export workers need `experiment-records.js`/`export-encoder.js`.

## Runtime assets and build dependencies

The following eight 3.19 original runtime assets total 7691184 bytes. Actual current raw files, archive members, local Git objects, old strict payload chains, and exact remote raw object reads were checked. Existing older bytes do not match the original 3.19 identities. Full identities and remote 404 results are in `checks/runtime-asset-gaps-20261022.json`. The final 3.20 asset inventory is unknown.

| Runtime path | Original bytes | Expected 3.19 SHA256 prefix |
|---|---:|---|
| `dist/assets/irradiance/city.bin` | 691200 | `39f7f5db1f543c37` |
| `dist/assets/irradiance/lower-market.bin` | 331344 | `73107583744b7f94` |
| `dist/assets/night-direct-irradiance/night-direct-city.bin` | 674160 | `4f70240ceeefada1` |
| `dist/assets/night-direct-irradiance/night-direct-route-balanced.bin` | 541200 | `f8008fd4f4ad7590` |
| `dist/assets/night-direct-irradiance/night-direct-route.bin` | 2118960 | `ed8d60de679118b3` |
| `dist/assets/night-irradiance/night-city.bin` | 674160 | `c21f0ab83b2cff6c` |
| `dist/assets/night-irradiance/night-route-balanced.bin` | 541200 | `f4ebe6b0c1881ca8` |
| `dist/assets/night-irradiance/night-route.bin` | 2118960 | `3717ddafaed176fc` |

- 29/29 vendor source files and 3/4 workers exactly match the readable 3.19 source hashes and are reusable for that baseline. `landing-research-worker.js` only has the older bytes.
- Exact 3.19 `package.json` was recovered: blob `77682ecfc56c5940eedf4cbf6466a8859844ee16`, 2388 bytes. It differs from the current old package only in version; it declares no external npm dependencies. No lockfile is required by the observed package or known trees.
- Root `LICENSE`, `THIRD-PARTY-NOTICES.md`, and the character license are present and match their known public blobs. Fifty other media assets match the public 3.16 baseline; this alone does not prove their final 3.20 identities.
- Current `scripts/model-build.mjs` is available and uses Node built-ins. Regenerating deployment/build helper output is allowed once real product closure is available. No model/build identity was regenerated over this incomplete source set.

## Checked product locations and representations

1. `/workspace/scratch/867d449c399e/roadster-flight-lab`: actual full worktree, six uncommitted runtime diffs, version 3.16.0, HEAD `e03aaba409fee7168e6b5d520bbfcb3f125b4468`; build `81926b470303a5f51844285ff604fbb84717a627271efddde494e228ce319ec2` with 172 source hashes.
2. `/workspace/scratch/867d449c399e/baseline-315` and readable `/workspace/scratch` project files: 389 ordinary JS/HTML/CSS files hashed before the new public readback. All 27 current ZIPs (73016937 bytes) were inspected: 185 members comprising 104 PNG, 53 TXT and 28 JSON files; no source member, nested ZIP or embedded source candidate, and zero exact matches to the 34 missing source hashes. Their structured model versions are only 3.15.0 and 3.16.0.
3. `/workspace/scratch/cd51bda18c92/github-recovery/exact`: actual partial 3.19 recovery, including validation, physics and route sources. `/workspace/scratch/920d10a3ff27/product-audit/recovered` now contains the 157 exact recovered files plus package metadata.
4. Full local Git object database: 2235 objects read, including 2030 blobs (254417499 raw bytes), 182 trees and 23 commits. 127 exact 3.19 source matches were already in the recovered set; no additional original file or later product tree was found. Both reachable and unreferenced local objects were included.
5. Original paths `/workspace/scratch/229ab6206851/roadster-flight-lab`, `/workspace/scratch/ed64ffe74aa8/roadster-flight-lab`, `/workspace/scratch/46fc9fff05df/roadster-flight-lab`, and the former `920d10a3ff27/roadster-flight-lab` are not present in the current filesystem. Path absence alone was not used as the source-incompleteness conclusion.
6. Current public main and all known preserved upload trees on `recovery/3.19-uploaded-objects-20261021` were read. Main remains `a0fce89e55efe6eaa54210987ef07cf9dfd7171e`. The extra `render-capture-matrix.js` was recovered from main and double-hash checked; main `main.js` was also read and does not match the 3.19 original.
7. Eight exact runtime raw Git blob reads returned 404. Current old 3.16 packed runtime resources were strictly decoded in memory: 7/7 chains valid, 0/7 equal to the 3.19 target. The remaining lower-market raw asset also differs.
8. Library listing/search found no later product source archive. The supplied original final-response URL redirected the current browser to an unauthenticated ChatGPT page, so its attachment bytes could not be read. No credentials were obtained and no protected control interface was accessed.

## Further original-file lead

`qa/development-3.19/8ccb-runtime-sources-before-english-fix.zip` is recorded in actual QA as 1542160 bytes, SHA256 `7a7a8e557e668e756850632d080bd53f69397671edd993dad653e3023cd22e08`, containing 191 earlier runtime sources. Its original bytes or a successful ordinary Git object receipt are not currently available. If recovered, compare its members against the final 3.19 hashes; do not regenerate it and claim original identity.

## Continuation

The needed input is an accessible original 3.20 worktree/source export including its uncommitted changes, required runtime assets, and build dependencies. A complete original source snapshot is sufficient; old upload batches and publication helper materials need not be recovered. After product completeness is verified, regenerate bounded publication indexes as needed, run the necessary checkout/build validation, and publish to the original repository/Pages under existing authorization, preserving main history and workflow permissions.

This checkpoint only records product recovery evidence. It does not publish 3.19 or 3.20, does not change main or Pages, and does not certify a runnable release.
