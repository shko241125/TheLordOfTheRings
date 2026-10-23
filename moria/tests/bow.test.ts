import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { bowDamage } from '../src/sim/combat';
import { createEnemy } from '../src/sim/enemy';
import type { Level } from '../src/sim/level';
import { BTN_HEAVY, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE1 } from '../src/sim/zone1';

/** 엘프의 활 (계획서 5장 '장궁, 집중'): 강공격 버튼을 누르고 있으면 당기고, 떼면 화살이 날아가 적·금 간 기둥을 맞힌다 */

const FLAT: Level = { solids: [{ kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' }], torches: [], spawn: [0, 1.2, 0] };
const idle = (buttons = 0, yaw = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
/** 플레이어 앞(−Z) d m에 체력 많은 고블린 */
function goblinAhead(s: Sim, d: number) {
  const t = s.player.body.translation();
  const g = createEnemy(s, s.nextEnemyId++, [t.x, t.y, t.z - d], [[t.x, t.y, t.z - d]]);
  g.hp = 1000;
  s.enemies.push(g);
  return g;
}
/** 강공격 버튼을 hold틱 누르고 뗀 뒤 after틱 */
function drawAndLoose(s: Sim, hold: number, after: number, yaw = 0) {
  run(s, idle(BTN_HEAVY, yaw), hold);
  run(s, idle(0, yaw), after);
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('엘프의 활', () => {
  it('8m 앞 고블린을 맞힌다 — 화살은 하나, 플레이어는 다치지 않는다', () => {
    const s = createSim(FLAT, 3, 'elf');
    run(s, idle(), 10);
    const g = goblinAhead(s, 8);
    const hp = s.player.hp;
    drawAndLoose(s, 30, 40);
    expect(1000 - g.hp).toBeGreaterThan(0);
    expect(s.events.filter((e) => e.type === 'shoot' && e.enemy === -1)).toHaveLength(1);
    expect(s.events.some((e) => e.type === 'hit' && e.target === g.id)).toBe(true);
    expect(s.player.hp).toBe(hp);
    expect(s.arrows).toHaveLength(0);
    disposeSim(s);
  });

  it('오래 당길수록 세다 (최대에서 멈추고, 떼기 전까지는 쏘지 않는다)', () => {
    const dealt = (hold: number) => {
      const s = createSim(FLAT, 3, 'elf');
      run(s, idle(), 10);
      const g = goblinAhead(s, 8);
      run(s, idle(BTN_HEAVY), hold);
      const before = s.arrows.length;
      run(s, idle(), 40);
      const d = 1000 - g.hp;
      disposeSim(s);
      return { d, before };
    };
    const short = dealt(12), full = dealt(120);
    expect(full.before).toBe(0); // 2초를 당기고 있어도 아직 안 쐈다
    expect(full.d).toBeGreaterThan(short.d);
    expect(bowDamage(45)).toBeGreaterThan(bowDamage(10));
  });

  it('카메라 방향(yaw)으로 쏜다 — 뒤의 적은 맞지 않는다', () => {
    const s = createSim(FLAT, 3, 'elf');
    run(s, idle(), 10);
    const g = goblinAhead(s, 8);
    drawAndLoose(s, 30, 40, 2048); // 반 바퀴 = +Z 쪽
    expect(g.hp).toBe(1000);
    disposeSim(s);
  });

  it('사람은 그대로 칼 강공격이다 (화살 없음)', () => {
    const s = createSim(FLAT, 3, 'human');
    run(s, idle(), 10);
    goblinAhead(s, 8);
    drawAndLoose(s, 30, 40);
    expect(s.nextArrowId).toBe(0);
    disposeSim(s);
  });

  it('금 간 기둥을 화살로 쏘면 금이 간다', () => {
    const s = createSim(ZONE1, 1, 'elf');
    s.doors[0]!.open = true;
    s.player.body.setTranslation({ x: -14.7, y: 5.2, z: -2 }, true); // 기둥(−14.7, −8.2)에서 6m, −Z를 봄
    run(s, idle(), 20);
    const hp0 = s.collapses[0]!.hp;
    drawAndLoose(s, 30, 40);
    expect(s.collapses[0]!.hp).toBeLessThan(hp0);
    disposeSim(s);
  });

  it('날아가는 화살도 스냅샷에 담긴다 (복원 뒤 같은 해시, 같은 결과)', () => {
    const s = createSim(FLAT, 3, 'elf');
    run(s, idle(), 10);
    goblinAhead(s, 12);
    run(s, idle(BTN_HEAVY), 30);
    run(s, idle(), 6);
    expect(s.arrows.length).toBe(1);
    const b = restoreSim(FLAT, 3, 'elf', takeSnapshot(s));
    expect(hashSim(b)).toBe(hashSim(s));
    run(s, idle(), 40);
    run(b, idle(), 40);
    expect(hashSim(b)).toBe(hashSim(s));
    [s, b].forEach(disposeSim);
  });
});
