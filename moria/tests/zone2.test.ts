import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { lightLamp, nearestInteractable, restoreProgress } from '../src/sim/interact';
import { pathTo } from '../src/sim/nav';
import { BTN_INTERACT, createSim, disposeSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { ZONE1 } from '../src/sim/zone1';
import { ZONE2 } from '../src/sim/zone2';

/** 구역 2 (21번째 홀): 동선, 등불 셋 → 북문, 출구 조건, 구역 1 북쪽 출구(트롤) */
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const fwd: InputFrame = { buttons: 0, moveX: 0, moveY: 127, yaw: 0 };
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);

beforeAll(async () => {
  await RAPIER.init();
});

describe('구역 2 — 21번째 홀', () => {
  it('입구에서 등불 셋과 북문 앞까지 경로가 이어진다', () => {
    const s = createSim(ZONE2, 1);
    for (const to of [[-19, 0, -27], [19, 0, -27], [0, 0, -51], [0, 0, -58]] as const) {
      const p = pathTo(s.nav, [0, 0.2, 14], to);
      expect(p.length, JSON.stringify(to)).toBeGreaterThan(0);
      const e = p[p.length - 1]!;
      expect(Math.hypot(e[0] - to[0], e[2] - to[2])).toBeLessThan(0.6);
    }
    disposeSim(s);
  });

  it('등불 셋을 밝히면 북문이 열리고, 북쪽 출구는 등불 셋 + 대장 처치가 있어야 열린다', () => {
    const s = createSim(ZONE2, 2);
    run(s, idle(), 10);
    expect(s.doors[0]!.open).toBe(false);
    // 북문 너머로 옮겨 놓고 출구에 들어서도 잠김 (등불 조건)
    put(s, 0, 1.2, -76);
    run(s, idle(), 3);
    expect(s.events.some((e) => e.type === 'exitLocked')).toBe(true);
    expect(s.exited).toBe(false);
    // 등불 앞에서 E
    for (const [i, l] of s.lamps.entries()) {
      put(s, l.x, 1.2, l.z + 1.8);
      run(s, idle(), 5);
      expect(nearestInteractable(s)).toEqual({ kind: 'lamp', index: i });
      stepSim(s, idle(BTN_INTERACT));
      run(s, idle(), 2);
      expect(l.lit).toBe(true);
    }
    expect(s.doors[0]!.open).toBe(true);
    expect(s.events.some((e) => e.type === 'lamp' && e.allLit)).toBe(true);
    // 등불만으로는 부족하다 — 대장이 살아 있다
    s.exitLockedShown = false;
    s.events.length = 0;
    put(s, 0, 1.2, -76);
    run(s, idle(), 3);
    expect(s.exited).toBe(false);
    const cap = s.enemies.find((e) => e.kind === 'captain')!;
    cap.hp = 0;
    cap.ai = 'dead';
    run(s, idle(), 3);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone3', entry: 'south' });
    disposeSim(s);
  });

  it('남쪽 출구 → 구역 1 북쪽 입구', () => {
    const s = createSim(ZONE2, 3);
    run(s, { buttons: 0, moveX: 0, moveY: 127, yaw: 2048 }, 60 * 2); // 남쪽(+Z)으로 걷는다
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone1', entry: 'north' });
    disposeSim(s);
  });

  it('진행 복원: 등불 둘은 조용히 켜지고(문은 닫힘), 셋이면 문이 열린다. 입구로 들어오면 입구에 선다', () => {
    const a = createSim(ZONE2, 4);
    restoreProgress(a, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [0, 1] }, 'south');
    expect(a.lamps.map((l) => l.lit)).toEqual([true, true, false]);
    expect(a.doors[0]!.open).toBe(false);
    expect(a.player.body.translation()).toMatchObject({ x: 0, z: 14 });
    lightLamp(a, 2);
    expect(a.doors[0]!.open).toBe(true);
    disposeSim(a);
  });
});

describe('구역 1 북쪽 출구', () => {
  it('트롤이 살아 있으면 잠겨 있고, 쓰러뜨리면 구역 2로 간다', () => {
    const s = createSim(ZONE1, 5);
    s.doors[0]!.open = true;
    put(s, 0, 5.2, -60);
    run(s, fwd, 60 * 2);
    expect(s.events.some((e) => e.type === 'exitLocked')).toBe(true);
    expect(s.exited).toBe(false);
    const troll = s.enemies.find((e) => e.kind === 'troll')!;
    troll.hp = 0;
    troll.ai = 'dead';
    put(s, 0, 5.2, -60);
    run(s, fwd, 60 * 2);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone2', entry: 'south' });
    disposeSim(s);
  });

  it('구역 2에서 돌아오면 북쪽 통로에 남쪽을 보고 선다', () => {
    const s = createSim(ZONE1, 6);
    restoreProgress(s, { doorsOpen: [0], lit: [], checkpoint: -1, bossesDown: [0], lampsLit: [] }, 'north');
    expect(s.player.body.translation()).toMatchObject({ x: 0, z: -60 });
    expect(s.player.facing).toBe(2048);
    disposeSim(s);
  });
});
