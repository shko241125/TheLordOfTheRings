import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { ARROW_DAMAGE, DRAW_TICKS } from '../src/sim/archer';
import { CAPTAIN_HP, CHARGE_WINDUP } from '../src/sim/captain';
import { damageEnemy } from '../src/sim/enemy';
import type { Level } from '../src/sim/level';
import { BTN_PARRY, createSim, disposeSim, hashSim, stepSim, type Enemy, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';

/** 구역 2의 적: 고블린 궁수(예고·엄폐·거리 두기·동시 사수 2)와 고블린 대장(연타 패링·돌진·벽 충돌·휘파람) */
const ARENA = (extra: Partial<Level> = {}): Level => ({
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' },
    { kind: 'box', pos: [0, 2, -20.5], half: [30, 2, 0.5], surface: 'wall' }, // 북쪽 벽 z = −20
  ],
  torches: [[0, 2.6, 0]],
  spawn: [0, 1.2, 8],
  spawnPoints: [[-20, 1, 15], [20, 1, 15]],
  horde: { size: 30 },
  ...extra,
});
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
const foe = (s: Sim, kind: string): Enemy => s.enemies.find((e) => e.kind === kind)!;
const put = (b: { setTranslation(v: { x: number; y: number; z: number }, w: boolean): void }, x: number, y: number, z: number) => b.setTranslation({ x, y, z }, true);

beforeAll(async () => {
  await RAPIER.init();
});

describe('고블린 궁수', () => {
  const level = (pillar = false) =>
    ARENA({
      enemies: [{ kind: 'archer', pos: [0, 1, -2], patrol: [[0, 1, -2]] }],
      solids: [...ARENA().solids, ...(pillar ? [{ kind: 'cylinder' as const, pos: [0, 3, 3] as const, radius: 1, halfHeight: 3, surface: 'stone' as const }] : [])],
    });

  it('0.8초 활을 당긴 뒤 쏘고, 서 있으면 맞는다 (패링 불가)', () => {
    const s = createSim(level(), 1);
    const a = foe(s, 'archer');
    a.ai = 'engage';
    a.awareness = 1;
    run(s, idle(), 10);
    expect(a.ai).toBe('attack');
    const hp0 = s.player.hp;
    run(s, idle(BTN_PARRY), DRAW_TICKS - 12); // 막기를 들고 있어도
    expect(s.arrows.length).toBe(0); // 예고 동안에는 쏘지 않았다
    run(s, idle(BTN_PARRY), 50);
    expect(s.player.hp).toBe(hp0 - ARROW_DAMAGE);
    disposeSim(s);
  });

  it('사이에 기둥이 있으면 화살이 박힌다', () => {
    const s = createSim(level(true), 2);
    const a = foe(s, 'archer');
    // 기둥이 시야를 가리면 쏘러 오지 않으므로 직접 활을 당기게 한다
    a.ai = 'attack';
    a.move = 'shoot';
    a.swingTick = 0;
    const hp0 = s.player.hp;
    run(s, idle(), DRAW_TICKS + 60);
    expect(s.player.hp).toBe(hp0);
    disposeSim(s);
  });

  it('5m 안으로 붙으면 물러난다', () => {
    const s = createSim(level(), 3);
    const a = foe(s, 'archer');
    a.ai = 'engage';
    put(s.player.body, 0, 1.2, 1);
    run(s, idle(), 5);
    const d0 = Math.abs(a.body.translation().z - 1);
    run(s, idle(), 60);
    expect(Math.abs(a.body.translation().z - 1)).toBeGreaterThan(d0 + 1);
    disposeSim(s);
  });

  it('궁수 넷이 있어도 동시에 활을 당기는 것은 둘', () => {
    const s = createSim(ARENA({ enemies: [-6, -2, 2, 6].map((x) => ({ kind: 'archer' as const, pos: [x, 1, -3] as const, patrol: [[x, 1, -3] as const] })) }), 4);
    for (const e of s.enemies) {
      e.ai = 'engage';
      e.awareness = 1;
    }
    let most = 0;
    for (let i = 0; i < 300; i++) {
      stepSim(s, idle());
      most = Math.max(most, s.enemies.filter((e) => e.ai === 'attack').length);
    }
    expect(most).toBe(2);
    disposeSim(s);
  });
});

describe('고블린 대장', () => {
  const level = () => ARENA({ bosses: [{ kind: 'captain', pos: [0, 1.4, 0] }] });

  it('연타 첫 타를 패링하면 연타가 끊기고 휘청인다', () => {
    const s = createSim(level(), 5);
    const c = foe(s, 'captain');
    put(s.player.body, 0, 1.2, -1.8);
    s.player.facing = 2048; // 대장(+Z)을 본다
    run(s, idle(), 10);
    c.ai = 'attack';
    c.move = 'combo';
    c.step = 0;
    c.swingTick = 0;
    c.facing = 0;
    run(s, idle(), 18);
    stepSim(s, idle(BTN_PARRY)); // 첫 타 판정(22틱) 직전에 막기
    run(s, idle(BTN_PARRY), 10);
    expect(c.ai).toBe('stagger');
    expect(s.player.hp).toBe(s.player.maxHp);
    disposeSim(s);
  });

  it('돌진: 예고 동안은 안 맞고, 선 위에 서 있으면 26 (패링 불가), 옆으로 비키면 빗나간다', () => {
    const captainZ: number[] = [];
    const hitIf = (sidestep: boolean) => {
      const s = createSim(level(), 6);
      const c = foe(s, 'captain');
      put(s.player.body, 0, 1.2, 9);
      run(s, idle(), 10);
      c.facing = 2048;
      c.ai = 'attack';
      c.move = 'charge';
      c.swingTick = 0;
      c.hitSet.clear();
      run(s, idle(BTN_PARRY), CHARGE_WINDUP - 2);
      const mid = s.player.hp;
      if (sidestep) put(s.player.body, 3, 1.2, 9); // 방향이 고정된 뒤 옆으로
      run(s, idle(BTN_PARRY), 60); // 돌진 50틱(≈9m)이 플레이어(9m)에 닿을 만큼
      captainZ.push(c.body.translation().z);
      const lost = mid - s.player.hp;
      disposeSim(s);
      return { mid, lost };
    };
    const stay = hitIf(false);
    expect(stay.mid).toBe(100);
    expect(stay.lost, `대장 z ${captainZ}`).toBe(26);
    expect(hitIf(true).lost).toBe(0);
  });

  it('돌진하다 벽에 박히면 휘청인다', () => {
    const s = createSim(level(), 7);
    const c = foe(s, 'captain');
    put(c.body, 0, 1.4, -15); // 북쪽 벽(−20)을 향해
    put(s.player.body, 0, 1.2, 12);
    run(s, idle(), 10);
    c.ai = 'attack';
    c.move = 'charge';
    c.swingTick = CHARGE_WINDUP; // 이미 겨눈 뒤
    c.aimX = 0;
    c.aimZ = -1;
    c.facing = 0;
    run(s, idle(), 30);
    expect(c.ai).toBe('stagger');
    disposeSim(s);
  });

  it('체력이 절반이 되면 휘파람으로 무리를 부른다 (한 번)', () => {
    const s = createSim(level(), 8);
    const c = foe(s, 'captain');
    damageEnemy(s, c, CAPTAIN_HP / 2 - 1);
    expect(s.horde!.agents.length).toBe(0);
    damageEnemy(s, c, 1);
    expect(s.horde!.agents.length).toBe(24);
    damageEnemy(s, c, 10);
    expect(s.horde!.agents.length).toBe(24);
    expect(s.events.filter((e) => e.type === 'whistle').length).toBe(1);
    disposeSim(s);
  });

  it('스냅샷은 날아가는 화살과 대장 상태를 담는다', () => {
    const s = createSim(ARENA({ enemies: [{ kind: 'archer', pos: [0, 1, -2], patrol: [[0, 1, -2]] }], bosses: [{ kind: 'captain', pos: [6, 1.4, 0] }] }), 9);
    const a = foe(s, 'archer');
    a.ai = 'attack';
    a.move = 'shoot';
    a.swingTick = DRAW_TICKS - 1;
    run(s, idle(), 3);
    expect(s.arrows.length).toBe(1);
    const b = restoreSim(ARENA({ enemies: [{ kind: 'archer', pos: [0, 1, -2], patrol: [[0, 1, -2]] }], bosses: [{ kind: 'captain', pos: [6, 1.4, 0] }] }), 9, 'human', takeSnapshot(s));
    for (let i = 0; i < 30; i++) {
      stepSim(s, idle());
      stepSim(b, idle());
    }
    expect(hashSim(b)).toBe(hashSim(s));
    [s, b].forEach(disposeSim);
  });
});
