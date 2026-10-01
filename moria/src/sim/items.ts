import type { Rng } from '../core/rng';
import type { Mods } from './growth';

/**
 * 장비 (계획서 8장): 슬롯 6개(무기, 보조, 머리, 몸통, 장신구 2), 등급 5단계(일반 → 정교 → 희귀 → 엘프제·드워프제 → 전설), 강화 +1~+5.
 *   등급이 오를수록 기본 수치가 오르고 덧붙는 효과가 하나씩 는다. 전설은 이름 있는 고유 효과 하나.
 *   효과는 스킬과 같은 전투 배율(Mods)로 합쳐진다 — 전투 코드는 장비를 모른다.
 * 전리품 등급은 '빛의 도박'(계획서 6장 A): 최근 어둠에 머문 비율이 높을수록 좋은 등급이 잘 나온다.
 * 굴림은 모두 sim.rng — 결정적.
 */
export type SlotKind = 'weapon' | 'offhand' | 'head' | 'body' | 'trinket';
/** 장착 칸 순서 (장신구 둘) */
export const EQUIP_SLOTS: readonly SlotKind[] = ['weapon', 'offhand', 'head', 'body', 'trinket', 'trinket'];
export const SLOT_NAMES = ['무기', '보조', '머리', '몸통', '장신구', '장신구'] as const;
export const GRADE_NAMES = ['일반', '정교', '희귀', '장인', '전설'] as const;
export const GRADE_COLORS = ['#9a9a9a', '#6ec46e', '#5aa0ff', '#b070ff', '#ffc040'] as const;
export const MAX_UPGRADE = 5;
export const INVENTORY_SIZE = 40;

export type Item = {
  readonly id: number;
  readonly slot: SlotKind;
  /** 0 일반 .. 4 전설 */
  readonly grade: number;
  /** 이름 (기본형 또는 전설 이름) */
  readonly name: string;
  /** 덧붙은 효과 (등급만큼) */
  readonly affixes: readonly Partial<Mods>[];
  /** 전설 고유 효과 번호 (없으면 −1) */
  readonly legendary: number;
  upgrade: number;
};

const BASES: Record<SlotKind, readonly string[]> = {
  weapon: ['녹슨 검', '장검', '넓은 날 검', '두네다인 검'],
  offhand: ['나무 방패', '둥근 방패', '단검', '쇠 방패'],
  head: ['가죽 두건', '쇠 투구', '사슬 두건', '드워프 투구'],
  body: ['누빈 옷', '가죽 갑옷', '사슬 갑옷', '비늘 갑옷'],
  trinket: ['뼈 부적', '은반지', '돌 목걸이', '룬 조각'],
};

/** 전설: 슬롯마다 하나 (이름 · 설명 · 효과) */
export const LEGENDARIES: readonly { slot: SlotKind; name: string; desc: string; mods: Partial<Mods> }[] = [
  { slot: 'weapon', name: '스팅', desc: '어둠 속에서 더 깊이 찌른다 — 피해 +20%, 어둠 보너스 +0.1', mods: { dmg: 1.2, dark: 0.1 } },
  { slot: 'offhand', name: '곤도르의 방패', desc: '패링 창 +4틱, 반격 배수 +0.5', mods: { parry: 4, riposte: 0.5 } },
  { slot: 'head', name: '두린의 투구', desc: '최대 체력 +25, 패링 창 +2틱', mods: { hp: 25, parry: 2 } },
  { slot: 'body', name: '미스릴 사슬갑옷', desc: '최대 체력 +60, 스태미나 비용 −15%', mods: { hp: 60, stamina: 0.85 } },
  { slot: 'trinket', name: '갈라드리엘의 별빛', desc: '돌의 감각 반경 +10m·재사용 −3초, 동료 게이지 +20%', mods: { sense: 10, senseCd: 180, ally: 1.2 } },
];

/** 덧붙는 효과 후보 (굴림 범위는 등급으로 조금 커진다) */
const AFFIXES: readonly ((g: number, r: Rng) => Partial<Mods>)[] = [
  (g, r) => ({ dmg: 1 + (3 + g + r.int(3)) / 100 }),
  (g, r) => ({ heavy: 1 + (5 + 2 * g + r.int(4)) / 100 }),
  (g, r) => ({ hp: 5 + 3 * g + r.int(6) }),
  (g, r) => ({ stamina: 1 - (4 + g + r.int(3)) / 100 }),
  (g) => ({ parry: 1 + (g >= 3 ? 1 : 0) }),
  (g) => ({ iframe: 1 + (g >= 3 ? 1 : 0) }),
  (g, r) => ({ ally: 1 + (5 + 2 * g + r.int(5)) / 100 }),
  (g, r) => ({ sense: 2 + g + r.int(3) }),
  (g, r) => ({ dark: (3 + g + r.int(3)) / 100 }),
];

/** 등급 굴림: 기본 가중치 [60, 25, 10, 4, 1]%. 어둠 비율(0..1)만큼 높은 등급 가중치를 최대 3배로 키운다. floor 이상만 */
export function rollGrade(r: Rng, darkness: number, floor = 0): number {
  const w = [60, 25, 10, 4, 1].map((x, g) => (g < floor ? 0 : g === 0 ? x : x * (1 + 2 * darkness)));
  const total = w.reduce((a, b) => a + b, 0);
  let t = r.next() * total;
  for (let g = 0; g < w.length; g++) {
    t -= w[g]!;
    if (t < 0) return g;
  }
  return w.length - 1;
}

export function rollItem(r: Rng, id: number, darkness: number, floor = 0): Item {
  const grade = rollGrade(r, darkness, floor);
  const slot = (['weapon', 'offhand', 'head', 'body', 'trinket'] as const)[r.int(5)]!;
  if (grade === 4) {
    const li = LEGENDARIES.findIndex((l) => l.slot === slot);
    return { id, slot, grade, name: LEGENDARIES[li]!.name, affixes: [], legendary: li, upgrade: 0 };
  }
  const base = BASES[slot][Math.min(BASES[slot].length - 1, grade)]!;
  const affixes: Partial<Mods>[] = [];
  for (let i = 0; i < grade; i++) affixes.push(AFFIXES[r.int(AFFIXES.length)]!(grade, r));
  return { id, slot, grade, name: base, affixes, legendary: -1, upgrade: 0 };
}

/** 슬롯 기본 수치 (등급·강화에 비례) — 등급이 같으면 강화가 낫다 */
export function baseMods(it: Item): Partial<Mods> {
  const g = it.grade;
  const u = it.upgrade;
  switch (it.slot) {
    case 'weapon':
      return { dmg: 1 + 0.04 * g + 0.03 * u };
    case 'offhand':
      return { stamina: 1 - 0.02 * g - 0.015 * u };
    case 'head':
      return { hp: 5 * g + 4 * u };
    case 'body':
      return { hp: 10 * g + 8 * u };
    case 'trinket':
      return { dark: 0.01 * g + 0.01 * u };
  }
}

/** 아이템 하나의 모든 효과 (기본 + 덧붙음 + 전설) */
export function itemMods(it: Item): Partial<Mods>[] {
  const out = [baseMods(it), ...it.affixes];
  if (it.legendary >= 0) out.push(LEGENDARIES[it.legendary]!.mods);
  return out;
}

/** 강화 비용: +n으로 올리려면 미스릴 n개 + 금화 40·n */
export const upgradeCost = (next: number) => ({ mithril: next, gold: 40 * next });

/** 효과 설명 (UI용) */
const LABEL: Record<keyof Mods, (v: number) => string> = {
  dmg: (v) => `피해 +${Math.round((v - 1) * 100)}%`,
  heavy: (v) => `강공격 +${Math.round((v - 1) * 100)}%`,
  hp: (v) => `체력 +${v}`,
  stamina: (v) => `스태미나 비용 −${Math.round((1 - v) * 100)}%`,
  parry: (v) => `패링 창 +${v}틱`,
  iframe: (v) => `회피 무적 +${v}틱`,
  riposte: (v) => `반격 +${v}`,
  ally: (v) => `동료 게이지 +${Math.round((v - 1) * 100)}%`,
  sense: (v) => `감각 반경 +${v}m`,
  senseCd: (v) => `감각 재사용 −${(v / 60).toFixed(0)}초`,
  dark: (v) => `어둠 보너스 +${v.toFixed(2)}`,
};
export function describe(it: Item): string[] {
  const out: string[] = [];
  for (const m of itemMods(it)) {
    for (const [k, v] of Object.entries(m) as [keyof Mods, number][]) {
      const neutral = (k === 'dmg' || k === 'heavy' || k === 'ally' || k === 'stamina') ? Math.abs(v - 1) < 1e-9 : v === 0;
      if (!neutral) out.push(LABEL[k](v));
    }
  }
  return out;
}
