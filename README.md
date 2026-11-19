# Forge — free public learning edition

Live website: https://forge-learning-academy.pages.dev/

Source repository: https://github.com/TARUNTEjjjj/forge-learning-academy

The website is public and runs on Cloudflare Pages. The source repository was
private at the 9 November 2026 review. While it is private, its source, tests
and commit history need repository access, and the
[resource library](#github-resource-collection) cannot read its live catalog
from GitHub, so it shows the snapshot bundled with the site. Visitors can
always inspect the frontend assets delivered to their browsers. Pushing to this
repository does not automatically deploy; use the publish command below.

This edition runs entirely in the visitor's browser and is hosted as static
assets on Cloudflare Pages. It includes the 3D learning map, 50 guided modules,
12 original Python missions, Git simulation, project editors and ZIP downloads,
competition practice, and browser-saved progress. It needs no account login.

## Use it

The project workspace supports renaming files while preserving their contents.
Choose **Rename file** under the editor; `main.py` stays the entry point, and
duplicate names, unsafe paths, and file/folder conflicts are rejected. Update
Python imports and other references yourself after a rename.

Open the live URL in Chrome. Start with Learning path → Chapter 1. Your progress
is saved for that website address in the current browser. Use My progress to
export your learning record, which includes your Python lab drafts, and download
project ZIPs before changing devices or clearing browser data. These downloads
are copies to keep; this edition cannot load them back in. The previous
localhost record is separate.

Python downloads its pinned runtime from this website. C++ and official contest
submissions use your local compiler or the original judge. Git playground is
a simulation. Live GitHub syncing and cross-device account storage are not
included in this free browser edition; download projects and publish them with
your own GitHub account.

## Develop

Use Node.js 22.13+ (Node.js 24 recommended) and npm:

```sh
npm ci
npm run dev
npm run typecheck
npm run build
```

The static output is `dist/` and is generated rather than committed.
Development and production builds first verify and stage Pyodide 314.0.1 from
the pinned npm package. Runtime provenance, checksums and third-party notices
are documented in [docs/python-runtime.md](docs/python-runtime.md).
Run the tests on macOS, Linux, or WSL with `python3` and a POSIX `sh`
available on PATH. A C++20 compiler enables the optional C++ example check:

```sh
npm test
# equivalent to:
node --test tests/*.test.mjs
```

## Publish an update

The existing Cloudflare Pages project is `forge-learning-academy`, production
branch `main`. Use its owner's Cloudflare account; never put tokens in source.

```sh
npm run build
npx wrangler@4.153.0 login --scopes account:read user:read pages:write
npx wrangler@4.153.0 pages deploy dist --project-name forge-learning-academy --branch main
```

This existing Pages project does not need recreation. Keep its canonical URL
stable so learners keep access to their browser storage. Static requests are
free under Cloudflare's published Pages pricing; no paid domain was purchased.

## Verification

The current build passes TypeScript, Vite and the automated `npm test` checks
covering curriculum, Python/Git models, persistence, project exports, runner
cleanup and pinned runtime integrity. The practice lab and project editor are
also rendered in Node with a small React stand-in (`tests/react-stand-in.mjs`)
and driven through their own handlers. The Python runtime is unchanged upstream code; its
hosting and startup path changed. See [runtime provenance](docs/python-runtime.md).

The real-browser regression uses an installed Playwright Core and Chrome. Serve
the built app with Pages headers (for example
`FORGE_SERVE_ONLY=1 FORGE_PORT=4173 node tests/python-delivery.mjs`, or use a
Cloudflare preview), then run:

```sh
FORGE_ORIGIN=http://127.0.0.1:4173 \
PLAYWRIGHT_CORE_PATH=/absolute/path/to/node_modules/playwright-core \
BROWSER_EXECUTABLE=/absolute/path/to/chrome \
FORGE_BROWSER_REPORT=/absolute/path/to/python-browser.json \
FORGE_BLOCK_CDN=1 npm run test:browser
```

This executes real Python across repeated correct/partial answers, fresh
interpreter isolation, reload, syntax errors, the execution deadline, Stop and
recovery, plus a separate cold browser context. The optional final context
blocks jsDelivr to verify that the current app has no runtime dependency on it.
The runner checks saved scores, preserved drafts, sandbox cleanup and complete
runtime responses; it never substitutes a fake interpreter. Routing is disabled
for the main repeat tests, because Playwright routing disables HTTP caching.
It also requires that runs after the first on a loaded page make no runtime
request. `FORGE_BROWSER=webkit` runs the same checks in Playwright's WebKit.
Run against a preview before publishing production.

Successful repeated runs are not download evidence on their own.
`tests/python-delivery.mjs` counts the runtime requests and bytes its server
actually sends for cold, repeated, reloaded and new-context runs. The app page
now verifies the runtime once per page and hands it to each opaque sandbox, so
repeated runs on an open page download nothing in Chrome or WebKit; Chrome
also reused its HTTP cache after a reload. The measured before/after results
and remaining browser limits are in
[runtime delivery](docs/python-runtime.md#runtime-delivery).

`public/python-worker.js` remains as a compatibility endpoint for tabs opened
before this update, whose embedded policy still permits only the former CDN.
Reload those older tabs to use the new runner; their saved code remains local.
Current bundles embed `lib/python-worker.js` and use the site's own runtime.

## Current design

Midnight/navy surfaces, crimson actions with white labels, coral-red highlights,
ivory reading accents, and violet secondary details. The map, coding labs,
projects, privacy page, and field guide share this palette. Representative text
color pairs meet 4.5:1 contrast; white button labels on crimson measure 4.89:1.
The runtime update preserves the existing design; browser verification focuses
on real execution, saved results, recovery and isolation.


Pull requests and pushes to `main` run type checking, the Node regression suite, curriculum examples, and a production build in GitHub Actions. Same-tab progress saves are serialized: a practice result waits for an ongoing save and uses the resulting revision. Cross-tab conflicts still require review and retry rather than silently overwriting changes.

Runtime compatibility note: the pinned Pyodide runtime documents module workers, but module blob workers currently fail in the reviewed WebKit opaque-origin sandbox. The existing isolated dynamic-import bootstrap remains in place; it now imports the verified runtime modules from blob URLs and passed real Python execution in Chrome 157 and Playwright WebKit 26.0 on 19 November 2026. Replacing it requires cross-browser verification without granting `allow-same-origin`; do not weaken that boundary as a workaround.

## GitHub resource collection

Explore the project-specific [resource catalog](resources/README.md): curated references, star-ranked discovery, dated source metadata, cached failure recovery and an optional read-only server API. The daily refresh workflow updates the public catalog. The resource library reads the latest GitHub snapshot with a bundled offline fallback; application-code updates still follow the existing deployment process.

The web resource library now checks for fresh public metadata every 15 minutes while an app tab is open and saves the latest validated collection for offline visits. It shows successful-check and source-observation dates separately, preserves good data during failures, and keeps its offline storage separate from application progress. See [resource update and offline behavior](resources/README.md#automatic-checks-and-offline-collections-in-the-web-app).
