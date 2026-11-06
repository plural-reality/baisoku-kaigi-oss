// Production resilience for stale-bundle ChunkLoadError.
//
// After a deploy, a tab still running the previous build requests a content-hashed
// chunk (e.g. node_modules_…_c4e9cb58.js) that no longer exists on the server, so the
// dynamic import fails with ChunkLoadError and the view cannot render. The only real
// recovery is to reload, so the browser re-fetches fresh HTML carrying current chunk
// hashes.
//
// Two entry points are needed, because such failures surface on two distinct paths:
//   - reloadIfChunkError(): render-time failures are caught by React error boundaries
//     (app/global-error.tsx) and never reach the window — the boundary calls this.
//   - installChunkReloadHandler(): async/outside-render failures surface on window
//     `error` / `unhandledrejection`.
// A per-session attempt cap (sessionStorage) makes this loop-proof: one reload fixes a
// deploy skew; a genuinely broken chunk stops after MAX_RELOADS instead of looping.

const RELOAD_COUNT_KEY = "chunk-reload-count";
const MAX_RELOADS = 2;

// Single source of truth for "is this a chunk/module load failure", shared with the
// Sentry `ignoreErrors` config so the two can never drift. Covers webpack/turbopack
// chunk errors and native ESM dynamic-import failures.
//
// A Server Action unknown to the server is the same deploy skew: Next salts action ids
// with a key generated per build (NEXT_SERVER_ACTIONS_ENCRYPTION_KEY is not set and the
// Nix build starts clean), so after a deploy an open tab's language switch or sign-out
// calls an id the server no longer has and Next throws UnrecognizedActionError into the
// root error boundary. A reload picks up the current ids.
export const CHUNK_ERROR =
  /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to load chunk|Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|UnrecognizedActionError|Server Action "[^"]*" was not found on the server/;

const describe = (reason: unknown): string =>
  reason instanceof Error
    ? `${reason.name}: ${reason.message}`
    : String(reason ?? "");

export const isChunkLoadError = (reason: unknown): boolean =>
  CHUNK_ERROR.test(describe(reason));

// sessionStorage access can throw (Safari private mode, sandboxed iframe, storage
// disabled). Purify it at the boundary so a storage failure never aborts the reload.
const readCount = (): number => {
  try {
    return Number(window.sessionStorage.getItem(RELOAD_COUNT_KEY) ?? "0");
  } catch {
    return 0;
  }
};

const bumpCount = (next: number): void => {
  try {
    window.sessionStorage.setItem(RELOAD_COUNT_KEY, String(next));
  } catch {
    // storage unavailable — the reload still proceeds; we just cannot cap it.
  }
};

const performReload = (count: number): void => {
  bumpCount(count + 1);
  window.location.reload();
};

const reloadOnce = (): void => {
  const count = readCount();
  count < MAX_RELOADS && performReload(count);
};

// For React error boundaries: returns true when the error is a chunk-load failure (so
// the boundary can skip Sentry capture — these are ignored anyway), triggering a reload.
export const reloadIfChunkError = (reason: unknown): boolean => {
  const hit = isChunkLoadError(reason);
  hit && reloadOnce();
  return hit;
};

export const installChunkReloadHandler = (): void => {
  window.addEventListener("error", (e) => {
    isChunkLoadError(e.error ?? e.message) && reloadOnce();
  });
  window.addEventListener("unhandledrejection", (e) => {
    isChunkLoadError(e.reason) && reloadOnce();
  });
};
