import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { checkBalance } from "../check.js";
import { diff, flatten, matches, setAt, type Change, type Field, type Leaf } from "../fields.js";
import type { ApplyResult, Version, VersionSummary } from "../versions.js";

// ---- Talking to the dashboard API. A token in the URL (?token=) is kept for the session and sent with every call.

const token = (() => {
  const fromUrl = new URLSearchParams(location.search).get("token");
  try {
    if (fromUrl) sessionStorage.setItem("dashboard-token", fromUrl);
    return fromUrl ?? sessionStorage.getItem("dashboard-token");
  } catch {
    return fromUrl;
  }
})();

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(token ? { "x-dashboard-token": token } : {}) },
    body: body === undefined ? null : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { issues?: string[] };
  if (!res.ok && !("ok" in json)) throw new Error(json.issues?.join("; ") ?? res.statusText);
  return json;
}

const show = (v: Leaf | undefined) => (v === undefined ? "(none)" : JSON.stringify(v));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// ---- One editable value.

function FieldInput({ field, changed, onSet }: { field: Field; changed: boolean; onSet: (v: Leaf) => void }) {
  const [text, setText] = useState(String(field.value));
  useEffect(() => setText(String(field.value)), [field.value]);
  const bad = typeof field.value === "number" && (text.trim() === "" || !Number.isFinite(Number(text)));
  if (typeof field.value === "boolean") {
    return <input type="checkbox" checked={field.value} onChange={(e) => onSet(e.target.checked)} className={changed ? "changed" : ""} />;
  }
  return (
    <input
      className={`${changed ? "changed" : ""} ${bad ? "bad" : ""}`}
      value={text}
      disabled={field.value === null}
      inputMode={typeof field.value === "number" ? "decimal" : "text"}
      onChange={(e) => {
        setText(e.target.value);
        if (typeof field.value !== "number") return onSet(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== "" && Number.isFinite(n)) onSet(n);
      }}
    />
  );
}

// ---- The editor: every value in the record, grouped by its top-level section.

function FieldsEditor({ draft, base, onChange }: { draft: unknown; base: unknown; onChange: (d: unknown) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const fields = useMemo(() => flatten(draft), [draft]);
  const before = useMemo(() => new Map(flatten(base).map((f) => [JSON.stringify(f.path), f.value])), [base]);
  const groups = useMemo(() => {
    const out = new Map<string, Field[]>();
    for (const f of fields) {
      if (query && !matches(f.label, query)) continue;
      const g = String(f.path[0]);
      out.set(g, [...(out.get(g) ?? []), f]);
    }
    return out;
  }, [fields, query]);

  return (
    <div>
      <input className="search" placeholder='Find a value, e.g. "bolt damage" or "tower range"' value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      {[...groups].map(([group, list]) => {
        const changedHere = list.filter((f) => before.get(JSON.stringify(f.path)) !== f.value).length;
        const expanded = !!query || open.has(group);
        return (
          <section key={group} className="group">
            <h3
              onClick={() => setOpen((o) => {
                const next = new Set(o);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              })}
            >
              {expanded ? "▾" : "▸"} {group} <span className="muted">{list.length} values</span>
              {changedHere > 0 && <span className="badge">{changedHere} changed</span>}
            </h3>
            {expanded && (
              <table>
                <tbody>
                  {list.map((f) => {
                    const old = before.get(JSON.stringify(f.path));
                    const changed = old !== f.value;
                    return (
                      <tr key={JSON.stringify(f.path)}>
                        <td className="label">{f.label.split(" › ").slice(1).join(" › ")}</td>
                        <td>
                          <FieldInput field={f} changed={changed} onSet={(v) => onChange(setAt(draft, f.path, v))} />
                        </td>
                        <td className="muted">{changed ? `was ${show(old)}` : ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
      {!groups.size && <p className="muted">Nothing matches "{query}".</p>}
    </div>
  );
}

/** For changes the fields can't make: adding or removing an item, ability or wall. */
function JsonEditor({ draft, onChange }: { draft: unknown; onChange: (d: unknown) => void }) {
  const [text, setText] = useState(() => JSON.stringify(draft, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      {error && <p className="error">Not valid JSON: {error}</p>}
      <textarea
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError(null);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
    </div>
  );
}

function ChangeList({ changes }: { changes: Change[] }) {
  return (
    <ul className="changes">
      {changes.map((c) => (
        <li key={c.label}>
          <span className="label">{c.label}</span> {show(c.from)} → <b>{show(c.to)}</b>
        </li>
      ))}
    </ul>
  );
}

// ---- The page.

function App() {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [base, setBase] = useState<Version | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [mode, setMode] = useState<"fields" | "json">("fields");
  const [note, setNote] = useState("");
  const [viewing, setViewing] = useState<Version | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const list = await api<VersionSummary[]>("versions");
    setVersions(list);
    const active = list.find((v) => v.active);
    const full = active ? await api<Version>(`versions/${active.id}`) : null;
    setBase(full);
    setDraft(full?.data ?? null);
    setViewing(null);
    setServerIssues([]);
  }, []);

  useEffect(() => {
    reload().catch((err: Error) => setMessage({ kind: "error", text: err.message }));
  }, [reload]);

  const changes = useMemo(() => (base && draft ? diff(base.data, draft) : []), [base, draft]);
  const checked = useMemo(() => (draft ? checkBalance(draft) : null), [draft]);
  const issues = checked && !checked.ok ? checked.issues : serverIssues;

  const finish = async (result: ApplyResult, what: string) => {
    if (result.ok) {
      setNote("");
      await reload();
      setMessage({ kind: "ok", text: `${what}: version ${result.id} is active. New matches use it; matches already running keep theirs.` });
    } else {
      setServerIssues(result.issues);
      setMessage({ kind: "error", text: result.issues.join("; ") });
    }
  };

  const apply = async () => {
    if (!base) return;
    setBusy(true);
    try {
      await finish(await api<ApplyResult>("versions", { basedOn: base.id, note, data: draft }), "Applied");
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const rollBackTo = async (to: Version) => {
    if (!base) return;
    setBusy(true);
    try {
      await finish(await api<ApplyResult>(`versions/${to.id}/rollback`, { basedOn: base.id, note }), `Rolled back to version ${to.id}`);
    } catch (err) {
      setMessage({ kind: "error", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };

  if (!base || !draft) {
    return <main className="loading">{message ? <p className="error">{message.text}</p> : "Loading balance versions…"}</main>;
  }

  return (
    <div className="layout">
      <aside>
        <h2>Versions</h2>
        {versions.map((v) => (
          <button
            key={v.id}
            className={`version ${v.active ? "active" : ""} ${viewing?.id === v.id ? "selected" : ""}`}
            onClick={async () => setViewing(v.active ? null : await api<Version>(`versions/${v.id}`))}
          >
            <div>
              <b>v{v.id}</b> {v.active && <span className="badge">active</span>} <span className="muted">{when(v.createdAt)}</span>
            </div>
            <div className="note">{v.note || <span className="muted">no note</span>}</div>
            <div className="muted">{v.matches} {v.matches === 1 ? "match" : "matches"}</div>
          </button>
        ))}
      </aside>

      <main>
        {message && <p className={message.kind === "ok" ? "ok" : "error"}>{message.text}</p>}
        {viewing ? (
          <>
            <h1>Version {viewing.id}</h1>
            <p className="muted">
              {when(viewing.createdAt)} · {viewing.note || "no note"} · {viewing.matches} matches
            </p>
            <h3>Rolling back to it would change, from the active version {base.id}:</h3>
            {(() => {
              const back = diff(base.data, viewing.data);
              return back.length ? <ChangeList changes={back} /> : <p className="muted">Nothing: it has the same numbers.</p>;
            })()}
            <div className="apply">
              <input placeholder={`Note (default "Roll back to version ${viewing.id}")`} value={note} onChange={(e) => setNote(e.target.value)} />
              <button disabled={busy} onClick={() => rollBackTo(viewing)}>
                Roll back to v{viewing.id}
              </button>
              <button className="secondary" onClick={() => setViewing(null)}>
                Back to editing
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>
              Editing v{base.id} <span className="muted">(active)</span>
            </h1>
            <div className="tabs">
              <button className={mode === "fields" ? "on" : ""} onClick={() => setMode("fields")}>
                Values
              </button>
              <button className={mode === "json" ? "on" : ""} onClick={() => setMode("json")}>
                JSON
              </button>
            </div>
            {mode === "fields" ? (
              <FieldsEditor draft={draft} base={base.data} onChange={setDraft} />
            ) : (
              <JsonEditor key={base.id} draft={draft} onChange={setDraft} />
            )}
          </>
        )}
      </main>

      {!viewing && (
        <aside className="right">
          <h2>{changes.length ? `${changes.length} ${changes.length === 1 ? "change" : "changes"}` : "No changes yet"}</h2>
          <ChangeList changes={changes} />
          {issues.length > 0 && (
            <div className="error">
              <b>Can't apply: the game server would refuse this.</b>
              <ul>
                {issues.map((i) => (
                  <li key={i}>{i}</li>
                ))}
              </ul>
            </div>
          )}
          <textarea className="noteBox" placeholder="Note: what changed and why (shown with the version and its matches)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button disabled={busy || !changes.length || issues.length > 0 || !note.trim()} onClick={apply}>
            Apply as v{(versions[0]?.id ?? base.id) + 1}
          </button>
          {changes.length > 0 && (
            <button className="secondary" onClick={() => setDraft(base.data)}>
              Discard changes
            </button>
          )}
          <p className="muted">Applies to new matches only. A match in progress finishes on the version it started with.</p>
        </aside>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
