# Pinned Python runtime

Forge serves the unmodified **Pyodide 314.0.1** core runtime from
`/runtime/pyodide/314.0.1/`. Python code executes locally in a fresh worker
inside an opaque sandbox. Hosting these static files does not add a server
interpreter or a paid API. The first load still requires a network connection;
browser caching is an optimization, not an offline-availability guarantee.

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
this public runtime path CORS access for the opaque sandbox, immutable
versioned caching and JavaScript/WebAssembly MIME types.

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
and isolation checks. Never silently regenerate the expected hashes from
whatever package is installed.

References: [official deployment guide](https://pyodide.org/en/314.0.1/usage/downloading-and-deploying.html),
[Pages asset limits](https://developers.cloudflare.com/pages/platform/limits/).
