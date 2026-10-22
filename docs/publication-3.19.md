# 3.19 publication maintenance

This publication preserves the playable 3.19 runtime without changing its executable files. The original development commit is `4ff324f036b76e886dc958d7de1f17a2a8efff53`, tree `6b7116a98136fef215cc00a54e5591076f52023c`, model `3.19.0`, build `b734be6afe0bc10ed38c403081625b48931e4e24df72512796e7e51797b7d230`.

The publication commit has the current public main commit as its parent and its own author, date, and SHA. `deployment.json` records the actual checkout HEAD and tree. `publication/source-mapping.json` separates these identities from the original development identity. The original development history and complete bundle remain intact; this release does not claim to recreate the original commit SHA.

## Public contents and archived material

All runtime files, vendor modules, workers, assets, licenses, scripts, test source, fixtures, and actual regression inputs are included. Existing public repository files and history are retained. The seven packed light fields and the separately tracked lower-market light field are included with their original hashes. All existing payload chunks are retained, and every restored public logical payload is explicitly selected and verified.

Only new generated evidence that is neither a runtime dependency nor a regression input is omitted from the public tree. Its path, byte length, SHA-256, Git blob identity, original development commit/build, and original bundle identity remain in `publication/availability.json`. These entries have `publiclyAvailable:false` and no download URL. The original local bundle is verified; private Library preparation failed and has no successful saving receipt. No private saving success is claimed.

The complete original `repository-payloads/manifest.json` and `dist/validation.json` are unchanged. Historical passing and failing outcomes remain recorded. Some large raw trajectories and captures referenced by those reports are not included in this publication. A report recording a pass does not mean its complete raw evidence is available on this site.

The [availability page](../availability.html) lists actual online downloads and explicitly unavailable archives. [The availability overlay](../publication/validation-availability.json) classifies every literal QA/docs reference in the unchanged validation report. Unclassified references cause preparation to fail. The [evidence manifest](../evidence-manifest.json) counts only files actually copied to the site, with runtime files, generated publication metadata, and offline originals listed separately.

## Verification scopes

The unchanged runtime keeps the original completed 3.19 regression and the user's independently reported continuous 302.5 m route observation. This publication maintenance does not claim a new GPU, sound, controller, or physical driving acceptance. Manual E+1 inversion, the severe 90 km/h step convergence boundary, limited-gas U rejection, and complete continuous GPU shadow acceptance retain their previous limitations.

Public subset verification uses `node scripts/check-static.mjs`, `node tests/publication-contract.test.mjs`, and `node scripts/prepare-pages.mjs` from the committed public tree. These fail for a missing runtime file, a bad online hash, an incomplete offline identity, an offline URL, an unclassified validation reference, a corrupt runtime chunk, or a mismatch with actual committed bytes. This is distinct from restoring and validating the original complete development archive. The default complete archive payload API remains strict.

No workflow or persistent GitHub permission was added or expanded. Publication uses the existing Git data connection and the existing Pages workflow, with a normal non-forced ref update.
