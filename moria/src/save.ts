import type { ClassId } from './sim/classes';
import type { Progress } from './sim/interact';

/**
 * 저장 (화로에서 쉴 때). 1KB도 안 되는 JSON 하나라 localStorage로 충분하다:
 * setItem은 값 하나를 통째로 바꾸므로 '반쯤 쓴 저장'이 생기지 않는다 → 계획서의 idb-keyval + 2단계 쓰기는 필요 없었다.
 * 읽을 때는 버전 확인 + 모양 검사를 하고, 틀리면 버린다 (새 게임). 저장소가 막힌 환경(시크릿 창 등)에서는 조용히 실패.
 */
const KEY = 'moria.save';
export const SAVE_VERSION = 2;

export type SaveData = { v: typeof SAVE_VERSION; classId: ClassId; progress: Progress };

const ints = (x: unknown): x is number[] => Array.isArray(x) && x.every((n) => Number.isInteger(n));

/** 옛 버전 → 현재 버전. 한 단계씩 올린다 (v1 → v2: 보스 처치 목록 추가) */
export function migrate(raw: unknown): SaveData | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = { ...(raw as Record<string, unknown>) } as { v?: unknown; classId?: unknown; progress?: Record<string, unknown> };
  if (r.v === 1 && r.progress) {
    r.progress = { ...r.progress, bossesDown: [] };
    r.v = 2;
  }
  if (r.v !== SAVE_VERSION) return null;
  const p = r.progress;
  if (!['human', 'dwarf', 'elf'].includes(r.classId as string) || !p) return null;
  if (!ints(p.doorsOpen) || !ints(p.lit) || !Number.isInteger(p.checkpoint) || !ints(p.bossesDown)) return null;
  return {
    v: SAVE_VERSION,
    classId: r.classId as ClassId,
    progress: { doorsOpen: p.doorsOpen, lit: p.lit, checkpoint: p.checkpoint as number, bossesDown: p.bossesDown },
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

export function writeSave(classId: ClassId, progress: Progress): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE_VERSION, classId, progress } satisfies SaveData));
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
