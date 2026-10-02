import { applyShopCommand, type NpcKind } from './shop';
import type { ClassId } from './classes';
import { applyGearCommand } from './gear';
import { itemMods, type Item } from './items';
import type { Sim } from './types';

/**
 * 성장 (계획서 8장): 레벨(최대 20) + 스킬 트리. 스탯을 직접 나누지 않고, 레벨업은 체력·피해를 조금 올리고 스킬 포인트 1개를 준다.
 * 필요 XP(L → L+1) = 100 × L^1.5. Math.pow는 명세상 근사라 쓰지 않고 L × √L (sqrt는 정확히 반올림)로 계산한다.
 * 스킬 효과는 전투 수치 배율(Mods) 하나로 모인다 — 전투 코드는 이 값만 읽는다.
 * 스킬 트리: 종족마다 3갈래 × 5단계. 계획서는 단계당 3노드(45노드)지만 지금은 단계당 1노드(15노드) — 자료 구조는 여러 노드를 받는다.
 * 스킬 배우기·초기화는 입력 명령(InputFrame.cmd)으로 들어온다 → 리플레이가 재현한다.
 */
export const MAX_LEVEL = 20;
export const HP_PER_LEVEL = 6;
export const DMG_PER_LEVEL = 0.02;
export const BASE_HP = 100;

/** L → L+1에 필요한 XP */
export const xpToNext = (level: number) => Math.round(100 * level * Math.sqrt(level));

/** 처치 XP */
export const XP = { goblin: 10, archer: 15, uruk: 30, horde: 2, troll: 150, captain: 200, balrog: 500 } as const;

export type Mods = {
  /** 피해 배율 */
  dmg: number;
  /** 강공격 추가 배율 */
  heavy: number;
  /** 최대 체력 추가 */
  hp: number;
  /** 스태미나 비용 배율 */
  stamina: number;
  /** 패링 창 추가 틱 */
  parry: number;
  /** 회피 무적 추가 틱 */
  iframe: number;
  /** 반격 배수 추가 */
  riposte: number;
  /** 동료 게이지 획득 배율 */
  ally: number;
  /** 돌의 감각 반경 추가 (m) */
  sense: number;
  /** 돌의 감각 재사용 단축 (틱) */
  senseCd: number;
  /** 빛의 도박 어둠 보너스 추가 */
  dark: number;
};
export const BASE_MODS: Mods = { dmg: 1, heavy: 1, hp: 0, stamina: 1, parry: 0, iframe: 0, riposte: 0, ally: 1, sense: 0, senseCd: 0, dark: 0 };

export type SkillNode = { branch: 0 | 1 | 2; tier: 1 | 2 | 3 | 4 | 5; name: string; desc: string; mods: Partial<Mods> };
export type Tree = { branches: readonly [string, string, string]; nodes: readonly SkillNode[] };

const n = (branch: 0 | 1 | 2, tier: 1 | 2 | 3 | 4 | 5, name: string, desc: string, mods: Partial<Mods>): SkillNode => ({ branch, tier, name, desc, mods });

/**
 * 종족별 트리. 계획서의 엘프 갈래(명사수·폭풍·빛의 가수)는 활 기반인데 활이 아직 없다 →
 * 지금 있는 메커니즘(회피·칼·빛/감각)에 맞춰 '그림자 걸음·폭풍·빛의 가수'로 둔다.
 * 배열 순서가 명령 번호다 (바꾸면 옛 리플레이·저장이 다른 스킬을 가리킨다 → 뒤에만 더한다).
 */
export const TREES: Record<ClassId, Tree> = {
  human: {
    branches: ['수호자', '검사', '지휘관'],
    nodes: [
      n(0, 1, '방패 세우기', '패링 창 +3틱', { parry: 3 }),
      n(0, 2, '곤도르의 체력', '최대 체력 +20', { hp: 20 }),
      n(0, 3, '되받아치기', '반격 배수 +0.5', { riposte: 0.5 }),
      n(0, 4, '흔들림 없는 방패', '패링 창 +3틱', { parry: 3 }),
      n(0, 5, '변방의 수호자', '최대 체력 +40, 스태미나 비용 −15%', { hp: 40, stamina: 0.85 }),
      n(1, 1, '날 세우기', '피해 +8%', { dmg: 1.08 }),
      n(1, 2, '가벼운 발', '스태미나 비용 −10%', { stamina: 0.9 }),
      n(1, 3, '내려치기', '강공격 +20%', { heavy: 1.2 }),
      n(1, 4, '검술', '피해 +10%', { dmg: 1.1 }),
      n(1, 5, '두네다인의 검', '피해 +12%, 반격 배수 +0.5', { dmg: 1.12, riposte: 0.5 }),
      n(2, 1, '신호', '동료 게이지 획득 +25%', { ally: 1.25 }),
      n(2, 2, '호각', '동료 게이지 획득 +25%', { ally: 1.25 }),
      n(2, 3, '버티는 법', '스태미나 비용 −10%', { stamina: 0.9 }),
      n(2, 4, '전령', '동료 게이지 획득 +30%', { ally: 1.3 }),
      n(2, 5, '곤도르의 뿔나팔', '동료 게이지 획득 +40%, 최대 체력 +20', { ally: 1.4, hp: 20 }),
    ],
  },
  dwarf: {
    branches: ['버서커', '철벽', '광부'],
    nodes: [
      n(0, 1, '분노', '피해 +10%', { dmg: 1.1 }),
      n(0, 2, '도끼 휘두르기', '강공격 +20%', { heavy: 1.2 }),
      n(0, 3, '피의 맛', '피해 +10%', { dmg: 1.1 }),
      n(0, 4, '쪼개기', '강공격 +25%', { heavy: 1.25 }),
      n(0, 5, '두린의 분노', '피해 +15%, 어둠 보너스 +0.15', { dmg: 1.15, dark: 0.15 }),
      n(1, 1, '두꺼운 가죽', '최대 체력 +25', { hp: 25 }),
      n(1, 2, '고집', '스태미나 비용 −10%', { stamina: 0.9 }),
      n(1, 3, '바위 같은', '최대 체력 +35', { hp: 35 }),
      n(1, 4, '방패벽', '패링 창 +2틱', { parry: 2 }),
      n(1, 5, '철산', '최대 체력 +50', { hp: 50 }),
      n(2, 1, '돌의 귀', '돌의 감각 반경 +6m', { sense: 6 }),
      n(2, 2, '갱도의 박자', '돌의 감각 재사용 −2초', { senseCd: 120 }),
      n(2, 3, '어둠눈', '어둠 보너스 +0.15', { dark: 0.15 }),
      n(2, 4, '깊은 울림', '돌의 감각 반경 +8m', { sense: 8 }),
      n(2, 5, '크하자드둠의 기억', '돌의 감각 재사용 −2초, 동료 게이지 +20%', { senseCd: 120, ally: 1.2 }),
    ],
  },
  elf: {
    branches: ['그림자 걸음', '폭풍', '빛의 가수'],
    nodes: [
      n(0, 1, '바람 걸음', '회피 무적 +3틱', { iframe: 3 }),
      n(0, 2, '가벼운 숨', '스태미나 비용 −12%', { stamina: 0.88 }),
      n(0, 3, '잎사귀처럼', '회피 무적 +3틱', { iframe: 3 }),
      n(0, 4, '달 없는 밤', '어둠 보너스 +0.15', { dark: 0.15 }),
      n(0, 5, '로리엔의 그림자', '피해 +10%, 회피 무적 +2틱', { dmg: 1.1, iframe: 2 }),
      n(1, 1, '날랜 칼', '피해 +8%', { dmg: 1.08 }),
      n(1, 2, '흐르는 동작', '스태미나 비용 −10%', { stamina: 0.9 }),
      n(1, 3, '연무', '피해 +10%', { dmg: 1.1 }),
      n(1, 4, '벼락', '강공격 +15%', { heavy: 1.15 }),
      n(1, 5, '폭풍의 춤', '피해 +12%, 반격 배수 +0.5', { dmg: 1.12, riposte: 0.5 }),
      n(2, 1, '별빛 노래', '돌의 감각 반경 +6m', { sense: 6 }),
      n(2, 2, '맑은 귀', '돌의 감각 재사용 −2초', { senseCd: 120 }),
      n(2, 3, '벗을 부르는 노래', '동료 게이지 획득 +20%', { ally: 1.2 }),
      n(2, 4, '엘베레스', '돌의 감각 반경 +8m', { sense: 8 }),
      n(2, 5, '빛의 가수', '돌의 감각 재사용 −2초, 동료 게이지 +20%', { senseCd: 120, ally: 1.2 }),
    ],
  },
};

/** 배율은 곱하고 나머지는 더한다 */
const MULT: ReadonlySet<keyof Mods> = new Set(['dmg', 'heavy', 'stamina', 'ally']);

export function computeMods(classId: ClassId, level: number, skills: readonly number[], gear: readonly (Item | null)[] = []): Mods {
  const m: Mods = { ...BASE_MODS, dmg: 1 + DMG_PER_LEVEL * (level - 1) };
  const nodes = TREES[classId].nodes;
  for (const i of skills) {
    const node = nodes[i];
    if (!node) continue;
    for (const [k, v] of Object.entries(node.mods) as [keyof Mods, number][]) m[k] = MULT.has(k) ? m[k] * v : m[k] + v;
  }
  // 장비: 스킬과 같은 규칙으로 합친다 (배율은 곱하고 나머지는 더한다)
  for (const it of gear) {
    if (!it) continue;
    for (const mods of itemMods(it)) for (const [k, v] of Object.entries(mods) as [keyof Mods, number][]) m[k] = MULT.has(k) ? m[k] * v : m[k] + v;
  }
  return m;
}

export const maxHpFor = (level: number, mods: Mods) => BASE_HP + HP_PER_LEVEL * (level - 1) + mods.hp;

/** 배울 수 있는가: 포인트가 있고, 아직 없고, 1단계거나 같은 갈래 바로 아래 단계를 하나 이상 배웠다 */
export function canLearn(classId: ClassId, skills: readonly number[], points: number, index: number): boolean {
  const nodes = TREES[classId].nodes;
  const node = nodes[index];
  if (!node || points <= 0 || skills.includes(index)) return false;
  return node.tier === 1 || skills.some((i) => nodes[i]!.branch === node.branch && nodes[i]!.tier === node.tier - 1);
}

/** 레벨·스킬·장비가 바뀌면 배율과 최대 체력을 다시 계산한다 */
export function refreshMods(sim: Sim) {
  const p = sim.player;
  const before = p.maxHp;
  p.mods = computeMods(sim.classId, p.level, p.skills, p.equipped);
  p.maxHp = maxHpFor(p.level, p.mods);
  // 최대 체력이 늘면 그만큼 채운다 (줄면 넘치는 만큼 깎는다)
  p.hp = Math.max(1, Math.min(p.maxHp, p.hp + (p.maxHp - before)));
}

/** XP를 더한다. 레벨업마다 스킬 포인트 1, 체력·피해 조금 */
export function addXp(sim: Sim, amount: number) {
  const p = sim.player;
  if (p.level >= MAX_LEVEL || amount <= 0) return;
  p.xp += amount;
  while (p.level < MAX_LEVEL && p.xp >= xpToNext(p.level)) {
    p.xp -= xpToNext(p.level);
    p.level++;
    p.points++;
    refreshMods(sim);
    sim.events.push({ type: 'levelUp', tick: sim.tick, level: p.level });
  }
  if (p.level >= MAX_LEVEL) p.xp = 0;
}

/** 입력 명령: 1..N = N−1번 노드 배우기, 255 = 초기화(밝힌 화로 곁에서만 — 계획서: 등불에서 무료로) */
export const CMD_RESET = 255;
export function applyCommand(sim: Sim, cmd: number, nearLitBrazier: boolean, npc: NpcKind | null = null) {
  const p = sim.player;
  // 대장장이 곁에서도 강화할 수 있다
  if (applyGearCommand(sim, cmd, nearLitBrazier || (npc === 'smith' && sim.forge.lit))) return; // 100..205 장비 명령
  if (applyShopCommand(sim, cmd, npc)) return; // 209..2xx 상점
  if (cmd === CMD_RESET) {
    if (!nearLitBrazier || p.skills.length === 0) return;
    p.points += p.skills.length;
    p.skills = [];
    refreshMods(sim);
    sim.events.push({ type: 'skill', tick: sim.tick, index: -1 });
    return;
  }
  const index = cmd - 1;
  if (!canLearn(sim.classId, p.skills, p.points, index)) return;
  p.skills = [...p.skills, index];
  p.points--;
  refreshMods(sim);
  sim.events.push({ type: 'skill', tick: sim.tick, index });
}

/** 저장에서 장비 복원 (첫 틱 전, restoreGrowth보다 먼저 — 최대 체력 계산에 장비가 들어간다) */
export function restoreGear(sim: Sim, g: { inventory: Item[]; equipped: (Item | null)[]; gold: number; mithril: number }) {
  const p = sim.player;
  p.inventory = g.inventory.map((i) => ({ ...i }));
  p.equipped = g.equipped.map((i) => (i ? { ...i } : null));
  p.gold = Math.max(0, g.gold);
  p.mithril = Math.max(0, g.mithril);
  // 새 아이템 번호가 저장된 것과 겹치지 않게
  const ids = [...p.inventory, ...p.equipped].flatMap((i) => (i ? [i.id] : []));
  sim.nextItemId = Math.max(sim.nextItemId, ...ids.map((i) => i + 1), 0);
}

/** 저장에서 복원 (첫 틱 전) */
export function restoreGrowth(sim: Sim, g: { level: number; xp: number; points: number; skills: number[] }) {
  const p = sim.player;
  p.level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(g.level)));
  p.xp = Math.max(0, Math.floor(g.xp));
  p.skills = g.skills.filter((i, k, a) => Number.isInteger(i) && TREES[sim.classId].nodes[i] && a.indexOf(i) === k);
  p.points = Math.max(0, Math.floor(g.points));
  p.mods = computeMods(sim.classId, p.level, p.skills, p.equipped);
  p.maxHp = maxHpFor(p.level, p.mods);
  p.hp = p.maxHp;
}
