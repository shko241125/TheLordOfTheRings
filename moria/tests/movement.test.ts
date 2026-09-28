import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { angleDiff, ANGLE_STEPS, dAtan2Angle } from '../src/core/trig';
import { CLASS_STATS } from '../src/sim/classes';
import type { Level } from '../src/sim/level';
import { BTN_CROUCH, BTN_SPRINT, createSim, disposeSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';

/** 이동 느낌을 숫자로 고정한다 (계획서: 조작감은 튜닝 대상이지만, 퇴행은 테스트로 막는다) */

// 넓은 바닥 + z = −12 에 벽 하나
const FLAT: Level = {
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [40, 0.5, 40], surface: 'floor' },
    { kind: 'box', pos: [0, 2, -12.5], half: [40, 2, 0.5], surface: 'wall' },
  ],
  torches: [],
  spawn: [0, 1.0, 0],
};

const human = CLASS_STATS.human;
const fwd = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 127, yaw: 0 });
const back: InputFrame = { buttons: 0, moveX: 0, moveY: -127, yaw: 0 };
const idle: InputFrame = { buttons: 0, moveX: 0, moveY: 0, yaw: 0 };
const speed = (s: Sim) => Math.hypot(s.player.vx, s.player.vz);

function settle(): Sim {
  const sim = createSim(FLAT, 1);
  for (let i = 0; i < 20; i++) stepSim(sim, idle); // 착지
  return sim;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('결정적 atan2', () => {
  it('축 방향은 정확한 사분점', () => {
    // 앞 = (−sin a, −cos a): a=0 → −Z, a=1024 → −X, a=2048 → +Z, a=3072 → +X
    expect(dAtan2Angle(0, 1)).toBe(0);
    expect(dAtan2Angle(1, 0)).toBe(1024);
    expect(dAtan2Angle(0, -1)).toBe(2048);
    expect(dAtan2Angle(-1, 0)).toBe(3072);
    expect(dAtan2Angle(0, 0)).toBe(0);
  });

  it('Math.atan2와 반올림 오차(±1) 이내', () => {
    let seed = 7;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32) * 2 - 1;
    for (let i = 0; i < 5000; i++) {
      const y = rnd() * 100, x = rnd() * 100;
      const ref = Math.round((Math.atan2(y, x) / (Math.PI * 2)) * ANGLE_STEPS) & (ANGLE_STEPS - 1);
      expect(Math.abs(angleDiff(ref, dAtan2Angle(y, x)))).toBeLessThanOrEqual(1);
    }
  });
});

describe('이동 느낌', () => {
  it('가속: 한 틱에 최고속이 되지 않고, 0.4초 안에 조깅 속도에 도달', () => {
    const sim = settle();
    stepSim(sim, fwd());
    expect(speed(sim)).toBeLessThan(human.jogSpeed * 0.2);
    for (let i = 0; i < 24; i++) stepSim(sim, fwd());
    expect(speed(sim)).toBeGreaterThan(human.jogSpeed * 0.97);
    disposeSim(sim);
  });

  it('정지: 손을 떼면 0.25초 안에 멈춘다', () => {
    const sim = settle();
    for (let i = 0; i < 40; i++) stepSim(sim, fwd());
    for (let i = 0; i < 15; i++) stepSim(sim, idle);
    expect(speed(sim)).toBeLessThan(0.05);
    disposeSim(sim);
  });

  it('질주 > 조깅, 웅크리기 < 걷기', () => {
    const run = (b: number) => {
      const sim = settle();
      for (let i = 0; i < 60; i++) stepSim(sim, fwd(b));
      const v = speed(sim);
      disposeSim(sim);
      return v;
    };
    expect(run(BTN_SPRINT)).toBeCloseTo(human.sprintSpeed, 1);
    expect(run(0)).toBeCloseTo(human.jogSpeed, 1);
    expect(run(BTN_CROUCH)).toBeCloseTo(human.crouchSpeed, 1);
  });

  it('몸은 카메라가 아니라 이동 방향으로 돌고, 회전 속도 한도를 지킨다', () => {
    const sim = settle();
    const right: InputFrame = { buttons: 0, moveX: 127, moveY: 0, yaw: 0 };
    stepSim(sim, right);
    expect(Math.abs(angleDiff(0, sim.player.facing))).toBeLessThanOrEqual(human.turnRate);
    for (let i = 0; i < 12; i++) stepSim(sim, right);
    expect(sim.player.facing).toBe(3072); // +X
    disposeSim(sim);
  });

  it('반대 방향 급선회: 먼저 거의 멈췄다가(발 디딤) 돌아서 달린다', () => {
    const sim = settle();
    for (let i = 0; i < 40; i++) stepSim(sim, fwd());
    let minSpeed = Infinity;
    for (let i = 0; i < 30; i++) {
      stepSim(sim, back);
      minSpeed = Math.min(minSpeed, speed(sim));
    }
    expect(minSpeed).toBeLessThan(human.jogSpeed * 0.3);
    expect(sim.player.facing).toBe(2048);
    expect(sim.player.vz).toBeGreaterThan(human.jogSpeed * 0.9);
    disposeSim(sim);
  });

  it('벽에 대고 달리면 속도가 0에 가까워진다 (제자리 달리기 애니메이션 방지)', () => {
    const sim = settle();
    for (let i = 0; i < 240; i++) stepSim(sim, fwd());
    expect(sim.player.body.translation().z).toBeGreaterThan(-12);
    expect(speed(sim)).toBeLessThan(0.2);
    disposeSim(sim);
  });

  it('클래스마다 체격이 다르다 (드워프 캡슐이 가장 작다)', () => {
    const h = (c: keyof typeof CLASS_STATS) => 2 * (CLASS_STATS[c].capsuleHalf + CLASS_STATS[c].capsuleRadius);
    expect(h('dwarf')).toBeCloseTo(1.4, 1);
    expect(h('human')).toBeCloseTo(1.8, 1);
    expect(h('elf')).toBeCloseTo(1.88, 1);
  });
});

describe('지형 (M0 테스트 방)', () => {
  it('평지에서 달리는 동안 한 번도 멈칫하지 않는다 (KCC offset 파고듦 회귀 방지)', async () => {
    const sim = settle();
    let stalls = 0;
    for (let i = 0; i < 25; i++) stepSim(sim, fwd());
    const last = { z: sim.player.body.translation().z };
    for (let i = 0; i < 90; i++) {
      stepSim(sim, fwd());
      const z = sim.player.body.translation().z;
      if (Math.abs(z - last.z) < 0.03) stalls++;
      last.z = z;
    }
    expect(stalls).toBe(0);
    expect(sim.player.grounded).toBe(true);
    disposeSim(sim);
  });

  it('경사로·계단을 오르내리는 동안 접지를 유지한다', async () => {
    const { TEST_ROOM } = await import('../src/sim/level');
    for (const x of [-10, 10]) {
      const sim = createSim({ ...TEST_ROOM, spawn: [x, 1.0, 6.5] }, 1);
      for (let i = 0; i < 20; i++) stepSim(sim, idle);
      let air = 0, maxY = 0;
      // 윗단 끝(z≈−4.6/−8.2) 전까지만 올라간다
      for (let i = 0; i < 400 && sim.player.body.translation().z > (x > 0 ? -4.2 : -7.8); i++) {
        stepSim(sim, fwd());
        if (!sim.player.grounded) air++;
        maxY = Math.max(maxY, sim.player.body.translation().y);
      }
      expect(maxY).toBeGreaterThan(x > 0 ? 3.2 : 3.4); // 윗단 높이 + 캡슐 중심
      expect(air).toBeLessThan(6); // 계단 모서리 한두 틱 이내
      disposeSim(sim);
    }
  });
});
