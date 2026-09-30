import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { damageCollapse } from '../src/sim/collapse';
import { COMPANION_FULL } from '../src/sim/companion';
import { createEnemy } from '../src/sim/enemy';
import { spawnHorde } from '../src/sim/horde';
import { pathTo } from '../src/sim/nav';
import { BTN_CALL, BTN_LIGHT, createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { ZONE1 } from '../src/sim/zone1';

/** 무너지는 모리아(E)와 동료 호출: 금 간 기둥·깔림·굴 봉쇄·출구 경로 보존·결정성, 종족별 광역기 */

const idle = (buttons = 0, yaw = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw });
const run = (sim: Sim, f: InputFrame, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSim(sim, f);
};
const put = (sim: Sim, x: number, y: number, z: number, facing = 0) => {
  sim.player.body.setTranslation({ x, y, z }, true);
  sim.player.facing = facing;
};
const HALL: [number, number, number] = [0, 5, -12];
const WEST_END: [number, number, number] = [-27, 5, -12];
const SPAWN: [number, number, number] = [0, 1.2, 50];
const TROLL_ROOM: [number, number, number] = [0, 5, -40];

beforeAll(async () => {
  await RAPIER.init();
});

describe('무너지는 모리아', () => {
  it('칼로 금 간 기둥을 치면 체력이 준다 (판정 구간마다 한 번)', () => {
    const sim = createSim(ZONE1, 1);
    sim.doors[0]!.open = true;
    put(sim, -14.7, 5.2, -6.6, 0); // 기둥(−14.7, −8.2) 1.6m 앞, −Z를 봄
    run(sim, idle(), 20);
    const hp0 = sim.collapses[0]!.hp;
    stepSim(sim, idle(BTN_LIGHT));
    run(sim, idle(), 40);
    expect(sim.collapses[0]!.hp).toBeLessThan(hp0);
    expect(sim.collapses[0]!.hp).toBeGreaterThan(hp0 - 30); // 한 번만
    disposeSim(sim);
  });

  it('쓰러지면 띠 안의 무리·고블린이 깔리고, 굳은 뒤 굴이 봉쇄된다 — 주 동선(서문 → 트롤 굴)은 남는다', () => {
    const sim = createSim(ZONE1, 2);
    sim.doors[0]!.open = true;
    put(sim, 0, 5.2, 0);
    run(sim, idle(), 20);
    expect(pathTo(sim.nav, HALL, WEST_END, sim.navBlock.filter).length).toBeGreaterThan(0);
    // 쓰러질 띠(x ≈ −14.7, z −8.2 → −16.2) 안에 무리 10과 고블린 1
    spawnHorde(sim, [-14.5, 4, -12], 10);
    const g = createEnemy(sim, sim.nextEnemyId++, [-14.7, 5, -13], [[-14.7, 5, -13]]);
    sim.enemies.push(g);
    damageCollapse(sim, 0, 999);
    expect(sim.collapses[0]!.state).toBe('falling');
    // 무리는 떨어지는 0.8초 동안에도 움직인다 → 땅에 닿기 직전에 띠 안에 있던 수를 센다 (띠: x −14.7 ± 1.3, z −8.2 − 0.7 ~ −16.2)
    run(sim, idle(), 49);
    const n = sim.horde!.agents.length;
    const inBand = sim.horde!.agents.filter((a) => Math.abs(a.x + 14.7) <= 1.25 && a.z <= -7.6 && a.z >= -16.1).length;
    expect(inBand).toBeGreaterThan(0);
    run(sim, idle(), 6);
    expect(g.ai).toBe('dead');
    // 센 것은 모두 깔린다. 마지막 1틱에 띠 경계를 넘어 들어온 한두 마리가 더 깔릴 수 있다
    const killed = n - sim.horde!.agents.length;
    expect(killed).toBeGreaterThanOrEqual(inBand);
    expect(killed).toBeLessThanOrEqual(inBand + 2);
    run(sim, idle(), 300);
    expect(sim.collapses[0]!.state).toBe('down');
    // 굴 봉쇄 + 주 동선 보존 (계획서 E: "붕괴해도 출구 경로가 남는가")
    expect(pathTo(sim.nav, HALL, WEST_END, sim.navBlock.filter)).toEqual([]);
    damageCollapse(sim, 1, 999);
    run(sim, idle(), 360);
    const main = pathTo(sim.nav, SPAWN, TROLL_ROOM, sim.navBlock.filter);
    expect(main.length).toBeGreaterThan(0);
    const end = main[main.length - 1]!;
    expect(Math.hypot(end[0] - TROLL_ROOM[0], end[2] - TROLL_ROOM[2])).toBeLessThan(0.5);
    // 잔해는 고정됐고, 기둥 밑동에서 넘어지는 방향(−Z)으로 누워 있다
    for (const b of sim.collapses[0]!.chunks) {
      expect(b.isFixed()).toBe(true);
      expect(b.translation().z).toBeLessThan(-7);
    }
    disposeSim(sim);
  });

  it('쓰러지는 띠 안의 플레이어는 50 맞는다', () => {
    const sim = createSim(ZONE1, 3);
    sim.doors[0]!.open = true;
    put(sim, -14.7, 5.2, -12);
    run(sim, idle(), 20);
    const hp0 = sim.player.hp;
    damageCollapse(sim, 0, 999);
    run(sim, idle(), 55);
    expect(sim.player.hp).toBe(hp0 - 50);
    disposeSim(sim);
  });

  it('물결은 서 있는 금 간 기둥 옆 굴에서 먼저 나온다', () => {
    const sim = createSim(ZONE1, 4);
    sim.doors[0]!.open = true;
    put(sim, 0, 1.2, 30); // 입구 홀 — 굴들이 멀고 보이지 않는다
    run(sim, idle(), 20);
    sim.director.phase = 'warn';
    sim.director.phaseTick = 60 * 8 - 1;
    run(sim, idle(), 90);
    expect(sim.director.phase).toBe('peak');
    const xs = sim.horde!.agents.map((a) => Math.abs(a.x));
    expect(xs.reduce((a, b) => a + b, 0) / xs.length).toBeGreaterThan(18); // 굴 (|x| > 16)
    disposeSim(sim);
  });

  it('결정적: 같은 붕괴 → 같은 해시 (조각 물리 포함)', () => {
    const play = () => {
      const sim = createSim(ZONE1, 5);
      sim.doors[0]!.open = true;
      spawnHorde(sim, [-20, 4, -12], 20);
      damageCollapse(sim, 0, 999);
      run(sim, idle(), 400);
      const h = hashSim(sim);
      disposeSim(sim);
      return h;
    };
    expect(play()).toBe(play());
  });
});

describe('동료 호출', () => {
  const setup = (cls: 'human' | 'dwarf' | 'elf') => {
    const sim = createSim(ZONE1, 6, cls);
    sim.doors[0]!.open = true;
    put(sim, 0, 5.2, -12, 0);
    run(sim, idle(), 20);
    sim.horde!.agents.push(
      { id: 1, x: 0, y: 4, z: -15, vx: 0, vz: 0, facing: 0 }, // 앞 3m
      { id: 2, x: 0, y: 4, z: -9, vx: 0, vz: 0, facing: 0 }, // 뒤 3m
      { id: 3, x: 0, y: 4, z: -24.5, vx: 0, vz: 0, facing: 0 }, // 앞 12.5m (12m 안의 어둠이면 승격해 버린다)
    );
    return sim;
  };
  const left = (sim: Sim) => sim.horde!.agents.map((a) => a.id).sort();

  it('게이지가 차지 않았으면 아무 일도 없다. 고블린을 쓰러뜨리면 +8', () => {
    const sim = setup('human');
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([1, 2, 3]);
    const g = createEnemy(sim, sim.nextEnemyId++, [0, 5, -13.4], [[0, 5, -13.4]]);
    g.hp = 1;
    sim.enemies.push(g);
    stepSim(sim, idle(BTN_LIGHT));
    run(sim, idle(), 20);
    expect(g.ai).toBe('dead');
    expect(sim.player.companion).toBeGreaterThanOrEqual(8);
    disposeSim(sim);
  });

  it('아라곤(인간): 둘레 6m — 앞·뒤 3m는 쓰러지고 12.5m는 남는다', () => {
    const sim = setup('human');
    sim.player.companion = COMPANION_FULL;
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([3]);
    expect(sim.player.companion).toBe(0);
    expect(sim.events.some((e) => e.type === 'companion' && e.who === '아라곤')).toBe(true);
    disposeSim(sim);
  });

  it('레골라스(엘프): 앞 60° 18m — 앞 3m·12.5m는 쓰러지고 뒤는 남는다', () => {
    const sim = setup('elf');
    sim.player.companion = COMPANION_FULL;
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([2]);
    disposeSim(sim);
  });

  it('휘청이는 중에도 부를 수 있다 (위기 탈출), 쓰러졌으면 못 부른다', () => {
    const sim = setup('human');
    sim.player.companion = COMPANION_FULL;
    sim.player.action = 'stagger';
    sim.player.actionTick = 0;
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([3]);
    // 히트스톱 중에 눌러도 불린다
    sim.horde!.agents.push({ id: 4, x: 1, y: 4, z: -12, vx: 0, vz: 0, facing: 0 });
    sim.player.companion = COMPANION_FULL;
    stepSim(sim, idle()); // 버튼을 한 번 뗀다 (누른 '순간'만 받는다)
    sim.hitstop = 5;
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([3]);
    sim.player.companion = COMPANION_FULL;
    sim.player.action = 'dead';
    run(sim, idle(), 2);
    stepSim(sim, idle(BTN_CALL));
    expect(sim.player.companion).toBe(COMPANION_FULL);
    disposeSim(sim);
  });

  it('김리(드워프): 둘레 4.5m, 고블린 피해 70', () => {
    const sim = setup('dwarf');
    const g = createEnemy(sim, sim.nextEnemyId++, [2, 5, -12], [[2, 5, -12]]);
    g.hp = 100;
    sim.enemies.push(g);
    sim.player.companion = COMPANION_FULL;
    stepSim(sim, idle(BTN_CALL));
    expect(left(sim)).toEqual([3]);
    expect(g.hp).toBe(30);
    disposeSim(sim);
  });
});
