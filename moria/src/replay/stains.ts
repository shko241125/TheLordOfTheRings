/**
 * Stains: where the player died, a mark is left for a later run to find.
 * Presentation-only — never read by the simulation, saves or replays.
 * Persisted as a JSON array (oldest first) in localStorage-compatible storage.
 */

export type Stain = { zone: string; x: number; y: number; z: number; line: string; at: number };
export type StainStore = { getItem(k: string): string | null; setItem(k: string, v: string): void };

export const STAIN_KEY = 'moria.stains';
export const MAX_PER_ZONE = 5;
export const MAX_TOTAL = 30;
export const NEAR_R = 2.5;
export const LEAVE_R = 4;
const MAX_LINE = 200;

/** `undefined` → localStorage when accessible; explicit `null` → no storage. */
function resolveStore(store: StainStore | null | undefined): StainStore | null {
  if (store !== undefined) return store;
  try {
    return (globalThis as { localStorage?: StainStore }).localStorage ?? null;
  } catch {
    return null;
  }
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isStain(v: unknown): v is Stain {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.zone === 'string' && fin(s.x) && fin(s.y) && fin(s.z) && typeof s.line === 'string' && fin(s.at);
}

export function loadStains(store?: StainStore | null): Stain[] {
  const st = resolveStore(store);
  if (!st) return [];
  try {
    const parsed: unknown = JSON.parse(st.getItem(STAIN_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // keep only the contract fields; trim hand-edited long lines
    return parsed.filter(isStain).map(({ zone, x, y, z, line, at }) => ({ zone, x, y, z, line: line.slice(0, MAX_LINE), at }));
  } catch {
    return [];
  }
}

export function addStain(stain: Stain, store?: StainStore | null): Stain[] {
  const st = resolveStore(store);
  let list = [...loadStains(st), { ...stain, line: stain.line.slice(0, MAX_LINE) }];
  // per-zone cap first, then the global cap; both drop the oldest (earliest in order)
  const zoneCount = list.filter((s) => s.zone === stain.zone).length;
  if (zoneCount > MAX_PER_ZONE) {
    let drop = zoneCount - MAX_PER_ZONE;
    list = list.filter((s) => !(s.zone === stain.zone && drop-- > 0));
  }
  if (list.length > MAX_TOTAL) list = list.slice(list.length - MAX_TOTAL);
  try {
    st?.setItem(STAIN_KEY, JSON.stringify(list));
  } catch {
    /* storage full / blocked: keep the in-memory result */
  }
  return list;
}

export function stainsIn(list: Stain[], zone: string): Stain[] {
  return list.filter((s) => s.zone === zone);
}

export function nearestStain(list: Stain[], zone: string, x: number, z: number, r = NEAR_R): Stain | null {
  let best: Stain | null = null;
  let bestD = r;
  for (const s of list) {
    if (s.zone !== zone) continue;
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Reports a stain once when it comes into `near`; re-arms only after the player is more than `leave` away. */
export function createStainNotifier(near = NEAR_R, leave = LEAVE_R) {
  // identity by value so a freshly loaded array each frame does not re-fire
  const key = (s: Stain) => `${s.zone}|${s.at}|${s.x}|${s.z}`;
  const shown = new Map<string, Stain>();
  return {
    update(list: Stain[], zone: string, x: number, z: number): Stain | null {
      for (const [k, s] of shown) if (s.zone !== zone || Math.hypot(s.x - x, s.z - z) > leave) shown.delete(k);
      const s = nearestStain(list, zone, x, z, near);
      if (!s || shown.has(key(s))) return null;
      shown.set(key(s), s);
      return s;
    },
  };
}
