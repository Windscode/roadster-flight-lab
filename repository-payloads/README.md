# Lossless repository payloads

The files listed in [manifest.json](manifest.json) are stored as gzip segments of at most 192 KiB. This keeps individual source-transfer requests bounded. The original light fields, PNG evidence and complete numerical JSON are preserved byte-for-byte; this is a source-storage format, not a rendering change or reduced-resolution data.

`npm start`, `npm test`, `npm run validate` and the existing Pages workflow restore the original paths before using them. A fresh checkout can restore them explicitly with:

```sh
npm run payloads:restore
```

Each segment and reconstructed file has a SHA-256 digest. The original Git blob ID is also recorded. Restoration verifies the archive, preserves an existing local edit, and strict publication refuses a mismatch. After deliberately editing a listed payload, review it and run `npm run payloads:pack` before committing the new manifest and segments. Old unused segments can be removed only after checking that the new manifest no longer references them.

The runtime still loads its original `.bin` paths. Pages preparation publishes reviewed packed QA files at their original `/qa/` paths, including the complete [3.11 numerical curves](https://windscode.github.io/roadster-flight-lab/qa/vehicle-dynamics-curves-3.11.json). These are fetched only when opened, not during city startup.

`tests/repository-payloads.test.mjs` reconstructs every file in an empty temporary directory and compares it with the original, then checks local-edit preservation and corrupted-segment rejection. Generated reports record numerical and graphical limits separately.

The original user-uploaded stripe PNG and its segments are retained locally and excluded from the public Git tree and Pages. Its inspected provenance and SHA-256 remain in `qa/body-stripe-source-3.11.json`. This image is not a runtime dependency.
