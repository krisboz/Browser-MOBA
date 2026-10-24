// The balance record as a flat list of editable values. Nothing here knows what the values mean: every number in
// the record shows up as a field, so a new stat or ability needs no dashboard change.

export type Path = (string | number)[];
export type Leaf = string | number | boolean | null;

export interface Field {
  path: Path;
  /** Readable path: array entries with an id are named by it ("abilities › bolt › cooldown"). */
  label: string;
  value: Leaf;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function step(container: unknown, key: string | number): string {
  if (Array.isArray(container)) {
    const entry = container[key as number];
    if (isObject(entry) && typeof entry.id === "string") return entry.id;
  }
  return String(key);
}

/** Every leaf value in `data`, depth first, in the record's own order. */
export function flatten(data: unknown): Field[] {
  const out: Field[] = [];
  const walk = (v: unknown, path: Path, labels: string[]) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...path, i], [...labels, step(v, i)]));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) walk(x, [...path, k], [...labels, k]);
    else out.push({ path, label: labels.join(" › "), value: v as Leaf });
  };
  walk(data, [], []);
  return out;
}

/** A copy of `data` with the value at `path` replaced. Untouched branches are shared. */
export function setAt<T>(data: T, path: Path, value: Leaf): T {
  if (!path.length) return value as T;
  const [key, ...rest] = path;
  const container = data as unknown as Record<string | number, unknown>;
  const copy = (Array.isArray(data) ? [...data] : { ...container }) as Record<string | number, unknown>;
  copy[key!] = setAt(container[key!], rest, value);
  return copy as T;
}

export interface Change {
  label: string;
  /** undefined: the value is not there on that side (added or removed in the JSON editor). */
  from: Leaf | undefined;
  to: Leaf | undefined;
}

/** What differs between two records, value by value. */
export function diff(before: unknown, after: unknown): Change[] {
  const key = (p: Path) => JSON.stringify(p);
  const a = new Map(flatten(before).map((f) => [key(f.path), f]));
  const b = new Map(flatten(after).map((f) => [key(f.path), f]));
  const out: Change[] = [];
  for (const [k, f] of b) {
    const old = a.get(k);
    if (!old) out.push({ label: f.label, from: undefined, to: f.value });
    else if (old.value !== f.value) out.push({ label: f.label, from: old.value, to: f.value });
  }
  for (const [k, f] of a) if (!b.has(k)) out.push({ label: f.label, from: f.value, to: undefined });
  return out;
}

/** Whether a field's label matches every word of a search ("bolt dam" finds Bolt's damage). */
export function matches(label: string, query: string): boolean {
  const l = label.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((w) => l.includes(w));
}
