import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { damageEnemy } from '../src/sim/enemy';
import { nearestInteractable, progressOf, restoreProgress } from '../src/sim/interact';
import { pathTo } from '../src/sim/nav';
import { allLights, lightAt } from '../src/sim/perception';
import { BTN_TORCH, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE3 } from '../src/sim/zone3';
import { ZONE4 } from '../src/sim/zone4';

/** 구역 4 (대장간과 깊은 탄갱): 용암 강, 발판 셋 퍼즐 → 모루 → 쇠문, 출구 조건, 저장·스냅샷 */
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);
/** 적을 모두 치운다 (퍼즐만 본다) */
const calm = (s: Sim) => {
  for (const e of s.enemies) if (!s.bosses.includes(e.id)) damageEnemy(s, e, 1e6);
};
/** 발판 위에 서서 F: 들고 있으면 내려놓고, 빈손이면 예비 횃불을 켜서 내려놓는다 */
const dropTorchAt = (s: Sim, x: number, z: number) => {
  put(s, x, 1.2, z + 0.4); // 발 앞 0.5m(북쪽)에 놓인다 → 발판 가운데 근처
  run(s, idle(), 3);
  if (s.player.heldTorch < 0) {
    stepSim(s, idle(BTN_TORCH));
    run(s, idle(), 2);
  }
  stepSim(s, idle(BTN_TORCH));
  run(s, idle(), 2);
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('구역 4 — 대장간', () => {
  it('입구에서 두 다리를 건너 발판 셋·모루 앞·쇠문 앞까지 이어지고, 용암 바닥으로 가는 길은 없다', () => {
    const s = createSim(ZONE4, 1);
    for (const to of [...ZONE4.forge!.plates, [0, 0, -27], [0, 0, -38.5], [-16, 0, -3], [16, 0, -37]] as const) {
      const p = pathTo(s.nav, [0, 0.2, 10], [to[0], to[1], to[2]]);
      expect(p.length, JSON.stringify(to)).toBeGreaterThan(0);
      const e = p[p.length - 1]!;
      expect(Math.hypot(e[0] - to[0], e[2] - to[2]), JSON.stringify(to)).toBeLessThan(0.6);
    }
    // 다리 사이 용암 바닥(−3)은 닿을 수 없다: 경로 끝이 용암 바닥이 아니다
    const pit = pathTo(s.nav, [0, 0.2, 10], [0, -3, -19]);
    if (pit.length) expect(pit[pit.length - 1]![1]).toBeGreaterThan(-1);
    disposeSim(s);
  });

  it('용암에 빠지면 쓰러진다 (적도 탄다). 다리 위는 용암빛으로 밝다', () => {
    const s = createSim(ZONE4, 2);
    calm(s);
    put(s, 0, -1.8, -19);
    run(s, idle(), 30);
    expect(s.player.action).toBe('dead');
    expect(s.events.find((e) => e.type === 'playerHit')).toMatchObject({ source: 'lava' });
    const t = createSim(ZONE4, 3);
    const u = t.enemies.find((e) => e.kind === 'uruk')!;
    u.body.setTranslation({ x: 0, y: -1.5, z: -19 }, true);
    run(t, idle(), 3);
    expect(u.ai).toBe('dead');
    expect(lightAt(8, 1.3, -19, allLights(t))).toBeGreaterThan(0.4);
    expect(lightAt(0, 1.3, -6, allLights(t))).toBeLessThan(0.2);
    [s, t].forEach(disposeSim);
  });

  it('발판 둘로는 안 된다. 횃불 둘을 내려놓고 셋째 발판에 서면 모루가 타오르고 쇠문이 열린다', () => {
    const s = createSim(ZONE4, 4);
    calm(s);
    const [a, b, c] = ZONE4.forge!.plates;
    // 쇠문은 비문이 아니다
    put(s, 0, 1.2, -37.5);
    run(s, idle(), 2);
    expect(nearestInteractable(s)?.kind).not.toBe('door');
    dropTorchAt(s, a![0], a![2]);
    expect(s.forge.plates).toEqual([true, false, false]);
    dropTorchAt(s, b![0], b![2]);
    expect(s.forge.plates).toEqual([true, true, false]);
    expect(s.player.spareTorches).toBe(1);
    expect(s.forge.lit).toBe(false);
    expect(s.doors[0]!.open).toBe(false);
    put(s, c![0], 1.2, c![2]);
    run(s, idle(), 3);
    expect(s.forge.lit).toBe(true);
    expect(s.doors[0]!.open).toBe(true);
    expect(s.events.some((e) => e.type === 'forge')).toBe(true);
    // 한 번 지핀 모루는 꺼지지 않는다
    put(s, 0, 1.2, -26);
    run(s, idle(), 3);
    expect(s.forge.lit).toBe(true);
    disposeSim(s);
  });

  it('북쪽 출구는 모루 + 우루크 대장 처치가 있어야 열린다', () => {
    const s = createSim(ZONE4, 5);
    calm(s);
    restoreProgress(s, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [], forged: true }, null);
    expect(s.doors[0]!.open).toBe(true);
    put(s, 0, 1.2, -56.5);
    run(s, idle(), 3);
    expect(s.exited).toBe(false);
    expect(s.events.some((e) => e.type === 'exitLocked')).toBe(true);
    const boss = s.enemies.find((e) => e.id === s.bosses[0])!;
    expect(boss.kind).toBe('captain');
    damageEnemy(s, boss, 1e6);
    run(s, idle(), 2);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone5', entry: 'south' });
    expect(progressOf(s).forged).toBe(true);
    disposeSim(s);
  });

  it('스냅샷은 발판·모루 상태를 담는다', () => {
    const a = createSim(ZONE4, 6);
    calm(a);
    const [p] = ZONE4.forge!.plates;
    dropTorchAt(a, p![0], p![2]);
    const b = restoreSim(ZONE4, 6, 'human', takeSnapshot(a));
    expect(b.forge).toEqual(a.forge);
    for (let i = 0; i < 60; i++) {
      stepSim(a, idle());
      stepSim(b, idle());
    }
    expect(hashSim(b)).toBe(hashSim(a));
    [a, b].forEach(disposeSim);
  });

  it('구역 3 북쪽 출구 → 구역 4 남쪽 입구, 구역 4 남쪽 출구 → 구역 3 북쪽 입구', () => {
    const s = createSim(ZONE4, 7);
    run(s, { buttons: 0, moveX: 0, moveY: 127, yaw: 2048 }, 60);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone3', entry: 'north' });
    const z3 = createSim(ZONE3, 7);
    restoreProgress(z3, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [] }, 'north');
    expect(z3.player.body.translation()).toMatchObject({ z: -40 });
    [s, z3].forEach(disposeSim);
  });
});
