import type { ClassId } from './sim/classes';
import type { Progress } from './sim/interact';
import type { ZoneId } from './sim/level';
import type { Item } from './sim/items';

/**
 * 저장 (화로에서 쉴 때, 보스를 쓰러뜨렸을 때, 구역을 옮길 때). 몇 KB의 JSON 하나라 localStorage로 충분하다:
 * setItem은 값 하나를 통째로 바꾸므로 '반쯤 쓴 저장'이 생기지 않는다 → 계획서의 idb-keyval + 2단계 쓰기는 필요 없었다.
 * 읽을 때는 버전을 한 단계씩 올린 뒤(migrate) 모양을 검사하고, 틀리면 버린다 (새 게임). 저장소가 막힌 환경에서는 조용히 실패.
 *   v1: 진행 상태 하나 / v2: + 보스 처치 / v3: 구역별 진행 상태 + 현재 구역·입구 + 성장(레벨·XP·스킬) / v4: + 장비(인벤토리·장착·금화·미스릴)
 */
const KEY = 'moria.save';
export const SAVE_VERSION = 4;

export type Growth = { level: number; xp: number; points: number; skills: number[] };
export type Gear = { inventory: Item[]; equipped: (Item | null)[]; gold: number; mithril: number };
const EMPTY_GEAR: Gear = { inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0 };
export type SaveData = {
  v: typeof SAVE_VERSION;
  classId: ClassId;
  /** 지금 있는 구역 */
  zone: ZoneId;
  /** 구역에 들어온 입구 (그 구역에서 아직 화로에 쉬지 않았을 때 여기서 시작) */
  entry: string | null;
  progress: Partial<Record<ZoneId, Progress>>;
  growth: Growth;
  gear: Gear;
};

const SLOTS = ['weapon', 'offhand', 'head', 'body', 'trinket'];
/** 아이템 모양 검사 (손상·조작된 저장을 걸러낸다) */
function validItem(x: unknown): Item | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const affixes = r.affixes;
  const okAffixes = Array.isArray(affixes) && affixes.every((a) => typeof a === 'object' && a !== null && Object.values(a).every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (!Number.isInteger(r.id) || !SLOTS.includes(r.slot as string) || !Number.isInteger(r.grade) || (r.grade as number) < 0 || (r.grade as number) > 4) return null;
  if (typeof r.name !== 'string' || !okAffixes || !Number.isInteger(r.legendary) || !Number.isInteger(r.upgrade) || (r.upgrade as number) < 0 || (r.upgrade as number) > 5) return null;
  return { id: r.id as number, slot: r.slot as Item['slot'], grade: r.grade as number, name: r.name, affixes: affixes as Item['affixes'], legendary: r.legendary as number, upgrade: r.upgrade as number };
}
function validGear(x: unknown): Gear | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  if (!Array.isArray(r.inventory) || !Array.isArray(r.equipped) || r.equipped.length !== 6 || !Number.isInteger(r.gold) || !Number.isInteger(r.mithril)) return null;
  const raw = r.equipped as unknown[];
  const inventory = r.inventory.map(validItem);
  const equipped = raw.map((e) => (e === null ? null : validItem(e)));
  if (inventory.some((i) => !i) || equipped.some((e, k) => e === null && raw[k] !== null)) return null;
  return { inventory: inventory as Item[], equipped, gold: r.gold as number, mithril: r.mithril as number };
}

const ints = (x: unknown): x is number[] => Array.isArray(x) && x.every((n) => Number.isInteger(n));
const ZONES: readonly ZoneId[] = ['zone1', 'zone2'];

function validProgress(p: unknown): Progress | null {
  if (typeof p !== 'object' || p === null) return null;
  const r = p as Record<string, unknown>;
  const lampsLit = r.lampsLit ?? [];
  if (!ints(r.doorsOpen) || !ints(r.lit) || !Number.isInteger(r.checkpoint) || !ints(r.bossesDown) || !ints(lampsLit)) return null;
  return { doorsOpen: r.doorsOpen, lit: r.lit, checkpoint: r.checkpoint as number, bossesDown: r.bossesDown, lampsLit };
}

/** 옛 버전 → 현재 버전. 한 단계씩 올린다 */
export function migrate(raw: unknown): SaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  let r = { ...(raw as Record<string, unknown>) };
  if (r.v === 1 && typeof r.progress === 'object' && r.progress) {
    r = { ...r, v: 2, progress: { ...(r.progress as object), bossesDown: [] } };
  }
  if (r.v === 2) {
    r = { v: 3, classId: r.classId, zone: 'zone1', entry: null, progress: { zone1: r.progress }, growth: { level: 1, xp: 0, points: 0, skills: [] } };
  }
  if (r.v === 3) r = { ...r, v: 4, gear: EMPTY_GEAR };
  if (r.v !== SAVE_VERSION || !['human', 'dwarf', 'elf'].includes(r.classId as string)) return null;
  if (!ZONES.includes(r.zone as ZoneId) || (r.entry !== null && typeof r.entry !== 'string')) return null;
  const progress: Partial<Record<ZoneId, Progress>> = {};
  for (const z of ZONES) {
    const p = (r.progress as Record<string, unknown> | undefined)?.[z];
    if (p === undefined) continue;
    const v = validProgress(p);
    if (!v) return null;
    progress[z] = v;
  }
  const g = r.growth as Partial<Growth> | undefined;
  if (!g || !Number.isInteger(g.level) || !Number.isInteger(g.xp) || !Number.isInteger(g.points) || !ints(g.skills)) return null;
  const gear = validGear(r.gear);
  if (!gear) return null;
  return {
    v: SAVE_VERSION, classId: r.classId as ClassId, zone: r.zone as ZoneId, entry: (r.entry as string | null) ?? null,
    progress, growth: { level: g.level!, xp: g.xp!, points: g.points!, skills: g.skills }, gear,
  };
}

export function loadSave(): SaveData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? migrate(JSON.parse(s)) : null;
  } catch {
    return null;
  }
}

export function writeSave(data: Omit<SaveData, 'v'>): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE_VERSION, ...data } satisfies SaveData));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 저장소 없음 */
  }
}
