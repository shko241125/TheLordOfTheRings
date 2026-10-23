import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import * as archer from '../src/sim/archer';
import { createEnemy } from '../src/sim/enemy';
import type { Level } from '../src/sim/level';
import { allLights } from '../src/sim/perception';
import { BTN_HEAVY, BTN_TORCH, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE2 } from '../src/sim/zone2';

/** K 불씨 화살: 횃불을 든 엘프의 화살은 불씨 화살 — 날며 빛나고, 박힌 자리에 10초 불씨를 남기고, 등불을 밝힌다 */

// 아직 타입에 없는 새 필드·상수는 느슨하게 읽는다 (구현 전에도 이 파일이 타입 검사를 통과하도록)
const { EMBER_TICKS, MAX_EMBERS } = archer as unknown as { EMBER_TICKS: number; MAX_EMBERS: number };
type Ember = { x: number; y: number; z: number; ttl: number };
type Arrow = { id: number; x: number; y: number; z: number; dmg?: number; dark?: number; ember?: boolean };
const embers = (s: Sim) => (s as unknown as { embers: Ember[] }).embers;
const arrows = (s: Sim) => s.arrows as unknown as Arrow[];
const newest = (s: Sim) => arrows(s).reduce((a, b) => (b.id > a.id ? b : a));

/** 평평한 바닥 + 플레이어(0, ·, 0) 앞 −Z 6m에 벽 (안쪽 면 z = −5.75) */
const WALLED: Level = {
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' },
    { kind: 'box', pos: [0, 2, -6], half: [5, 2, 0.25], surface: 'stone' },
  ],
  torches: [],
  spawn: [0, 1.2, 0],
};
/** 구역 2 지형·등불 그대로, 적·대장·무리만 뺐다 (활 쏘는 동안 방해받지 않게) */
const HALL: Level = { ...ZONE2, enemies: [], bosses: [], horde: undefined };

const idle = (buttons = 0, yaw = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
/** 강공격 버튼을 hold틱 누르고 뗀 뒤 after틱 */
function drawAndLoose(s: Sim, hold: number, after: number, yaw = 0) {
  run(s, idle(BTN_HEAVY, yaw), hold);
  run(s, idle(0, yaw), after);
}
/** F 짧게 한 번: 든 횃불을 내려놓는다 */
function dropTorch(s: Sim) {
  run(s, idle(BTN_TORCH), 1);
  run(s, idle(), 5);
  expect(s.player.heldTorch).toBe(-1);
}
/** (x, y, z)에 놓인 빛 (자리가 1cm 안으로 같은 것) */
const lightAt = (s: Sim, p: { x: number; y: number; z: number }) =>
  allLights(s).filter((l) => Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z) < 0.01);

beforeAll(async () => {
  await RAPIER.init();
});

describe('불씨 화살', () => {
  it('T1 횃불을 든 엘프는 불씨 화살을 쏘고(횃불은 그대로), 내려놓은 뒤에는 보통 화살이다 — 피해는 같다', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    expect(embers(s)).toEqual([]);
    const torch = s.player.heldTorch;
    expect(torch).toBeGreaterThanOrEqual(0);

    drawAndLoose(s, 20, 4);
    const a = newest(s);
    expect(a.ember).toBe(true);
    expect(typeof a.dmg).toBe('number');
    expect(s.player.heldTorch).toBe(torch); // 횃불을 쓰지 않는다

    run(s, idle(), 40); // 첫 화살이 벽에 박히도록
    dropTorch(s);
    drawAndLoose(s, 20, 4);
    const b = newest(s);
    expect(b.id).not.toBe(a.id);
    expect(b.ember).toBeUndefined();
    // 불씨라서 더 세지는 않다 (K6): 어둠 배율(dark)을 걷어 낸 기본 피해가 같다
    expect(Math.abs(a.dmg! / a.dark! - b.dmg! / b.dark!)).toBeLessThan(1);
    disposeSim(s);
  });

  it('T2 날아가는 불씨 화살은 빛이다 (세기 0.6, 반경 4m, 화살 자리)', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    drawAndLoose(s, 20, 4);
    const a = { ...newest(s) }; // sim.arrows 원소는 제자리에서 갱신될 수 있으니 값을 떠 둔다
    expect(a.ember).toBe(true);
    const ls = lightAt(s, a);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.intensity).toBeCloseTo(0.6, 5);
    expect(ls[0]!.range).toBeCloseTo(4, 5);
    // 한 틱 뒤에도 화살을 따라간다
    run(s, idle(), 1);
    const a2 = arrows(s).find((x) => x.id === a.id)!;
    expect(a2.z).not.toBe(a.z);
    expect(lightAt(s, a2)).toHaveLength(1);
    disposeSim(s);
  });

  it('T3 벽에 박히면 불씨 하나가 남아 빛나고, 600틱 뒤 꺼진다', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    drawAndLoose(s, 20, 0);
    // 한 틱씩 밟아 불씨가 처음 보이는 상태의 틱(born)을 잡는다 (6m 벽까지 ~0.3초)
    let n = 0;
    while (embers(s).length === 0 && n++ < 60) stepSim(s, idle());
    const born = s.tick;
    expect(arrows(s)).toHaveLength(0);
    expect(embers(s)).toHaveLength(1);
    const e = embers(s)[0]!;
    expect(EMBER_TICKS).toBe(600);
    expect(e.ttl).toBeGreaterThan(0);
    expect(e.ttl).toBeLessThanOrEqual(EMBER_TICKS);
    expect(Math.abs(e.z + 5.75)).toBeLessThan(0.6); // 벽 면에
    expect(Math.abs(e.x)).toBeLessThan(0.5);
    const ls = lightAt(s, e);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.intensity).toBeCloseTo(0.7, 5);
    expect(ls[0]!.range).toBeCloseTo(5, 5);

    // 이벤트는 그 일이 일어난 스텝의 틱(스텝 전 sim.tick)을 단다 — 박힌 스텝 직후 상태가 born
    const stuck = s.events.filter((ev) => ev.type === 'arrowStuck');
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.tick).toBe(born - 1);
    // 꼭 600틱 동안 빛난다: born+599까지 남아 있고 born+600에 꺼진다
    while (s.tick < born + EMBER_TICKS - 1) stepSim(s, idle());
    expect(embers(s)).toHaveLength(1);
    expect(lightAt(s, e)).toHaveLength(1);
    stepSim(s, idle());
    expect(s.tick).toBe(born + EMBER_TICKS);
    expect(embers(s)).toHaveLength(0);
    expect(lightAt(s, e)).toHaveLength(0);
    disposeSim(s);
  });

  it('T4 불씨를 다섯 남기면 넷만 남고, 가장 오래된 것이 꺼진다', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    expect(MAX_EMBERS).toBe(4);
    // 조준을 조금씩 틀어 벽 위 서로 다른 자리에 박는다 (40/4096바퀴 ≈ 6m에서 0.37m)
    const yaws = [0, 40, 80, 4096 - 40, 4096 - 80];
    for (const yaw of yaws.slice(0, 4)) drawAndLoose(s, 20, 40, yaw);
    expect(embers(s)).toHaveLength(4);
    const oldest = { ...embers(s)[0]! };
    const rest = embers(s).slice(1).map((e) => ({ x: e.x, z: e.z }));

    drawAndLoose(s, 20, 40, yaws[4]);
    expect(embers(s)).toHaveLength(MAX_EMBERS);
    const now = embers(s);
    expect(now.some((e) => Math.hypot(e.x - oldest.x, e.z - oldest.z) < 0.05)).toBe(false);
    expect(now.slice(0, 3).map((e) => ({ x: e.x, z: e.z }))).toEqual(rest); // 나머지는 순서대로 남는다
    expect(now[3]!.x).toBeGreaterThan(0.5); // 새 불씨 (yaw 4096−80 → +X 쪽)
    expect(lightAt(s, oldest)).toHaveLength(0);
    disposeSim(s);
  });

  it('T5 구역 2: 불씨 화살은 꺼진 등불을 밝히고, 횃불 없이 쏜 화살은 못 밝힌다', () => {
    const lamp0 = { x: ZONE2.lamps![0]![0], z: ZONE2.lamps![0]![2] }; // (−19, ·, −30), 불꽃 y = 2
    const shootAtLamp = (withTorch: boolean) => {
      const s = createSim(HALL, 1, 'elf');
      // 등불 남쪽 6m에서 북(−Z, yaw 0)을 본다 — 가슴 높이 ≈1.31m, 불꽃(y 2)까지 ≈0.69m로 지나간다
      s.player.body.setTranslation({ x: lamp0.x, y: 1.2, z: lamp0.z + 6 }, true);
      run(s, idle(), 30);
      if (!withTorch) dropTorch(s);
      expect(s.lamps[0]!.lit).toBe(false);
      s.events.length = 0;
      drawAndLoose(s, 20, 30);
      expect(s.nextArrowId).toBe(1); // 화살은 쏘았다
      return s;
    };

    const s = shootAtLamp(true);
    expect(s.lamps[0]!.lit).toBe(true);
    expect(s.events.some((e) => e.type === 'lamp' && e.index === 0 && e.allLit === false)).toBe(true);
    expect(s.lamps[1]!.lit).toBe(false);
    expect(s.doors[0]!.open).toBe(false); // 하나만 밝혔다
    disposeSim(s);

    const n = shootAtLamp(false);
    expect(n.lamps[0]!.lit).toBe(false);
    expect(n.events.some((e) => e.type === 'lamp')).toBe(false);
    disposeSim(n);
  });

  it('T6 사람의 강공격은 화살도 불씨도 만들지 않는다', () => {
    const s = createSim(WALLED, 3, 'human');
    run(s, idle(), 10);
    expect(s.player.heldTorch).toBeGreaterThanOrEqual(0);
    drawAndLoose(s, 20, 40);
    expect(s.nextArrowId).toBe(0);
    expect(embers(s)).toEqual([]);
    disposeSim(s);
  });

  it('T7 불씨가 있을 때 스냅샷을 복원하면 같은 해시, 같은 결과', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    drawAndLoose(s, 20, 40); // 박힌 불씨 하나
    drawAndLoose(s, 20, 4, 40); // 날아가는 불씨 화살 하나
    expect(embers(s)).toHaveLength(1);
    expect(newest(s).ember).toBe(true);

    const b = restoreSim(WALLED, 3, 'elf', takeSnapshot(s));
    expect(embers(b)).toEqual(embers(s));
    expect(hashSim(b)).toBe(hashSim(s));
    for (const sim of [s, b]) {
      run(sim, idle(), 40);
      drawAndLoose(sim, 20, 40, 4096 - 40);
      run(sim, idle(), 300);
    }
    expect(embers(b)).toEqual(embers(s));
    expect(hashSim(b)).toBe(hashSim(s));
    [s, b].forEach(disposeSim);
  });

  it('불씨 화살이 적을 맞히면 불씨를 남기지 않는다 (K3)', () => {
    const s = createSim(WALLED, 3, 'elf');
    run(s, idle(), 10);
    const t = s.player.body.translation();
    const g = createEnemy(s, s.nextEnemyId++, [t.x, t.y, t.z - 4], [[t.x, t.y, t.z - 4]]); // 벽(6m)보다 앞
    g.hp = 1000;
    s.enemies.push(g);
    drawAndLoose(s, 20, 4);
    expect(newest(s).ember).toBe(true);
    run(s, idle(), 40);
    expect(s.events.some((e) => e.type === 'hit' && e.target === g.id)).toBe(true);
    expect(arrows(s)).toHaveLength(0);
    expect(embers(s)).toEqual([]);
    disposeSim(s);
  });

  it('등불을 밝힌 불씨 화살은 계속 날아간다 (K4)', () => {
    const s = createSim(HALL, 1, 'elf');
    const [lx, , lz] = ZONE2.lamps![0]!; // (−19, 0, −30)
    s.player.body.setTranslation({ x: lx, y: 1.2, z: lz + 6 }, true);
    run(s, idle(), 30);
    drawAndLoose(s, 20, 4);
    const id = newest(s).id;
    let n = 0;
    while (!s.lamps[0]!.lit && n++ < 40) stepSim(s, idle());
    expect(s.lamps[0]!.lit).toBe(true);
    run(s, idle(), 10); // 0.5초 = 10m 더
    const a = arrows(s).find((x) => x.id === id);
    const stuckPast = s.events.some((e) => e.type === 'arrowStuck' && e.z < lz - 1);
    expect(a !== undefined ? a.z < lz - 1 : stuckPast).toBe(true); // 불꽃점 너머에 있다
    expect(a !== undefined || stuckPast).toBe(true);
    disposeSim(s);
  });

  it('구역 2 등불 셋을 모두 불씨 화살로 밝히면 등불 문이 열린다 (K4)', () => {
    const s = createSim(HALL, 1, 'elf');
    const doors = ZONE2.lampDoors!;
    // 각 등불 남쪽 6m에서 북(−Z)을 보고 쏜다: (−19,−24) (19,−24) (0,−48)
    for (const [lx, , lz] of ZONE2.lamps!) {
      for (const d of doors) expect(s.doors[d]!.open).toBe(false);
      s.player.body.setTranslation({ x: lx, y: 1.2, z: lz + 6 }, true);
      run(s, idle(), 30);
      drawAndLoose(s, 20, 30);
    }
    expect(s.lamps.every((l) => l.lit)).toBe(true);
    expect(s.events.filter((e) => e.type === 'lamp')).toHaveLength(3);
    expect(s.events.some((e) => e.type === 'lamp' && e.allLit)).toBe(true);
    for (const d of doors) expect(s.doors[d]!.open).toBe(true);
    disposeSim(s);
  });

  it('불씨 화살은 화로를 밝히지 않는다 (K5)', () => {
    // 화로 불꽃(y + 1.2 = 1.31)을 화살 높이(≈1.31)에, 3m 앞 길목에 둔다
    const level: Level = { ...WALLED, braziers: [[0, 0.11, -3]] };
    const s = createSim(level, 3, 'elf');
    run(s, idle(), 10);
    const b = s.braziers[0]!;
    b.lit = false;
    drawAndLoose(s, 20, 40);
    expect(s.nextArrowId).toBe(1);
    expect(b.lit).toBe(false);
    disposeSim(s);
  });

  it('고블린 궁수의 화살은 불씨 화살이 아니다 (K1)', () => {
    const level: Level = {
      solids: [{ kind: 'box', pos: [0, -0.5, 0], half: [30, 0.5, 30], surface: 'floor' }],
      torches: [],
      spawn: [0, 1.2, 8],
      enemies: [{ kind: 'archer', pos: [0, 1, -2], patrol: [[0, 1, -2]] }],
    };
    const s = createSim(level, 1, 'elf');
    expect(s.player.heldTorch).toBeGreaterThanOrEqual(0); // 플레이어는 횃불을 들고 있어도
    const a = s.enemies.find((e) => e.kind === 'archer')!;
    a.ai = 'engage';
    a.awareness = 1;
    let n = 0;
    while (arrows(s).length === 0 && n++ < 200) stepSim(s, idle());
    expect(arrows(s).length).toBeGreaterThan(0);
    for (const x of arrows(s)) expect(x.ember).toBeUndefined();
    expect(embers(s)).toEqual([]);
    disposeSim(s);
  });
});
