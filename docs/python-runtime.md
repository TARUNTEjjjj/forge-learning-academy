# Pinned Python runtime

Forge serves the unmodified **Pyodide 314.0.1** core runtime from
`/runtime/pyodide/314.0.1/`. Python code executes locally in a fresh worker
inside an opaque sandbox. Hosting these static files does not add a server
interpreter or a paid API. See [runtime delivery](#runtime-delivery) for how
the files reach the sandbox and what repeated runs download.

`npm ci` obtains the exact dev dependency from the committed npm lockfile.
`npm run dev` and `npm run build` automatically run `stage:python` first.
The staging script verifies the package name and version, byte length and
SHA-256 digest of every runtime file before replacing the staged directory.
An unexpected version, truncated file or changed byte fails the command.
No additional download occurs during staging, and no runtime binary is
committed to the repository.

| Core file | Bytes |
| --- | ---: |
| `pyodide.mjs` | 17,880 |
| `pyodide.asm.mjs` | 1,250,305 |
| `pyodide.asm.wasm` | 9,609,879 |
| `python_stdlib.zip` | 2,552,455 |
| `pyodide-lock.json` | 115,407 |
| Total | 13,545,926 |

The source of truth is [`scripts/python-runtime-manifest.json`](../scripts/python-runtime-manifest.json).
All five npm files were also checked against the corresponding official
`https://cdn.jsdelivr.net/pyodide/v314.0.1/full/` release files; every digest
matched. This is the core closure used by Forge, not the full optional package
distribution. The lockfile is runtime metadata and does not imply those
optional wheels are hosted or supported.

The largest asset is below Cloudflare Pages' 25 MiB individual asset limit.
The site uses static Pages hosting; no Worker, R2 bucket or paid runtime
binding is required to serve these files. The existing `_headers` gives only
this public runtime path CORS access, immutable versioned caching and
JavaScript/WebAssembly MIME types. The current runner fetches these files from
the app page, where that caching rule applies. The CORS rule remains for tabs
that still run the previous runner, which fetched them from the sandbox.

## Runtime delivery

The runner keeps `sandbox="allow-scripts"` without `allow-same-origin`, so
learner code runs in an opaque origin, in a new worker with a new interpreter
for every run. Requests made from that opaque origin bypass the browser's HTTP
cache. Until this change the worker fetched the runtime itself, so every run
downloaded it again.

Now the app page, which is not opaque, fetches the five runtime files from its
own origin without credentials, where the immutable caching rule applies
([`lib/python-runtime.ts`](../lib/python-runtime.ts)). Before anything runs, it
checks each file's byte length and SHA-256 digest against the committed
manifest and refuses a file that differs; a failed load is retried in full on
the next run. The page keeps the verified bytes in memory (about 13.5 MB,
uncompressed) until it is closed or reloaded and posts a copy into each new
sandbox. The sandbox hands that copy to a fresh worker, which imports the
modules from blob URLs and answers Pyodide's own requests for runtime files
from those bytes. The sandbox policy now allows no network requests at all
(`connect-src 'none'`), and the Stop button, the 8-second deadline and the
60-second load limit still terminate the worker and remove the sandbox.

### Measurements

Measured on 19 November 2026 on macOS (Apple silicon) with Google Chrome
157.0.8103.79 and Playwright WebKit 26.0 (playwright-core 1.56.1), using the
real Pyodide runtime and [`tests/python-delivery.mjs`](../tests/python-delivery.mjs).
That script serves the build with the `_headers` rules, ETags and gzip, and
counts runtime requests and response bytes on the server; it also records
`Origin: null` requests, which come from the sandbox. Each sequence is: a cold
first run, two repeated runs, a reload, a fresh navigation back to the page,
and a new browser context. Startup is the time from **Check solution** to the
interpreter reporting ready. Times are medians of three sequences over a
server-side 20 Mbit/s link; the machine was shared with other work, so treat
times as approximate and the request and byte counts as exact.

| Run | Chrome before | Chrome after | WebKit before | WebKit after |
| --- | --- | --- | --- | --- |
| Cold first run | 5 requests, 6,396,466 B, 4.2 s | 5 requests, 6,396,466 B, 4.3 s | 5 requests, 6,396,466 B, 3.9 s | 5 requests, 6,396,466 B, 4.0 s |
| Second run, same page | 5 requests, 6,396,466 B, 3.8 s | 0 requests, 0 B, 1.2 s | 3 requests, 6,129,042 B, 3.6 s | 0 requests, 0 B, 0.9 s |
| Third run, same page | 5 requests, 6,396,466 B, 4.0 s | 0 requests, 0 B, 1.1 s | 3 requests, 6,129,042 B, 3.3 s | 0 requests, 0 B, 1.7 s |
| After reload | 5 requests, 6,396,466 B, 4.6 s | 0 requests, 0 B, 1.9 s | 3 requests, 6,129,042 B, 3.5 s | 5 requests, 6,396,466 B, 4.5 s |
| After navigating back | 5 requests, 6,396,466 B, 4.6 s | 0 requests, 0 B, 1.6 s | 3 requests, 6,129,042 B, 3.9 s | 5 requests, 6,396,466 B, 4.6 s |
| New browser context | 5 requests, 6,396,466 B, 4.2 s | 5 requests, 6,396,466 B, 4.1 s | 5 requests, 6,396,466 B, 4.0 s | 5 requests, 6,396,466 B, 4.9 s |

Before the change every request came from the sandbox (`Origin: null`); after
it, none did. Without throttling (loopback), startup was dominated by CPU work
and other load on the machine, ranging from 0.8 to 6.9 s in both versions, so
those times show no reliable difference; the request and byte counts matched
the table.

What this shows, and what it does not:

- Within one open page, repeated runs no longer download the runtime in
  either browser.
- In Chrome the page's requests were served from the HTTP cache after a reload
  and after navigating back: no runtime bytes were sent.
- Playwright's browser contexts are ephemeral, like a private window. In those
  WebKit contexts the page's `fetch()` responses were not reused after a reload
  or a navigation, so WebKit downloaded all five files again. Before the change
  WebKit had reused the two JavaScript modules (267,424 B) across runs, so a
  reload now costs it slightly more. Whether Safari with a normal profile and
  disk cache reuses them was not verified: Playwright's persistent WebKit
  context did not start on this machine.
- The first run on a page verifies the runtime before compiling it, so it no
  longer overlaps WebAssembly compilation with the download. Its startup
  stayed within the noise in Chrome and was about 0.1 to 1 s slower in the
  WebKit measurements.
- A first run in a new browser, after clearing site data, or after a cache
  eviction still downloads about 6.4 MB (gzip; Cloudflare's own compression
  differs) and needs a connection.
- Keeping the verified runtime in persistent site storage (for example the
  Cache Storage API) would remove more downloads, including WebKit reloads,
  but would store about 13.5 MB on the learner's device with its own privacy,
  quota and deletion behavior. That is left as a separate decision.

To repeat the measurement, build the site and run:

```sh
FORGE_DIST=$PWD/dist \
PLAYWRIGHT_CORE_PATH=/absolute/path/to/node_modules/playwright-core \
FORGE_BROWSER=chromium FORGE_THROTTLE_MBPS=20 \
FORGE_DELIVERY_REPORT=/absolute/path/to/delivery.json \
node tests/python-delivery.mjs
```

Use `FORGE_BROWSER=webkit` after `npx playwright-core install webkit`.

## Attribution and corresponding source

Pyodide is **MPL-2.0**, not MIT. The compiled runtime also contains CPython
3.14.2, Emscripten 5.0.3 and components with their own licenses. Their notices
are tracked under [`licenses/pyodide-314.0.1`](../licenses/pyodide-314.0.1/NOTICE.txt)
and copied with `manifest.json` into the public runtime directory on every
build. Each copied upstream notice has a source URL and SHA-256 digest in
`licenses/pyodide-314.0.1/sources.json`.

The corresponding unmodified source and build recipes are available at the
[Pyodide 314.0.1 tag](https://github.com/pyodide/pyodide/tree/314.0.1).
Its [build variables](https://github.com/pyodide/pyodide/blob/314.0.1/Makefile.envs)
pin CPython and Emscripten; its
[CPython build recipe](https://github.com/pyodide/pyodide/blob/314.0.1/cpython/Makefile)
pins hiwire, libffi, liblzma, SQLite and Zstandard. The upstream Python license
history and additional notices are retained, alongside notices for the
Emscripten runtime, musl, LLVM libraries, compression libraries and Expat.

When upgrading, explicitly review the new upstream dependency and license
closure, replace the manifest with independently checked hashes, update the
runtime version in the runner and headers, and rerun real browser execution
and isolation checks. The worker passes Pyodide's `createPyodideModule`
option so that `pyodide.asm.mjs` is not imported over the network; confirm
the new release still honors it, or the sandbox policy will block the import. Never silently regenerate the expected hashes from
whatever package is installed.

References: [official deployment guide](https://pyodide.org/en/314.0.1/usage/downloading-and-deploying.html),
[Pages asset limits](https://developers.cloudflare.com/pages/platform/limits/).
