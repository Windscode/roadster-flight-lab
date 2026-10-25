# Working on Roadster Flight Lab

Use this Git repository and actual local source as the development baseline. Inspect status and remote history before updates; preserve user changes and recovered branches. Never force-push or substitute historical release descriptions for existing code.

Runtime modules live in `dist/`; they are source, not disposable build output. Libraries and assets are vendored. Node 22+ is sufficient for serving and numerical tests. See `docs/development-plan.md` for current priorities and `docs/release-1.1.md` for the last change scope. `.gitattributes` deliberately preserves exact bytes: existing LF/CRLF conventions and archived evidence must not be normalized.

After source changes, run `node scripts/model-build.mjs` and relevant focused tests; `npm run test:release` runs the current release gate. The release gate requires DOM coverage: install pinned test dependencies with `npm ci --prefix tests/dom`, then set `JSDOM_MODULE_PATH` to its absolute `node_modules/jsdom/lib/api.js` path. Historical `validate.mjs` depends on archived fixtures; report unavailable inputs honestly. Preserve original versioned QA; new reports use the current version. Do not claim GPU/native/audio acceptance from numerical or DOM facades.

For release: regenerate build identity, run current checks, run `node scripts/check-static.mjs`, commit intended runtime/evidence, then `node scripts/prepare-pages.mjs` into a fresh staging directory. It verifies committed bytes. Preserve the original 3.19 recovery manifests and existing Pages workflow permissions. Publish with a normal fast-forward update, then verify the new workflow and live deployment identity.
