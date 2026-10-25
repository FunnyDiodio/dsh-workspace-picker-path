/**
 * dsh-workspace-picker-path — Host half.
 *
 * Owns three durable preference values and serves them to this bundle's
 * browser half over one same-origin route:
 *
 *   GET  /workspace-picker-path/api/settings   -> { ok, settings }
 *   POST /workspace-picker-path/api/settings   { patch } -> { ok, settings }
 *
 * `settings` is always the complete { mode, customPath, lastPath } object:
 *   mode       'custom' | 'remember' — how the picker chooses its start path
 *   customPath absolute directory used in 'custom' mode ('' = fall back home)
 *   lastPath   the last directory the operator confirmed in 'remember' mode
 *
 * Storage is this plugin's own JSON file under the DSH home — the same root
 * the shipped session/persistence backends use, so nothing is written inside
 * the application directory:
 *
 *   ${DSH_HOME ?? ~/.dsh}/workspace-picker-path.json
 *
 * The write is staged and renamed so a crash cannot leave a half-written file,
 * and the file is created with owner-only permissions.
 *
 * Every request passes the connection trust fence (loopback + same-origin
 * markers) exactly like the shipped workspace routes, so a browser that is not
 * trusted gets the same rejection the Host gives any other route.
 */
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const NS = 'workspace-picker-path';

/** The route this plugin owns, under the shared web server. */
const ROUTE_PATH = '/workspace-picker-path/api/settings';

/** The drive-root listing route the picker's "This PC" level reads. */
const DRIVES_ROUTE = '/workspace-picker-path/api/drives';

/** How long one drive probe may stall before it is treated as unavailable. */
const DRIVE_PROBE_TIMEOUT_MS = 1500;

/** Byte cap for an in-flight request body; matches other host routes. */
const BODY_MAX_BYTES = 64 * 1024;

/** Longest path accepted for one field; a real Windows path stays far below. */
const PATH_MAX_CHARS = 512;

/** The stored defaults: open at whatever the operator configures. */
const DEFAULTS = Object.freeze({
  mode: 'custom',
  customPath: '',
  lastPath: '',
});

/** The modes the picker understands; anything else is a corrupt write. */
const MODES = ['custom', 'remember'];

/** Resolve the DSH home exactly like the shipped host plugins do. */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh');
}

/** The single file this plugin owns. */
function settingsFile() {
  return join(dshHome(), `${NS}.json`);
}

/**
 * Normalize one stored value into the complete settings object.
 *
 * Read path: unknown modes and malformed strings collapse to the defaults
 * rather than throwing, so a hand-edited file never bricks the picker (the
 * browser half always gets a coherent shape it can render).
 */
function normalize(value) {
  const source = value !== null && typeof value === 'object' ? value : {};
  const mode = MODES.includes(source.mode) ? source.mode : DEFAULTS.mode;
  return {
    mode,
    customPath: cleanPath(source.customPath),
    lastPath: cleanPath(source.lastPath),
  };
}

/**
 * Strip the wrapper quotes one path arrives with. Windows Explorer's "copy
 * path" hands back the value in double quotes, and a hand-edited settings file
 * may carry single quotes; both must read as the plain path instead of failing
 * the listing.
 */
function unquote(text) {
  if (text.length >= 2) {
    for (const [open, close] of [['"', '"'], ["'", "'"], ['“', '”'], ['「', '」']]) {
      if (text.startsWith(open) && text.endsWith(close)) return text.slice(1, -1).trim();
    }
  }
  return text;
}

/** A usable absolute path string, or '' when the value is not one. */
function cleanPath(value) {
  if (typeof value !== 'string') return '';
  const text = unquote(value.trim());
  if (text === '' || text.length > PATH_MAX_CHARS) return '';
  // Control characters (NUL, CR, LF) have no business in a stored path.
  // eslint-disable-next-line no-control-regex
  if (/[\0\r\n]/.test(text)) return '';
  return text;
}

/** Read and parse one bounded JSON request body. */
async function readJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > BODY_MAX_BYTES) throw new Error('request body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('invalid JSON body');
  }
}

/**
 * Current settings: the file when it parses, defaults when it is missing or
 * unreadable. A malformed file is reported through the logger but never
 * surfaces as a route failure — the browser half must still be able to show
 * and repair its own settings row.
 */
async function readSettings(ctx) {
  let text;
  try {
    text = await readFile(settingsFile(), 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') ctx.logger?.warn?.(`[${NS}] read failed: ${String(error)}`);
    return { ...DEFAULTS };
  }
  try {
    return normalize(JSON.parse(text));
  } catch (error) {
    ctx.logger?.warn?.(`[${NS}] parse failed, using defaults: ${String(error)}`);
    return { ...DEFAULTS };
  }
}

/** Merge one validated patch into the current settings and write it atomically. */
async function writeSettings(ctx, patch) {
  const current = await readSettings(ctx);
  const next = { ...current };
  if (patch.mode !== undefined) {
    if (!MODES.includes(patch.mode)) throw new Error('invalid mode');
    next.mode = patch.mode;
  }
  for (const key of ['customPath', 'lastPath']) {
    if (patch[key] === undefined) continue;
    if (typeof patch[key] !== 'string') throw new Error(`invalid ${key}`);
    // Store the UNQUOTED value, so what the file says is what the picker uses
    // (Explorer's "copy path" arrives wrapped in double quotes).
    const text = unquote(patch[key].trim());
    if (text.length > PATH_MAX_CHARS) throw new Error(`${key} too long`);
    // eslint-disable-next-line no-control-regex
    if (/[\0\r\n]/.test(text)) throw new Error(`${key} contains control characters`);
    next[key] = text;
  }
  const file = settingsFile();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const text = `${JSON.stringify(next, null, 2)}\n`;
  // Stage, then rename: the file is either the old complete object or the new
  // one, never a partial write.
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, text, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
  return next;
}

/** Required services; the Loader activates this plugin once all exist. */
export const inject = ['webServer', 'connection'];

/**
 * The mounted drive roots, as `{ path, name }` rows for the picker's
 * "This PC" level.
 *
 * Windows is the only platform that needs this: there, `D:\` is NOT a child
 * of `C:\Users\…`, so walking up from the home directory can never reach
 * another volume — the native OS chooser solves it with a "This PC" node and
 * this plugin mirrors that. On POSIX every path hangs under `/`, which the
 * breadcrumb walk already reaches, so the answer is an empty list.
 *
 * Each letter is probed with a bounded `access`: an absent drive rejects
 * immediately, while a stalled one (an empty optical reader spinning up) is
 * dropped past the timeout rather than hanging the whole listing. Probing
 * runs concurrently, so the wall clock is one timeout, not twenty-six.
 */
async function listDrives() {
  if (process.platform !== 'win32') return [];
  const letters = [];
  for (let code = 65; code <= 90; code++) letters.push(String.fromCharCode(code));
  const probed = await Promise.all(letters.map(async (letter) => {
    const path = `${letter}:\\`;
    let timer;
    try {
      await Promise.race([
        access(path),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('probe timeout')), DRIVE_PROBE_TIMEOUT_MS);
        }),
      ]);
      return { path, name: `${letter}:` };
    } catch {
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }));
  return probed.filter((row) => row !== null);
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: DRIVES_ROUTE,
    handler: async (req, res) => {
      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(text),
          'cache-control': 'no-store',
        });
        res.end(text);
      };
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.writeHead(rejection);
        res.end();
        return;
      }
      if (req.method !== 'GET') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        send(200, { ok: true, drives: await listDrives() });
      } catch (error) {
        send(500, {
          ok: false,
          error: 'drives-unavailable',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }), `${NS}: drives route`);

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: async (req, res) => {
      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, {
          'content-type': 'application/json; charset=utf-8',
          'content-length': Buffer.byteLength(text),
          'cache-control': 'no-store',
        });
        res.end(text);
      };
      // Trust fence: loopback socket + same-origin browser markers, exactly
      // like the shipped workspace routes (connection.requestRejection).
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        res.writeHead(rejection);
        res.end();
        return;
      }
      if (req.method === 'GET') {
        send(200, { ok: true, settings: await readSettings(ctx) });
        return;
      }
      if (req.method !== 'POST') {
        send(405, { ok: false, error: 'method not allowed' });
        return;
      }
      try {
        const body = await readJsonBody(req);
        if (body === null || typeof body !== 'object' || Array.isArray(body)) {
          throw new Error('expected { patch }');
        }
        const patch = body.patch;
        if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
          throw new Error('expected { patch }');
        }
        const unknown = Object.keys(patch).filter((key) => !['mode', 'customPath', 'lastPath'].includes(key));
        if (unknown.length > 0) throw new Error(`unknown field(s): ${unknown.join(', ')}`);
        send(200, { ok: true, settings: await writeSettings(ctx, patch) });
      } catch (error) {
        send(400, {
          ok: false,
          error: 'bad-request',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  }), `${NS}: settings route`);
}
