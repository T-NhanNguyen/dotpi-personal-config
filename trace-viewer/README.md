# trace-viewer

Containerized front end for the trace vault. Not a pi extension: the traces
extension's `/trace-view` command spawns this server itself:

```
<viewer>/node_modules/.bin/tsx <viewer>/server.ts --cwd <repoRoot> --port 4777 [--trace <id>]
```

The server prints `http://localhost:<port>/?trace=<id>` as its first stdout
line; the extension reads that line and opens the URL.

## Layout

- `server.ts` — plain `node:http` API + static server over `../extensions/traces/core.ts` (read semantics come from the shared module, so writer and viewer cannot drift).
- `src/` — React 19 + `@xyflow/react` + dagre three-panel app (trace list + patterns / graph / detail-session-review tabs), built by Vite into `dist/` (served with an index.html fallback).
- `tests/server.test.mjs` — plain-node checks; spawns the real server via tsx against a fixture trace vault and fixture sessions dir.

## Commands

```
npm install
npm run build            # vite build -> dist/
node tests/server.test.mjs
node_modules/.bin/tsx server.ts --cwd <repoRoot> --port 4777
```

Session transcripts are read from `~/.pi/agent/sessions` (override with
`--sessions-dir` or the `TRACE_VIEWER_SESSIONS_DIR` env var, mainly for
tests). API writes (review submissions) are serialized through an in-process
queue; request bodies over 64 KB are rejected with 413.
