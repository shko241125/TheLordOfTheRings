import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { REAL_CAP, killHordeIn, spawnHorde, updateField } from '../src/sim/horde';
import type { Level } from '../src/sim/level';
import { ZONE1 } from '../src/sim/zone1';
import { allLights, lightAt } from '../src/sim/perception';
import { BTN_LIGHT, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';

/** 고블린 물결 (계획서 6장 B): 흐름장 추종·빛의 경계·어둠 속 승격·상한·결정성·틱 예산 */

// 60×60 바닥 + 가운데를 가르는 벽(구멍 하나) → 흐름장이 벽을 돌아가야 한다
const ARENA: Level = {
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' },
    { kind: 'box', pos: [-8, 2, -6], half: [22, 2, 0.5], surface: 'wall' }, // x ∈ [−30, 14], 구멍은 x ∈ [14, 30]
  ],
  torches: [],
  spawn: [0, 1.2, 10],
  horde: { size: 60 },
};

const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (sim: Sim, f: InputFrame, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSim(sim, f);
};
const dark = (sim: Sim) => {
  sim.torches.length = 0;
  sim.player.heldTorch = -1;
  sim.player.spareTorches = 0;
};
const minDist = (sim: Sim) => {
  const p = sim.player.body.translation();
  return Math.min(...sim.horde!.agents.map((a) => Math.hypot(a.x - p.x, a.z - p.z)));
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('고블린 물결', () => {
  it('흐름장은 벽을 돌아간다: 벽 너머 칸의 비용이 직선 거리보다 크다', () => {
    const sim = createSim(ARENA, 1);
    const f = sim.horde!.field;
    updateField(f, 0, 10);
    const at = (x: number, z: number) => f.dist[Math.floor(z - f.minZ) * f.w + Math.floor(x - f.minX)]!;
    // 직선이면 30m = 300. 벽 구멍(x ≈ 15)을 돌아가면 ≈ 14.5·14 + 14·14 ≈ 420
    expect(at(0, -20)).toBeGreaterThan(380);
    expect(at(0, 0)).toBeLessThan(120);
    disposeSim(sim);
  });

  it('구역 1 격자 높이는 바닥이다 (천장 지붕 윗면이 아니라) — 입구 홀 0m, 계단 중간, 기둥 홀·트롤 굴 4m', () => {
    const sim = createSim(ZONE1, 9);
    const f = sim.horde!.field;
    const hAt = (x: number, z: number) => f.height[Math.floor(z - f.minZ) * f.w + Math.floor(x - f.minX)]!;
    expect(hAt(0.5, 30.5)).toBeCloseTo(0, 0);
    expect(hAt(0.5, -10.5)).toBeCloseTo(4, 0);
    expect(hAt(0.5, -40.5)).toBeCloseTo(4, 0);
    const mid = hAt(0.5, 15.5); // 계단 (z 20 → 11 에서 0 → 4m)
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(3.5);
    disposeSim(sim);
  });

  it('어둠 속에서는 다가와 가까운 순서로 진짜 고블린이 된다 (상한 24)', () => {
    const sim = createSim(ARENA, 2);
    dark(sim);
    run(sim, idle(), 30);
    expect(spawnHorde(sim, [20, 0, -20], 60)).toBe(60);
    const real0 = sim.enemies.length;
    run(sim, idle(), 60 * 12);
    const real = sim.enemies.filter((e) => e.ai !== 'dead').length;
    expect(real).toBeGreaterThan(real0);
    expect(real).toBeLessThanOrEqual(REAL_CAP);
    expect(sim.enemies.every((e) => e.fromHorde)).toBe(true);
    expect(real + sim.horde!.agents.length).toBe(60); // 사라지거나 불어나지 않는다
    disposeSim(sim);
  }, 60_000);

  it('횃불을 든 플레이어 둘레 밝은 곳(lightAt > 0.5, 횃불에서 ≈ 5.7m)으로는 무리가 들어오지 않는다', () => {
    const sim = createSim(ARENA, 3);
    run(sim, idle(), 30);
    spawnHorde(sim, [20, 0, -20], 60);
    for (let i = 0; i < 12 * 60; i++) {
      stepSim(sim, idle());
      // 분리 조향에 밀려 경계를 살짝 넘을 수 있다 → 0.6까지 허용 (빛 중심은 몸이 아니라 왼손의 횃불)
      const lights = allLights(sim);
      for (const a of sim.horde!.agents) expect(lightAt(a.x, a.y + 0.8, a.z, lights)).toBeLessThan(0.6);
    }
    expect(minDist(sim)).toBeLessThan(9); // 실제로 경계까지 몰려왔다
    disposeSim(sim);
  }, 60_000);

  it('칼에 닿은 무리는 쓰러지고, 원 안의 무리는 한꺼번에 없앨 수 있다', () => {
    const sim = createSim(ARENA, 4);
    dark(sim);
    run(sim, idle(), 20);
    const p = sim.player.body.translation();
    sim.horde!.agents.push({ id: 900, x: p.x, y: 0, z: p.z - 1.2, vx: 0, vz: 0, facing: 0 });
    stepSim(sim, idle(BTN_LIGHT));
    run(sim, idle(), 20);
    expect(sim.horde!.agents.some((a) => a.id === 900)).toBe(false);
    spawnHorde(sim, [-20, 0, -20], 30);
    expect(killHordeIn(sim, -20, -20, 50)).toBe(30);
    disposeSim(sim);
  });

  it('결정적: 같은 입력이면 같은 해시', () => {
    const play = () => {
      const sim = createSim(ARENA, 5);
      dark(sim);
      spawnHorde(sim, [20, 0, -20], 60);
      run(sim, idle(), 600);
      const h = hashSim(sim);
      disposeSim(sim);
      return h;
    };
    expect(play()).toBe(play());
  }, 60_000);

  it('틱 예산: 무리 200 + 진짜 24에서 평균 틱 시간 (계획서 기준 ≤ 4ms)', () => {
    const sim = createSim({ ...ARENA, horde: { size: 200 } }, 6);
    dark(sim);
    spawnHorde(sim, [20, 0, -20], 200);
    run(sim, idle(), 60 * 8); // 진짜 고블린이 상한까지 차고 무리가 밀려든 상태
    const t0 = performance.now();
    run(sim, idle(), 300);
    const ms = (performance.now() - t0) / 300;
    console.log(`horde tick ${ms.toFixed(2)}ms, agents ${sim.horde!.agents.length}, real ${sim.enemies.length}`);
    expect(ms).toBeLessThan(8); // 느린 CI 여유 2배. 실측값은 로그로 남긴다
    disposeSim(sim);
  }, 120_000);

  it('구역 1: 디렉터 절정이 굴 입구에서 무리 40마리를 쏟아낸다 (진짜 고블린 3 + 무리 40)', () => {
    const sim = createSim(ZONE1, 10);
    sim.doors[0]!.open = true;
    sim.player.body.setTranslation({ x: 0, y: 1.2, z: 30 }, true); // 입구 홀 — 기둥 홀 굴 입구들이 15m 넘게 떨어져 있다
    run(sim, idle(), 20);
    sim.director.phase = 'warn';
    sim.director.phaseTick = 60 * 8 - 1;
    const wave = sim.events.length;
    run(sim, idle(), 90);
    expect(sim.director.phase).toBe('peak');
    const ev = sim.events.slice(wave).find((e) => e.type === 'wave');
    expect(ev).toMatchObject({ count: 43 });
    expect(sim.horde!.agents.length + sim.enemies.filter((e) => e.fromHorde).length).toBe(40);
    disposeSim(sim);
  }, 60_000);
});
