import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { ESCORT_HP } from '../src/sim/escort';
import { restoreGrowth } from '../src/sim/growth';
import { nearestInteractable, progressOf, restoreProgress } from '../src/sim/interact';
import { migrate } from '../src/save';
import { BTN_INTERACT, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE2 } from '../src/sim/zone2';
import { mainStatus, sideStatus } from '../src/quests';

/** 호위 퀘스트 '갇힌 광부 구출' (구역 2): 따라오기, 적 곁에서 다침·쓰러짐, 구출 보상(영구 동료 게이지 +25%), 저장·스냅샷 */
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (s: Sim, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, idle());
};
const put = (s: Sim, x: number, z: number) => s.player.body.setTranslation({ x, y: 1.2, z }, true);
/** 적을 모두 치우고 광부에게 말을 건다 */
const start = (s: Sim) => {
  for (const e of s.enemies) {
    e.hp = 0;
    e.ai = 'dead';
    e.collider.setCollisionGroups(0);
  }
  put(s, s.escort.x - 1.2, s.escort.z + 0.5);
  run(s, 3);
  expect(nearestInteractable(s)).toMatchObject({ kind: 'escort' });
  stepSim(s, idle(BTN_INTERACT));
  expect(s.escort.state).toBe('following');
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('갇힌 광부 구출 (호위)', () => {
  it('따라와서 동쪽 층계 화로에 닿으면 구출 — 미스릴·금화·영구 동료 게이지 +25%', () => {
    const s = createSim(ZONE2, 1);
    start(s);
    const ally0 = s.player.mods.ally;
    // 플레이어가 홀을 가로질러 화로 쪽으로 몇 걸음씩 옮겨 간다 (광부는 경로로 따라온다)
    for (const [x, z] of [[14, -50], [8, -38], [2, -26], [0, -14], [0, -2], [1.4, 9.5]] as const) {
      put(s, x, z);
      for (let i = 0; i < 60 * 8 && s.escort.state === 'following'; i++) {
        stepSim(s, idle());
        if ((s.escort.x - x) ** 2 + (s.escort.z - z) ** 2 < 2.6 ** 2) break;
      }
    }
    run(s, 60 * 4);
    expect(s.escort.state).toBe('saved');
    expect(s.escort.hp).toBe(ESCORT_HP);
    expect(s.player.mithril).toBe(4);
    expect(s.player.gold).toBe(60);
    expect(s.player.perks).toEqual(['miner']);
    expect(s.player.mods.ally).toBeCloseTo(ally0 * 1.25);
    expect(sideStatus(s, 0).find((q) => q.id === 'miner')!.done).toBe(true);
    expect(progressOf(s).rescued).toBe(true);
    expect(mainStatus(s)).not.toBeNull();
    disposeSim(s);
  });

  it('적 곁에 있으면 다치고, 체력 0이면 쓰러진다', () => {
    const s = createSim(ZONE2, 2);
    start(s);
    // 고블린 하나를 광부 곁에 붙잡아 둔다 (휘청임 상태는 움직이지 않는다)
    const g = s.enemies.find((e) => e.kind === 'goblin')!;
    g.hp = 30;
    g.ai = 'stagger';
    g.staggerLen = 1_000_000;
    g.collider.setCollisionGroups(0);
    g.body.setTranslation({ x: s.escort.x + 0.5, y: 1, z: s.escort.z }, true);
    run(s, 60);
    expect(s.escort.hp).toBeLessThan(ESCORT_HP);
    expect(s.events.some((e) => e.type === 'escort' && e.stage === 'hurt')).toBe(true);
    run(s, 60 * 8);
    expect(s.escort.state).toBe('dead');
    disposeSim(s);
  });

  it('저장: 구역 진행의 rescued와 성장의 perks로 되살린다 (v5 선택 필드)', () => {
    const s = createSim(ZONE2, 3);
    restoreProgress(s, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [], rescued: true }, 'south');
    expect(s.escort.state).toBe('saved');
    expect(nearestInteractable(s)?.kind).not.toBe('escort');
    restoreGrowth(s, { level: 1, xp: 0, points: 0, skills: [], perks: ['miner', 'bogus'] });
    expect(s.player.perks).toEqual(['miner']);
    expect(s.player.mods.ally).toBeCloseTo(1.25);
    const save = {
      v: 5, classId: 'human', zone: 'zone2', entry: null, progress: { zone2: { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [], rescued: true } },
      growth: { level: 1, xp: 0, points: 0, skills: [], perks: ['miner'] }, gear: { inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0 }, pages: [],
    };
    expect(migrate(save)?.progress.zone2?.rescued).toBe(true);
    expect(migrate(save)?.growth.perks).toEqual(['miner']);
    expect(migrate({ ...save, progress: { zone2: { ...save.progress.zone2, rescued: 'yes' } } })).toBeNull();
    disposeSim(s);
  });

  it('스냅샷: 따라오는 중에 찍어 이어 돌려도 같은 해시', () => {
    const a = createSim(ZONE2, 4);
    start(a);
    put(a, 8, -40);
    run(a, 90);
    const b = restoreSim(ZONE2, 4, 'human', takeSnapshot(a));
    expect(b.escort).toEqual(a.escort);
    for (let i = 0; i < 120; i++) {
      stepSim(a, idle());
      stepSim(b, idle());
    }
    expect(hashSim(b)).toBe(hashSim(a));
    [a, b].forEach(disposeSim);
  });
});
