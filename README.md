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

Python downloads its runtime from Pyodide's CDN. C++ and official contest
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
Run the tests on macOS, Linux, or WSL with `python3` and a POSIX `sh`
available on PATH. A C++20 compiler enables the optional C++ example check:

```sh
npm test
# equivalent to:
node --test tests/browser-progress.test.mjs tests/curriculum.test.mjs tests/practice-models.test.mjs tests/projects.test.mjs
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

The public build passed TypeScript and Vite compilation. Curriculum, Python/Git
models, project exports/recovery, and browser persistence passed 86 automated
checks in total. Public HTML and seven application assets returned HTTP 200;
downloaded assets exactly matched the tested build. Source review corrected
draft identity changes while storage loads and cross-tab storage refreshes.

Browser click-through and hosted Pyodide execution were not automated in this
session because browser control was unavailable. This is a public learning
edition, not a certification of career outcomes or hosted backend capacity.

## Current design

Midnight/navy surfaces, crimson actions with white labels, coral-red highlights,
ivory reading accents, and violet secondary details. The map, coding labs,
projects, privacy page, and field guide share this palette. Representative text
color pairs meet 4.5:1 contrast; white button labels on crimson measure 4.89:1.
Browser screenshot review was unavailable; compilation, CSS parsing, source
review, 86 regression checks, and public asset verification passed.
