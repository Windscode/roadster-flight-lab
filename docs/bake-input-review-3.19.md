# Retained bake input review for 3.19

The final 3.19 route adds two addressed service portals, bridge finish geometry,
and a descriptor-driven road shader. The retained daylight and night field
manifests still identify the source bytes that actually produced them in 3.18.
Those manifests and all field binaries have **not** been rewritten or relabelled
as a 3.19 rebake.

## Why the old source gate stopped

The daylight source gate in `tests/indirect-lighting.test.mjs` correctly rejected
the new `dist/city-frontage-design.js` hash. The two night manifests also contain
the previous `dist/city-environment.js` hash. The before-review execution is
retained in `qa/experience-3.19/indirect-source-gate-before-review.log`.

The authored changes preserve the physical closed envelopes, averaged wall
palette, source sky and practical-light anchors used by these particular bake
models. They do change rendered detail. This distinction needed an actual input
comparison, not an edited manifest hash or a wider numeric tolerance.

## Actual frozen/current comparison

`qa/bake-input-equivalence-3.19.mjs` was executed against the readable 3.18
checkout at commit `eb2ca9d67f5b9fe7a81907f5304646e585a535e6` and the frozen 3.19
runtime build `8ccb2ab0d967509682aae900ba5a9067bd986d8468f5d5f57f48256fcb857579`.
Before execution, every original dependency was hashed against the unmodified
manifest. Each initialization came from the real baker source. The extraction
relocates relative imports and `import.meta.url`, stops before transport/output
loops, and appends JSON capture. It does not replace the input calculations.

| Retained field | Compared actual input bytes | Common SHA-256 |
| --- | ---: | --- |
| Daylight | 1,862,277 | `23253c58b6762afcc3d6a757fb8884f445bd85969f065fff1038a6713c58f330` |
| Night diffuse bounce | 5,274,579 | `690f4dd458b62d4bf4a6ea47cb02e03efa4bdf39b6851350feaa7ada7f02e3a6` |
| Night direct diffuse | 692,038 | `e420c54ba2f395e2d33e847c90ef93300fa9b2e37e0776707bf8530d7ac9ee9a` |

All three serialized inputs are byte-for-byte equal. Daylight capture includes
the actual geometry, transformed boxes/BVH, assigned albedos, material model,
sky coefficients, parsed HDR-array hash, directions, layout and initialization
state. Night captures include geometry, actual anchors, layout and the generated
bounce sources where applicable. Each transport algorithm's original source
bytes remain exact. The captured inputs and provenance are retained under
`qa/bake-input-equivalence-3.19/`; all old/current field binaries also matched.

The first audit harness attempted an unavailable environment cleanup method
after its capture. That harness error is retained separately; removing only the
invalid cleanup call allowed the complete comparison. No renderer, simulation,
field, transport algorithm or acceptance threshold was changed for this review.

## Replacement gate

`tests/fixtures/bake-input-contract-3.19.json` pins the original manifests,
original source hashes, the exact two reviewed source deltas, the added route
detail dependency, the review evidence, the extractor and the compressed frozen
inputs. `tests/bake-input-contract-3.19.mjs` then regenerates the current baker
initialization on every run and requires both SHA equality and full byte equality
with the original captured input. Every unreviewed source change still fails.
All original field-binary checks, SH oracles and convergence thresholds remain.

The revised complete indirect-lighting test exited 0. It retains the original
25% spot-check convergence limit and does not substitute input equality for
rendered appearance or target-device performance.

## Read-only static validation

`scripts/check-static.mjs` now calls `verifyPayloads()` instead of
`restorePayloads()`. Validation requires already complete payloads, checks the
packed archives and logical bytes, and never restores through an evidence link.
The targeted complete static check exited 0. Its 44 logical payloads, including
37 preserved symbolic links, kept identical directory entries and target
inode/mtime/ctime values. The process receipt is
`qa/experience-3.19/static-readonly-after-review.json`.

## Limits

These fields remain the original approximate closed-envelope lighting models.
They do not bake facade microgeometry, enterable interiors, dynamic wetness,
transparent transport or a new moving-car light response. Exact retained input
does not establish pixel equality of the new street assets. The offline shader
and sampler gates remain required, and neither is a real GPU performance result.
