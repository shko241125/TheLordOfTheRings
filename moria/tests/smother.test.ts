import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import * as archer from '../src/sim/archer';
import { createEnemy } from '../src/sim/enemy';
import { spawnHorde } from '../src/sim/horde';
import { createSim, disposeSim, hashSim, stepSim, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE1 } from '../src/sim/zone1';

/** Q 불씨 밟기: 무리가 불씨 5m 안에 6마리 이상 1.5초(90틱) 몰려 있으면 불씨가 꺼진다 */

// 아직 없는 새 내보내기·필드는 느슨하게 읽는다 (구현 전에도 이 파일이 타입 검사를 통과하도록)
const A = archer as unknown as { SMOTHER_RADIUS: number; SMOTHER_COUNT: number; SMOTHER_TICKS: number; smotherEmbers: (s: Sim) => void };
const smother = (s: Sim, n = 1) => {
  for (let i = 0; i < n; i++) A.smotherEmbers(s);
};
type Ember = { x: number; y: number; z: number; ttl: number; press: number };
type OutEv = { type: 'emberOut'; tick: number; x: number; y: number; z: number };
const embers = (s: Sim) => (s as unknown as { embers: Ember[] }).embers;
const outs = (s: Sim) => (s.events as unknown as { type: string }[]).filter((e) => e.type === 'emberOut') as OutEv[];

const idle = (buttons = 0, yaw = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw });
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);

/** 구역 1 서쪽 홀: 무리를 비우고 n마리를 만들어(spawnHorde) 손으로 자리에 놓는다 */
const E0 = { x: -10, y: 5, z: -12 };
function setup(n: number, seed = 11) {
  const s = createSim(ZONE1, seed);
  s.horde!.agents.length = 0;
  expect(spawnHorde(s, [-24, 4, -12], n)).toBe(n);
  s.events.length = 0;
  return s;
}
/** i번째 무리를 불씨 기준 (dx, dy, dz)에 놓는다 */
function place(s: Sim, i: number, dx: number, dy: number, dz: number, e = E0) {
  const a = s.horde!.agents[i]!;
  a.x = e.x + dx;
  a.y = e.y + dy;
  a.z = e.z + dz;
}
const addEmber = (s: Sim, e = E0) => {
  const em: Ember = { x: e.x, y: e.y, z: e.z, ttl: 600, press: 0 };
  embers(s).push(em);
  return em;
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('불씨 밟기', () => {
  it('상수: 반경 5m, 6마리, 90틱', () => {
    expect(A.SMOTHER_RADIUS).toBe(5);
    expect(A.SMOTHER_COUNT).toBe(6);
    expect(A.SMOTHER_TICKS).toBe(90);
    expect(typeof A.smotherEmbers).toBe('function');
  });

  it('QT1 5m 안의 6마리: 89번까지 남고(press 89), 90번째에 꺼지며 그 자리에 emberOut 하나', () => {
    const s = setup(7);
    // 거리 0 ~ 4.9m의 6마리 + 20m 밖의 1마리
    const offs: [number, number][] = [[0, 0], [1, 0], [0, -2], [-3, 0], [0, 4], [4.9, 0]];
    offs.forEach(([dx, dz], i) => place(s, i, dx, 0, dz));
    place(s, 6, 20, 0, 0);
    // 다른 불씨(무리 없음)를 앞에 둬서, 꺼지는 것이 정확히 붐비는 불씨인지 본다
    const far = { x: 20, y: 5, z: 30 };
    addEmber(s, far);
    addEmber(s);
    const t = s.tick;

    smother(s);
    expect(embers(s)[1]!.press).toBe(1);
    expect(embers(s)[0]!.press).toBe(0);
    smother(s, 88);
    expect(embers(s)).toHaveLength(2);
    expect(embers(s)[1]!.press).toBe(89);
    expect(embers(s)[1]!.ttl).toBe(600); // smotherEmbers는 ttl을 건드리지 않는다
    expect(outs(s)).toHaveLength(0);
    expect(s.tick).toBe(t); // 직접 호출 — 틱이 가지 않는다

    smother(s);
    expect(embers(s)).toHaveLength(1);
    expect(embers(s)[0]).toMatchObject({ x: far.x, y: far.y, z: far.z, press: 0, ttl: 600 });
    const ev = outs(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ type: 'emberOut', tick: t, x: E0.x, y: E0.y, z: E0.z });

    smother(s, 5);
    expect(outs(s)).toHaveLength(1); // 한 번만
    disposeSim(s);
  });

  it('QT2 5마리(수 미달)는 200번 내내 불씨를 못 끈다 (press 0)', () => {
    const s = setup(5);
    const offs: [number, number][] = [[0, 0], [1, 1], [-1, -1], [2, -2], [-3, 3]];
    offs.forEach(([dx, dz], i) => place(s, i, dx, 0, dz));
    addEmber(s);
    for (let i = 0; i < 200; i++) {
      smother(s);
      expect(embers(s)[0]!.press).toBe(0);
    }
    expect(embers(s)).toHaveLength(1);
    expect(outs(s)).toHaveLength(0);
    disposeSim(s);
  });

  it('QT3 한 틱이라도 5마리로 줄면 press가 0으로 돌아가고, 다시 꼬박 90번이 필요하다', () => {
    const s = setup(6);
    const offs: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [2, 2]];
    offs.forEach(([dx, dz], i) => place(s, i, dx, 0, dz));
    addEmber(s);
    smother(s, 50);
    expect(embers(s)[0]!.press).toBe(50);

    place(s, 5, 6, 0, 0); // 5m 밖으로
    smother(s);
    expect(embers(s)[0]!.press).toBe(0); // 줄어드는 게 아니라 0으로
    place(s, 5, 2, 0, 2); // 다시 안으로

    smother(s, 89);
    expect(embers(s)).toHaveLength(1);
    expect(embers(s)[0]!.press).toBe(89);
    expect(outs(s)).toHaveLength(0);
    smother(s);
    expect(embers(s)).toHaveLength(0);
    expect(outs(s)).toHaveLength(1);
    disposeSim(s);
  });

  it('QT4 반경은 엄격(<)하고 수평 거리다: 정확히 5.0m는 안 세고, 수평 3m·위아래 10m는 센다', () => {
    // (a) 6마리 모두 수평 정확히 5.0m (3-4-5 포함, 제곱 합이 정확히 25)
    const a = setup(6);
    const ring: [number, number][] = [[5, 0], [-5, 0], [0, 5], [0, -5], [3, 4], [-3, -4]];
    ring.forEach(([dx, dz], i) => place(a, i, dx, 0, dz));
    addEmber(a);
    smother(a, 120);
    expect(embers(a)).toHaveLength(1);
    expect(embers(a)[0]!.press).toBe(0);
    // 5마리 안 + 1마리 정확히 5.0m → 5마리뿐; 4.99m로 들이면 6마리
    const inner: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    inner.forEach(([dx, dz], i) => place(a, i, dx, 0, dz));
    smother(a);
    expect(embers(a)[0]!.press).toBe(0);
    place(a, 5, -3, 0, -3.99); // 수평 ≈ 4.992m
    smother(a);
    expect(embers(a)[0]!.press).toBe(1);
    disposeSim(a);

    // (b) 수평 3m, 위로 10m 3마리 + 아래로 10m 3마리 (3D 거리 ≈ 10.4m)
    const b = setup(6);
    const up: [number, number, number][] = [[3, 10, 0], [-3, 10, 0], [0, 10, 3], [0, -10, -3], [3, -10, 0], [-3, -10, 0]];
    up.forEach(([dx, dy, dz], i) => place(b, i, dx, dy, dz));
    addEmber(b);
    smother(b, 89);
    expect(embers(b)[0]!.press).toBe(89);
    smother(b);
    expect(embers(b)).toHaveLength(0);
    expect(outs(b)).toHaveLength(1);
    disposeSim(b);
  });

  it('QT5 진짜 고블린(sim.enemies)은 불씨를 못 끄고, 날아가는 불씨 화살은 그대로다', () => {
    const s = setup(6);
    // 무리는 모두 멀리 (20m 밖)
    for (let i = 0; i < 6; i++) place(s, i, 20 + i, 0, 0);
    addEmber(s);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      const p: [number, number, number] = [E0.x + 2 * Math.cos(ang), E0.y, E0.z + 2 * Math.sin(ang)];
      s.enemies.push(createEnemy(s, s.nextEnemyId++, p, [p]));
    }
    // 불씨 바로 옆을 날고 있는 불씨 화살 둘
    const flying = [
      { id: 9001, x: E0.x + 1, y: E0.y + 1, z: E0.z, vx: 30, vy: 0, vz: 0, ttl: 100, dmg: 10, dark: 1, ember: true as const },
      { id: 9002, x: E0.x, y: E0.y + 1, z: E0.z + 1, vx: 0, vy: 0, vz: 30, ttl: 100, dmg: 10, dark: 1, ember: true as const },
    ];
    s.arrows.push(...flying.map((f) => ({ ...f })));
    smother(s, 200);
    expect(embers(s)).toHaveLength(1);
    expect(embers(s)[0]!.press).toBe(0);
    expect(outs(s)).toHaveLength(0);

    // 무리 6마리가 몰려와 불씨를 꺼도 날아가는 화살은 손대지 않는다
    const offs: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]];
    offs.forEach(([dx, dz], i) => place(s, i, dx, 0, dz));
    smother(s, 90);
    expect(embers(s)).toHaveLength(0);
    expect(outs(s)).toHaveLength(1);
    expect(s.arrows).toEqual(flying);
    disposeSim(s);
  });

  it('Q4 무리가 없으면 불씨는 600틱 수명으로 조용히 꺼진다 (emberOut 없음)', () => {
    const s = setup(0);
    addEmber(s);
    for (let i = 0; i < 599; i++) stepSim(s, idle());
    expect(embers(s)).toHaveLength(1);
    stepSim(s, idle());
    expect(embers(s)).toHaveLength(0);
    for (let i = 0; i < 60; i++) stepSim(s, idle());
    expect(outs(s)).toHaveLength(0);
    disposeSim(s);
  });

  it('Q4 순서: press 89·ttl 1인 불씨에 6마리가 붙어 있으면 그 스텝에 수명이 아니라 밟혀서 꺼진다', () => {
    const s = setup(6);
    // 반경 1.5m 안에 촘촘히 — 한 틱 움직여도 5m 밖으로 나가지 못한다
    const offs: [number, number][] = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]];
    offs.forEach(([dx, dz], i) => place(s, i, dx, 0, dz));
    const em = addEmber(s);
    em.press = 89;
    em.ttl = 1;
    const t = s.tick;
    stepSim(s, idle());
    expect(embers(s)).toHaveLength(0);
    const ev = outs(s);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toEqual({ type: 'emberOut', tick: t, x: E0.x, y: E0.y, z: E0.z });
    disposeSim(s);
  });

  /** 구역 1: 문 열고 플레이어 (0, 5.2, −12), 무리 20을 (−24, 4, −12)에, 불씨 하나를 (−10, 무리 높이 + 1.3, −12)에 */
  function zone(seed: number) {
    const s = createSim(ZONE1, seed);
    s.doors[0]!.open = true;
    put(s, 0, 5.2, -12);
    s.horde!.agents.length = 0;
    expect(spawnHorde(s, [-24, 4, -12], 20)).toBe(20);
    const ay = s.horde!.agents[0]!.y;
    const em = addEmber(s, { x: -10, y: ay + 1.3, z: -12 });
    s.events.length = 0;
    return { s, em: { ...em } };
  }
  const reached = (s: Sim) =>
    s.horde!.agents.some((a) => a.x > -10) || s.enemies.some((e) => e.fromHorde && e.ai !== 'dead' && e.body.translation().x > -10);

  it('QT6 구역 1: 무리가 몰려 불씨를 600틱 수명 전에 끄고(emberOut), 그 뒤 x = −10을 넘어 밀고 온다', () => {
    const { s, em } = zone(21);
    const t0 = s.tick;
    let out: OutEv | undefined;
    for (let i = 0; i < 600 && !out; i++) {
      stepSim(s, idle());
      out = outs(s)[0];
    }
    expect(out).toBeDefined();
    expect(out!.tick - t0).toBeLessThan(599); // 시간으로 꺼지기(600틱) 전에
    expect(out).toMatchObject({ x: em.x, y: em.y, z: em.z });
    expect(embers(s)).toHaveLength(0);
    expect(outs(s)).toHaveLength(1);

    let ok = false;
    for (let i = 0; i < 600 && !ok; i++) {
      stepSim(s, idle());
      ok = reached(s);
    }
    expect(ok).toBe(true);
    disposeSim(s);
  });

  it('QT7 눌린(press > 0) 불씨를 담은 스냅샷은 같은 해시로 되살아나고 같은 결과를 낸다', () => {
    const { s } = zone(31);
    for (let i = 0; i < 600 && !((embers(s)[0]?.press ?? 0) > 10); i++) stepSim(s, idle());
    expect(embers(s)).toHaveLength(1);
    const press = embers(s)[0]!.press;
    expect(press).toBeGreaterThan(10);

    // press는 해시에 섞인다
    const h0 = hashSim(s);
    embers(s)[0]!.press = press + 1;
    expect(hashSim(s)).not.toBe(h0);
    embers(s)[0]!.press = press;
    expect(hashSim(s)).toBe(h0);

    const snapTick = s.tick;
    const b = restoreSim(ZONE1, 31, 'human', takeSnapshot(s));
    expect(embers(b)).toEqual(embers(s));
    expect(hashSim(b)).toBe(h0);
    for (const sim of [s, b]) for (let i = 0; i < 300; i++) stepSim(sim, idle());
    expect(hashSim(b)).toBe(hashSim(s));
    expect(embers(b)).toEqual(embers(s));
    const after = (x: Sim) => outs(x).filter((e) => e.tick >= snapTick);
    expect(after(b)).toEqual(after(s));
    disposeSim(s);
    disposeSim(b);
  });
});
