import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { BALROG_HP, EXPOSED_TICKS, FALL_TICKS, SLAM_WINDUP, WIND_WINDUP } from '../src/sim/balrog';
import { damageEnemy } from '../src/sim/enemy';
import { restoreProgress } from '../src/sim/interact';
import { pathTo } from '../src/sim/nav';
import { BTN_CROUCH, BTN_HEAVY, BTN_LIGHT, BTN_SPRINT, createSim, disposeSim, hashSim, stepSim, type Enemy, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE5 } from '../src/sim/zone5';

/** 구역 5 (크하잣둠의 다리): 불길 추격 → 발로그 등장 → 내리찍기·날개 바람·채찍·불의 고리 → 10%에서 끝 장면 → 동문 */
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const fwd = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 127, yaw: 0 });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);
const balrog = (s: Sim): Enemy => s.enemies.find((e) => e.kind === 'balrog')!;
/** 추격을 건너뛰고 발로그를 깨운다: 다리 위로 옮겨 놓는다 */
const wake = (s: Sim, z = -84) => {
  put(s, 0, 1.2, -3);
  run(s, idle(), 3);
  put(s, 0, 1.2, z);
  run(s, idle(), 3);
  expect(balrog(s).ai).toBe('engage');
};
/** 다음 기술을 고정해 시작시킨다 */
const force = (s: Sim, move: Enemy['move']) => {
  const b = balrog(s);
  b.cooldownUntil = s.tick + 1_000_000;
  b.ai = 'attack';
  b.aiTick = 0;
  b.move = move;
  b.swingTick = 0;
  b.step = move === 'wind' ? 1 : 0;
  b.hitSet.clear();
  const t = s.player.body.translation();
  b.aimX = t.x;
  b.aimZ = t.z;
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('구역 5 — 불길 추격', () => {
  it('홀에 들어서면 불의 벽이 다가온다: 서 있으면 타고, 달리면 다리에 닿아 발로그가 나타난다', () => {
    const s = createSim(ZONE5, 1);
    put(s, 0, 1.2, -5);
    run(s, idle(), 3);
    expect(s.chase.state).toBe('run');
    run(s, idle(), 60 * 6);
    expect(s.player.action).toBe('dead');
    expect(s.events.some((e) => e.type === 'playerHit' && e.source === 'fire')).toBe(true);

    const t = createSim(ZONE5, 2);
    // 질주(스태미나가 바닥나면 조깅)로 다리까지
    for (let i = 0; i < 60 * 30 && t.chase.state !== 'done'; i++) stepSim(t, fwd(BTN_SPRINT));
    expect(t.player.action).not.toBe('dead');
    expect(t.chase.state).toBe('done');
    expect(balrog(t).ai).toBe('engage');
    expect(balrog(t).body.translation().z).toBeCloseTo(-73.5, 1);
    expect(t.events.some((e) => e.type === 'balrog' && e.stage === 'wake')).toBe(true);
    [s, t].forEach(disposeSim);
  });

  it('다리 위를 건너 동문까지 길이 이어지고, 다리 밖은 심연이다', () => {
    const s = createSim(ZONE5, 3);
    const p = pathTo(s.nav, [0, 0.2, 9], [0, 0, -130]);
    expect(p.length).toBeGreaterThan(0);
    expect(Math.hypot(p[p.length - 1]![0], p[p.length - 1]![2] + 130)).toBeLessThan(0.6);
    put(s, 2.5, 1.2, -95); // 다리 옆 허공
    run(s, idle(), 120);
    expect(s.player.action).toBe('dead');
    expect(s.events.find((e) => e.type === 'playerHit')).toMatchObject({ source: 'lava' });
    disposeSim(s);
  });
});

describe('발로그', () => {
  it('평소에는 25%만 들어가고, 내리찍은 뒤 칼이 박혀 있는 동안은 다 들어간다', () => {
    const s = createSim(ZONE5, 4);
    wake(s);
    put(s, 0, 1.2, -75.6);
    s.player.facing = 2048; // 발로그(+Z 쪽)를 본다
    const b = balrog(s);
    s.player.hp = s.player.maxHp = 1e6;
    const hit = () => {
      const before = b.hp;
      stepSim(s, idle(BTN_LIGHT));
      run(s, idle(), 30);
      return before - b.hp;
    };
    b.cooldownUntil = s.tick + 1_000_000;
    const weak = hit();
    expect(weak).toBeGreaterThan(0);
    put(s, 0, 1.2, -84);
    force(s, 'slam');
    run(s, idle(), 50); // 조준이 굳은 뒤 옆으로 비킨다 (띠 밖)
    put(s, 4, 1.2, -76);
    run(s, idle(), SLAM_WINDUP - 48);
    expect(b.ai).toBe('stagger');
    expect(s.events.some((e) => e.type === 'balrog' && e.stage === 'exposed')).toBe(true);
    put(s, 0, 1.2, -75.6);
    s.player.facing = 2048;
    const strong = hit();
    expect(strong).toBeGreaterThanOrEqual(weak * 3);
    run(s, idle(), EXPOSED_TICKS);
    expect(b.ai).toBe('engage');
    disposeSim(s);
  });

  it('내리찍기: 띠 위에 서 있으면 45 (패링 불가), 옆으로 비키면 빗나간다', () => {
    const a = createSim(ZONE5, 5);
    wake(a, -84);
    force(a, 'slam');
    const hp0 = a.player.hp;
    run(a, idle(), SLAM_WINDUP + 1);
    expect(hp0 - a.player.hp).toBe(45);
    const b = createSim(ZONE5, 5);
    wake(b, -84);
    force(b, 'slam');
    run(b, idle(), 50); // 조준이 굳은 뒤
    put(b, 0, 1.2, -95); // 띠(14m) 밖으로 물러남
    run(b, idle(), SLAM_WINDUP - 49);
    expect(b.player.hp).toBe(hp0);
    [a, b].forEach(disposeSim);
  });

  it('날개 바람: 서 있으면 다리 밖으로 밀려 떨어지고, 웅크리면 버틴다', () => {
    const a = createSim(ZONE5, 6);
    wake(a, -84);
    force(a, 'wind');
    run(a, idle(), WIND_WINDUP + 50);
    expect(Math.abs(a.player.body.translation().x)).toBeGreaterThan(1.2);
    run(a, idle(), 120);
    expect(a.player.action).toBe('dead');
    const b = createSim(ZONE5, 6);
    wake(b, -84);
    force(b, 'wind');
    run(b, idle(BTN_CROUCH), WIND_WINDUP + 50);
    expect(Math.abs(b.player.body.translation().x)).toBeLessThan(1.2);
    expect(b.player.action).not.toBe('dead');
    [a, b].forEach(disposeSim);
  });

  it('채찍에 맞으면 끌려온다 / 불의 고리는 회피 무적으로 뚫는다', () => {
    const a = createSim(ZONE5, 7);
    wake(a, -90);
    force(a, 'whip');
    const z0 = a.player.body.translation().z;
    run(a, idle(), 80);
    expect(a.player.body.translation().z).toBeGreaterThan(z0 + 3);

    const b = createSim(ZONE5, 8);
    wake(b, -84);
    force(b, 'wave');
    const hp0 = b.player.hp;
    run(b, idle(), 60 + 60 * 2);
    expect(hp0 - b.player.hp).toBe(25);
    disposeSim(a);
    disposeSim(b);
  });

  it('체력 40%에 3페이즈, 10%에서 멈추고 간달프가 다리를 부순다 → 떨어지면 동문이 열린다', () => {
    const s = createSim(ZONE5, 9);
    wake(s, -84);
    const b = balrog(s);
    damageEnemy(s, b, BALROG_HP * 0.65);
    expect(s.events.some((e) => e.type === 'balrog' && e.stage === 'phase3')).toBe(true);
    damageEnemy(s, b, 1e6);
    expect(b.hp).toBe(BALROG_HP * 0.1);
    expect(b.ai).not.toBe('dead');
    expect(s.events.some((e) => e.type === 'balrog' && e.stage === 'break')).toBe(true);
    // 끝 장면 동안은 공격하지 않는다. 플레이어가 끊길 자리(z −86) 이쪽에 있으면 다리를 건널 때까지 기다린다
    s.events.length = 0;
    run(s, idle(), FALL_TICKS + 2);
    expect(s.events.some((e) => e.type === 'playerHit')).toBe(false);
    expect(b.ai).not.toBe('dead');
    put(s, 0, 1.2, -95);
    run(s, idle(), 3);
    expect(b.ai).toBe('dead');
    expect(s.events.some((e) => e.type === 'balrog' && e.stage === 'fall')).toBe(true);
    // 다리 서쪽 토막이 무너졌다: 거기 서면 떨어진다
    expect(s.events.some((e) => e.type === 'pillar')).toBe(true);
    expect(s.pillars.every((x) => x.body === null)).toBe(true);
    const t = createSim(ZONE5, 9);
    restoreProgress(t, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [0], lampsLit: [] }, 'south');
    run(t, idle(), 2);
    expect(t.pillars.every((x) => x.body === null)).toBe(true); // 이미 쓰러뜨린 저장 → 다리도 이미 없다
    put(t, 0, 1.2, -81);
    run(t, idle(), 120);
    expect(t.player.action).toBe('dead');
    disposeSim(t);
    put(s, 0, 1.2, -132);
    run(s, idle(), 3);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'end' });
    disposeSim(s);
  });

  it('발로그를 쓰러뜨린 저장으로 돌아오면 불길 추격은 다시 오지 않는다', () => {
    const s = createSim(ZONE5, 10);
    restoreProgress(s, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [0], lampsLit: [] }, 'south');
    put(s, 0, 1.2, -10);
    run(s, idle(), 10);
    expect(s.chase.state).toBe('done');
    disposeSim(s);
  });

  it('스냅샷: 추격 중, 그리고 발로그 기술 한가운데', () => {
    for (const setup of [(s: Sim) => { put(s, 0, 1.2, -5); run(s, idle(), 100); }, (s: Sim) => { wake(s); force(s, 'orb'); run(s, idle(), 50); }]) {
      const a = createSim(ZONE5, 11);
      setup(a);
      const b = restoreSim(ZONE5, 11, 'human', takeSnapshot(a));
      for (let i = 0; i < 90; i++) {
        stepSim(a, idle(BTN_HEAVY));
        stepSim(b, idle(BTN_HEAVY));
      }
      expect(hashSim(b)).toBe(hashSim(a));
      [a, b].forEach(disposeSim);
    }
  });
});
