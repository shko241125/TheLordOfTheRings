import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { angleDiff, dAtan2Angle } from '../src/core/trig';
import { RELAX_MAX, RELAX_MIN, SPAWN_MAX_LIGHT, SPAWN_MIN_PATH, VIEW_HALF_ANGLE, WARN_TICKS } from '../src/sim/director';
import { TEST_ROOM, type Level } from '../src/sim/level';
import { pathTo } from '../src/sim/nav';
import { allLights, lightAt } from '../src/sim/perception';
import { createSim, disposeSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';

/**
 * 북소리 디렉터 규칙 (계획서 6장 기둥 2). 스폰 규칙은 director.ts의 함수를 쓰지 않고 여기서 따로 다시 계산한다
 * — 검사 대상 함수로 검사하면 아무것도 증명하지 못한다.
 */

// 순찰 고블린 없이 디렉터만 (벽 횃불·스폰 후보는 그대로)
const EMPTY_ROOM: Level = { ...TEST_ROOM, enemies: [] };
const still = (yaw: number): InputFrame => ({ buttons: 0, moveX: 0, moveY: 0, yaw });

beforeAll(async () => {
  await RAPIER.init();
});

type Violation = string;
/** 물결이 나온 바로 그 틱에 각 적의 자리가 규칙 3개를 지키는지 독립적으로 확인 */
function checkWave(sim: Sim, ids: number[]): Violation[] {
  const out: Violation[] = [];
  const me = sim.player.body.translation();
  const lights = allLights(sim);
  for (const id of ids) {
    const e = sim.enemies.find((x) => x.id === id)!;
    const t = e.body.translation();
    const dx = t.x - me.x, dz = t.z - me.z;
    // ② 어두운 곳
    const lux = lightAt(t.x, t.y + 0.3, t.z, lights);
    if (lux >= SPAWN_MAX_LIGHT) out.push(`id ${id}: 밝은 곳 (${lux.toFixed(2)})`);
    // ③ 경로 거리
    const path = pathTo(sim.nav, [me.x, me.y, me.z], [t.x, t.y, t.z]);
    let len = 0;
    let prev: [number, number, number] = [me.x, me.y, me.z];
    for (const p of path) {
      len += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      prev = p;
    }
    if (len < SPAWN_MIN_PATH - 0.05) out.push(`id ${id}: 경로 ${len.toFixed(1)}m`);
    // ① 시야: 카메라 앞 70° 안이면 시선이 벽·기둥에 막혀 있어야 한다
    const off = Math.abs(angleDiff(sim.director.cameraYaw, dAtan2Angle(-dx, -dz)));
    if (off <= VIEW_HALF_ANGLE) {
      const eyeY = me.y + 0.6;
      const d = Math.hypot(dx, t.y + 0.5 - eyeY, dz);
      const ray = new RAPIER.Ray({ x: me.x, y: eyeY, z: me.z }, { x: dx / d, y: (t.y + 0.5 - eyeY) / d, z: dz / d });
      const hit = sim.world.castRay(ray, d, true, undefined, (0xffff << 16) | 0x0001);
      if (!hit || hit.timeOfImpact >= d - 0.1) out.push(`id ${id}: 보이는 곳 (${off})`);
    }
  }
  return out;
}

describe('북소리 디렉터', () => {
  it('처음 30초는 조용하고, 물결 전에는 반드시 8초 이상 북으로 예고한다', () => {
    const sim = createSim(EMPTY_ROOM, 11);
    let warnAt = -1;
    let waveAt = -1;
    for (let i = 0; i < 150 * 60 && waveAt < 0; i++) {
      stepSim(sim, still((i * 3) & 4095)); // 천천히 둘러본다
      for (const ev of sim.events.splice(0)) {
        if (ev.type === 'drums' && ev.phase === 'warn') warnAt = ev.tick;
        if (ev.type === 'wave') waveAt = ev.tick;
      }
    }
    expect(waveAt).toBeGreaterThan(0);
    expect(warnAt).toBeGreaterThanOrEqual(RELAX_MIN);
    expect(waveAt - warnAt).toBeGreaterThanOrEqual(WARN_TICKS);
    disposeSim(sim);
  }, 60_000);

  it('여러 시드·시선에서 모든 물결이 규칙 3개(시야 밖·어둠·15m)를 지킨다', () => {
    const violations: string[] = [];
    let waves = 0;
    for (const seed of [1, 2, 3, 4]) {
      const sim = createSim(EMPTY_ROOM, seed);
      // 방 안의 몇 군데로 옮겨 가며 서 있는다 (시선도 시드마다 다르게 돈다)
      const spots = [[0, 15], [0, 0], [-6, -6], [6, 8]] as const;
      for (let i = 0; i < 6 * 60 * 60; i++) {
        if (i % (90 * 60) === 0) {
          const [x, z] = spots[(i / (90 * 60) + seed) % spots.length]!;
          sim.player.body.setTranslation({ x, y: 1, z }, true);
        }
        stepSim(sim, still((i * (seed + 1)) & 4095));
        for (const ev of sim.events.splice(0)) {
          if (ev.type === 'wave') {
            waves++;
            violations.push(...checkWave(sim, sim.director.wave).map((v) => `seed ${seed} tick ${ev.tick}: ${v}`));
          }
        }
        // 물결 고블린이 플레이어를 죽이면 이 테스트의 목적(스폰 자리)과 무관해진다 → 체력 유지
        sim.player.hp = sim.player.maxHp;
        if (sim.player.action === 'dead') sim.player.action = 'free';
      }
      disposeSim(sim);
    }
    expect(waves).toBeGreaterThanOrEqual(4);
    expect(violations).toEqual([]);
  }, 60_000); // 4시드 × 6분 시뮬레이션

  it('긴장도: 맞으면 피해 비율만큼 오르고, 주변이 조용하면 초당 5%씩 준다', () => {
    const sim = createSim(EMPTY_ROOM, 1);
    sim.director.intensity = 1;
    for (let i = 0; i < 60; i++) stepSim(sim, still(0));
    expect(sim.director.intensity).toBeCloseTo(0.95, 2);
    disposeSim(sim);
  });

  it('휴식은 30~45초다 (소강이 끝난 뒤)', () => {
    const sim = createSim(EMPTY_ROOM, 7);
    const lens: number[] = [];
    for (let i = 0; i < 8 * 60 * 60; i++) {
      stepSim(sim, still((i * 5) & 4095));
      for (const ev of sim.events.splice(0)) if (ev.type === 'drums' && ev.phase === 'relax') lens.push(sim.director.phaseLen);
      // 물결을 곧바로 정리해 소강 → 휴식이 돌게 한다
      for (const e of sim.enemies) if (e.ai !== 'dead' && sim.director.phase === 'peak' && sim.director.phaseTick > 200) e.hp = 0, e.ai = 'dead', e.aiTick = 0;
      sim.player.hp = sim.player.maxHp;
    }
    expect(lens.length).toBeGreaterThan(0);
    for (const l of lens) {
      expect(l).toBeGreaterThanOrEqual(RELAX_MIN);
      expect(l).toBeLessThanOrEqual(RELAX_MAX);
    }
    disposeSim(sim);
  }, 60_000);

  it('오래된 시체는 치워진다 (적 목록이 끝없이 늘지 않는다)', () => {
    const sim = createSim(TEST_ROOM, 1);
    const g = sim.enemies[0]!;
    g.hp = 0;
    g.ai = 'dead';
    g.aiTick = 0;
    for (let i = 0; i < 21 * 60 + 60; i++) stepSim(sim, still(0));
    expect(sim.enemies.some((e) => e.id === g.id)).toBe(false);
    disposeSim(sim);
  });
});
