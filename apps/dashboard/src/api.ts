import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import type pg from "pg";
import { applyVersion, getVersion, listVersions, rollBack } from "./versions.js";

const MAX_BODY = 2_000_000;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > MAX_BODY) throw new HttpError(413, "body too large");
  }
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    // falls through
  }
  throw new HttpError(400, "body must be a JSON object");
}

const int = (v: unknown, name: string) => {
  if (typeof v !== "number" || !Number.isInteger(v)) throw new HttpError(400, `${name} must be a version id`);
  return v;
};

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

export interface ApiOptions {
  pool: pg.Pool;
  /** When set, every API call must carry it in the x-dashboard-token header. */
  token: string | null;
  /** The built UI, served for anything that isn't the API. Null in development, where Vite serves it. */
  staticDir: string | null;
}

/**
 * GET  /api/versions                  every version, newest first
 * GET  /api/versions/:id              one version with its data
 * POST /api/versions                  { basedOn, note, data }: apply as the new active version
 * POST /api/versions/:id/rollback     { basedOn, note }: apply a copy of version :id
 */
export function handler(opts: ApiOptions) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://dashboard");
    try {
      if (!url.pathname.startsWith("/api/")) return await serveStatic(opts.staticDir, url.pathname, res);
      if (opts.token && req.headers["x-dashboard-token"] !== opts.token) throw new HttpError(401, "wrong or missing dashboard token");
      const parts = url.pathname.split("/").filter(Boolean); // ["api", "versions", id?, action?]
      if (parts[1] !== "versions") throw new HttpError(404, "not found");
      const id = parts[2] === undefined ? null : Number(parts[2]);
      if (id !== null && !Number.isInteger(id)) throw new HttpError(404, "not found");

      if (req.method === "GET" && id === null && parts.length === 2) return send(res, 200, await listVersions(opts.pool));
      if (req.method === "GET" && id !== null && parts.length === 3) {
        const version = await getVersion(opts.pool, id);
        return version ? send(res, 200, version) : send(res, 404, { issues: [`no version ${id}`] });
      }
      if (req.method === "POST" && id === null && parts.length === 2) {
        const b = await body(req);
        const result = await applyVersion(opts.pool, { basedOn: int(b.basedOn, "basedOn"), note: String(b.note ?? ""), data: b.data });
        return send(res, result.ok ? 201 : result.status, result);
      }
      if (req.method === "POST" && id !== null && parts[3] === "rollback" && parts.length === 4) {
        const b = await body(req);
        const result = await rollBack(opts.pool, { to: id, basedOn: int(b.basedOn, "basedOn"), note: String(b.note ?? "") });
        return send(res, result.ok ? 201 : result.status, result);
      }
      throw new HttpError(404, "not found");
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { issues: [err.message] });
      console.error(err);
      return send(res, 500, { issues: [(err as Error).message] });
    }
  };
}

async function serveStatic(dir: string | null, pathname: string, res: ServerResponse): Promise<void> {
  if (!dir) throw new HttpError(404, "the UI is served by Vite in development (pnpm dashboard)");
  const rel = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^([/\\])+/, "");
  if (rel.startsWith("..")) throw new HttpError(404, "not found");
  const file = join(dir, rel);
  try {
    const content = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(content);
  } catch {
    throw new HttpError(404, "not found");
  }
}
