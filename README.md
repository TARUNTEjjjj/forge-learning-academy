# Forge — free public learning edition

Live website: https://forge-learning-academy.pages.dev/

Source repository: https://github.com/TARUNTEjjjj/forge-learning-academy

The source repository and website are public. The website runs on Cloudflare Pages.
Pushing to this repository does not automatically deploy; use the publish command
below.

This edition runs entirely in the visitor's browser and is hosted as static
assets on Cloudflare Pages. It includes the 3D learning map, 50 guided modules,
12 original Python missions, Git simulation, project editors and ZIP downloads,
competition practice, and browser-saved progress. It needs no account login.

## Use it

Open the live URL in Chrome. Start with Learning path → Chapter 1. Your progress
is saved for that website address in the current browser. Use My progress to
export your learning record, and download project ZIPs before changing devices
or clearing browser data. The previous localhost record is separate.

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

The current build passes TypeScript, Vite and 93 automated checks covering
curriculum, Python/Git models, persistence, project exports, runner cleanup and
pinned runtime integrity. The Python runtime is unchanged upstream code; its
hosting and startup path changed. See [runtime provenance](docs/python-runtime.md).

The real-browser regression uses an installed Playwright Core and Chrome. Serve
the built app with Pages headers (or use a Cloudflare preview), then run:

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
Run against a preview before publishing production.

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

Runtime compatibility note: the pinned Pyodide runtime documents module workers, but module blob workers currently fail in the reviewed WebKit opaque-origin sandbox. The existing isolated dynamic-import bootstrap remains in place and passed real Python execution during the 3 November 2026 review. Replacing it requires cross-browser verification without granting `allow-same-origin`; do not weaken that boundary as a workaround.
