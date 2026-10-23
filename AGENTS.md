# Working on Roadster Flight Lab

Use this Git repository and actual local source as the development baseline. Inspect status and remote history before updates; preserve user changes and recovered branches. Never force-push or substitute historical release descriptions for existing code.

Runtime modules live in `dist/`; they are source, not disposable build output. Libraries and assets are vendored. Node 22+ is sufficient for serving and numerical tests. See `docs/development-plan.md` for current priorities and `docs/release-3.22.md` for the last change scope.

After source changes, run `node scripts/model-build.mjs` and relevant focused tests; `npm run test:release` runs the current release gate. Optional DOM tests use `JSDOM_MODULE_PATH`. Historical `validate.mjs` depends on archived fixtures; report unavailable inputs honestly. Preserve original versioned QA; new reports use the current version. Do not claim GPU/native/audio acceptance from numerical or DOM facades.

For release: regenerate build identity, run current checks, run `node scripts/check-static.mjs`, commit intended runtime/evidence, then `node scripts/prepare-pages.mjs` into a fresh staging directory. It verifies committed bytes. Preserve the original 3.19 recovery manifests and existing Pages workflow permissions. Publish with a normal fast-forward update, then verify the new workflow and live deployment identity.
