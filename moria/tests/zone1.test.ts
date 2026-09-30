import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { nearestInteractable, progressOf, restoreProgress } from '../src/sim/interact';
import { pathTo } from '../src/sim/nav';
import { BTN_INTERACT, BTN_WORD, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { ZONE1 } from '../src/sim/zone1';

/** 구역 1: 동선이 이어져 있는지, 문·화로가 규칙대로 동작하는지 (M2 수직 슬라이스) */

const fwd = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 127, yaw: 0 });
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (sim: Sim, f: InputFrame, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSim(sim, f);
};
const pos = (sim: Sim) => sim.player.body.translation();
const teleport = (sim: Sim, x: number, y: number, z: number) => sim.player.body.setTranslation({ x, y, z }, true);

let sim: Sim;
beforeAll(async () => {
  await RAPIER.init();
  sim = createSim(ZONE1, 7); // 내비메시 굽기가 가장 비싸다 → 읽기 전용 검사는 한 인스턴스로
}, 60_000);

describe('구역 1 동선', () => {
  it('서문 밖 → 트롤 굴까지 내비메시 경로가 이어진다 (계단 포함)', () => {
    const path = pathTo(sim.nav, [0, 0.2, 50], [0, 4.2, -40]);
    expect(path.length).toBeGreaterThan(0);
    const end = path[path.length - 1]!;
    expect(Math.hypot(end[0] - 0, end[2] + 40)).toBeLessThan(0.5);
  });

  it('거대 계단을 걸어 올라 기둥 홀에 닿는다', () => {
    const s = createSim(ZONE1, 1);
    teleport(s, 0, 1.2, 22);
    run(s, fwd(), 60 * 7);
    expect(pos(s).y).toBeGreaterThan(4.5);
    expect(pos(s).z).toBeLessThan(3);
    disposeSim(s);
  }, 60_000);
});

describe('두린의 문', () => {
  it('닫힌 문은 막고, 암호(BTN_WORD) 뒤에는 지나간다. 문이 닫힌 동안 디렉터는 쉰다', () => {
    const s = createSim(ZONE1, 2);
    run(s, fwd(), 60 * 6);
    expect(pos(s).z).toBeGreaterThan(40.4); // 문 앞에 막힘
    expect(s.director.phaseTick).toBe(0);
    expect(nearestInteractable(s)).toEqual({ kind: 'door', index: 0 });
    stepSim(s, fwd(BTN_WORD));
    expect(s.doors[0]!.open).toBe(true);
    expect(s.events.some((e) => e.type === 'door')).toBe(true);
    run(s, fwd(), 60 * 2);
    expect(pos(s).z).toBeLessThan(38);
    expect(s.director.phaseTick).toBeGreaterThan(0);
    disposeSim(s);
  }, 60_000);

  it('문에서 멀면 암호가 무시된다', () => {
    const s = createSim(ZONE1, 3);
    run(s, idle(), 10);
    stepSim(s, idle(BTN_WORD)); // 스폰 z=50, 문까지 10m
    expect(s.doors[0]!.open).toBe(false);
    disposeSim(s);
  }, 60_000);
});

describe('화로', () => {
  it('E로 밝히고 쉬면 체력·예비 횃불이 차고 체크포인트가 된다', () => {
    const s = createSim(ZONE1, 4);
    teleport(s, -5, 1.2, 33.5); // 화로 0 (−5, 0, 32)의 1.5m 앞
    run(s, idle(), 20);
    s.player.hp = 10;
    s.player.spareTorches = 0;
    stepSim(s, idle(BTN_INTERACT));
    expect(s.braziers[0]!.lit).toBe(true);
    expect(s.checkpoint).toBe(0);
    expect(s.player.hp).toBe(s.player.maxHp);
    expect(s.player.spareTorches).toBe(2);
    expect(s.events.find((e) => e.type === 'rest')).toMatchObject({ brazier: 0, first: true });
    disposeSim(s);
  }, 60_000);

  it('진행 상태 저장 → 새 시뮬레이션에 복원하면 문·화로·위치가 같다', () => {
    const a = createSim(ZONE1, 5);
    teleport(a, -5, 1.2, 33.5);
    run(a, idle(), 20);
    stepSim(a, idle(BTN_INTERACT));
    a.doors[0]!.open = true; // 문은 스텝 없이 상태만 (복원 경로 검사)
    const pr = progressOf(a);
    expect(pr).toEqual({ doorsOpen: [0], lit: [0], checkpoint: 0, bossesDown: [] });
    const b = createSim(ZONE1, 5);
    restoreProgress(b, pr);
    expect(b.doors[0]!.open && b.doors[0]!.body === null).toBe(true);
    expect(b.braziers[0]!.lit).toBe(true);
    expect(pos(b)).toMatchObject({ x: -5, z: 33.5 });
    // 잘못된 번호는 무시 (오래된·손상된 저장)
    const c = createSim(ZONE1, 5);
    restoreProgress(c, { doorsOpen: [9], lit: [-1, 99], checkpoint: 42, bossesDown: [7] });
    expect(c.checkpoint).toBe(-1);
    [a, b, c].forEach(disposeSim);
  }, 60_000);
});

describe('구역 1 결정성', () => {
  it('같은 입력 → 같은 해시 (문 열기·화로 포함)', () => {
    const play = () => {
      const s = createSim(ZONE1, 11);
      run(s, fwd(), 60 * 4);
      stepSim(s, fwd(BTN_WORD));
      run(s, fwd(), 60 * 3);
      const h = hashSim(s);
      disposeSim(s);
      return h;
    };
    expect(play()).toBe(play());
  }, 120_000);
});
