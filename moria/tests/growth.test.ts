import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/save';
import { createEnemy } from '../src/sim/enemy';
import { CMD_RESET, TREES, XP, addXp, canLearn, xpToNext } from '../src/sim/growth';
import type { Level } from '../src/sim/level';
import { BTN_INTERACT, BTN_LIGHT, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';

/** 성장 (계획서 8장): XP 표·레벨업·스킬 규칙·명령 입력·효과·스냅샷·저장 이전 */
const FLAT: Level = {
  solids: [{ kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' }, { kind: 'cylinder', pos: [4, 0.45, 0], radius: 0.45, halfHeight: 0.45, surface: 'stone' }],
  torches: [],
  spawn: [0, 1.2, 0],
  braziers: [[4, 0, 0]],
};
const idle = (buttons = 0, cmd = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0, ...(cmd ? { cmd } : {}) });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
/** 앞 1.4m 고블린을 한 번 벤 피해 */
function hitDamage(s: Sim): number {
  const t = s.player.body.translation();
  const g = createEnemy(s, s.nextEnemyId++, [t.x, t.y, t.z - 1.4], [[t.x, t.y, t.z - 1.4]]);
  g.hp = 1000;
  s.enemies.push(g);
  stepSim(s, idle(BTN_LIGHT));
  run(s, idle(), 30);
  return 1000 - g.hp;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('성장', () => {
  it('필요 XP = 100 × L^1.5 (L·√L로 결정적 계산)', () => {
    expect(xpToNext(1)).toBe(100);
    expect(xpToNext(2)).toBe(283);
    expect(xpToNext(4)).toBe(800);
    expect(xpToNext(19)).toBe(Math.round(100 * 19 * Math.sqrt(19)));
  });

  it('레벨업: 스킬 포인트 +1, 최대 체력 +6 (그만큼 채움), 넘친 XP는 이어진다', () => {
    const s = createSim(FLAT, 1);
    s.player.hp = 50;
    addXp(s, 100 + 283 + 7);
    expect(s.player.level).toBe(3);
    expect(s.player.points).toBe(2);
    expect(s.player.xp).toBe(7);
    expect(s.player.maxHp).toBe(112);
    expect(s.player.hp).toBe(62);
    expect(s.events.filter((e) => e.type === 'levelUp').length).toBe(2);
    disposeSim(s);
  });

  it('고블린 처치 XP 10', () => {
    const s = createSim(FLAT, 2);
    run(s, idle(), 20);
    const t = s.player.body.translation();
    const g = createEnemy(s, s.nextEnemyId++, [t.x, t.y, t.z - 1.4], [[t.x, t.y, t.z - 1.4]]);
    g.hp = 1;
    s.enemies.push(g);
    stepSim(s, idle(BTN_LIGHT));
    run(s, idle(), 30);
    expect(g.ai).toBe('dead');
    expect(s.player.xp).toBe(XP.goblin);
    disposeSim(s);
  });

  it('스킬: 포인트가 있어야 하고, 같은 갈래 아래 단계를 배워야 다음 단계 (명령 입력으로)', () => {
    const s = createSim(FLAT, 3, 'human');
    run(s, idle(), 10);
    stepSim(s, idle(0, 1)); // 포인트 없음 → 무시
    expect(s.player.skills).toEqual([]);
    s.player.points = 2;
    const tier2 = TREES.human.nodes.findIndex((n) => n.branch === 1 && n.tier === 2);
    const tier1 = TREES.human.nodes.findIndex((n) => n.branch === 1 && n.tier === 1);
    expect(canLearn('human', [], 2, tier2)).toBe(false);
    stepSim(s, idle(0, tier2 + 1)); // 1단계 없이 2단계 → 무시
    expect(s.player.skills).toEqual([]);
    stepSim(s, idle(0, tier1 + 1));
    stepSim(s, idle(0, tier2 + 1));
    expect(s.player.skills).toEqual([tier1, tier2]);
    expect(s.player.points).toBe(0);
    expect(s.player.mods.dmg).toBeCloseTo(1.08, 6);
    expect(s.player.mods.stamina).toBeCloseTo(0.9, 6);
    disposeSim(s);
  });

  it('피해 스킬이 실제 타격 피해를 올린다', () => {
    const base = createSim(FLAT, 4, 'human');
    run(base, idle(), 20);
    const d0 = hitDamage(base);
    const buffed = createSim(FLAT, 4, 'human');
    run(buffed, idle(), 20);
    buffed.player.points = 1;
    stepSim(buffed, idle(0, TREES.human.nodes.findIndex((n) => n.branch === 1 && n.tier === 1) + 1));
    const d1 = hitDamage(buffed);
    // 피해는 배율을 곱한 뒤 한 번 반올림한다 → 원래 피해 × 1.08 근처, 그리고 확실히 크다
    expect(d1).toBeGreaterThan(d0);
    expect(Math.abs(d1 - d0 * 1.08)).toBeLessThanOrEqual(1);
    [base, buffed].forEach(disposeSim);
  });

  it('되돌리기는 밝힌 화로 곁에서만 — 포인트가 돌아온다', () => {
    const s = createSim(FLAT, 5, 'dwarf');
    run(s, idle(), 20);
    s.player.points = 1;
    stepSim(s, idle(0, 1));
    expect(s.player.skills.length).toBe(1);
    stepSim(s, idle(0, CMD_RESET)); // 화로에서 멀다
    expect(s.player.skills.length).toBe(1);
    s.player.body.setTranslation({ x: 4, y: 1.2, z: 1.5 }, true);
    run(s, idle(), 10);
    stepSim(s, idle(BTN_INTERACT)); // 화로 밝히기
    run(s, idle(), 2);
    stepSim(s, idle(0, CMD_RESET));
    expect(s.player.skills).toEqual([]);
    expect(s.player.points).toBe(1);
    disposeSim(s);
  });

  it('스냅샷은 성장을 담는다 (복원 뒤 같은 해시)', () => {
    const s = createSim(FLAT, 6, 'elf');
    addXp(s, 500);
    s.player.points = 1;
    stepSim(s, idle(0, 1));
    const b = restoreSim(FLAT, 6, 'elf', takeSnapshot(s));
    expect(hashSim(b)).toBe(hashSim(s));
    expect(b.player.mods).toEqual(s.player.mods);
    [s, b].forEach(disposeSim);
  });

  it('저장 v1·v2·v3·v4 → v5 (구역 1, 성장·장비·책 조각 기본값), 손상된 장비는 거른다', () => {
    const p1 = { doorsOpen: [0], lit: [1], checkpoint: 1 };
    const want = {
      v: 5, classId: 'dwarf', zone: 'zone1', entry: null, progress: { zone1: { ...p1, bossesDown: [], lampsLit: [] } }, growth: { level: 1, xp: 0, points: 0, skills: [] },
      gear: { inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0 },
      pages: [],
    };
    expect(migrate({ v: 1, classId: 'dwarf', progress: p1 })).toEqual(want);
    expect(migrate({ v: 2, classId: 'dwarf', progress: { ...p1, bossesDown: [] } })).toEqual(want);
    expect(migrate({ v: 3, classId: 'dwarf', zone: 'zone9', entry: null, progress: {}, growth: want.growth })).toBeNull();
    const { pages: _p, ...v4 } = want;
    expect(migrate({ ...v4, v: 4 })).toEqual(want);
    expect(migrate({ ...want, pages: ['x'] })).toBeNull();
    // 손상된 장비 (등급 9)는 버린다
    expect(migrate({ ...want, gear: { ...want.gear, inventory: [{ id: 1, slot: 'weapon', grade: 9, name: 'x', affixes: [], legendary: -1, upgrade: 0 }] } })).toBeNull();
  });
});
