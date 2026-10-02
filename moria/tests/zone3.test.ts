import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { damageCollapse } from '../src/sim/collapse';
import { damageEnemy } from '../src/sim/enemy';
import { nearestInteractable, progressOf, restorePages, restoreProgress } from '../src/sim/interact';
import type { Level } from '../src/sim/level';
import { pathTo } from '../src/sim/nav';
import { BTN_HEAVY, BTN_INTERACT, BTN_LIGHT, createSim, disposeSim, hashSim, stepSim, type Enemy, type InputFrame, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { URUK_HP } from '../src/sim/uruk';
import { ZONE2 } from '../src/sim/zone2';
import { ZONE3 } from '../src/sim/zone3';

/** 구역 3 (마자르불의 방): 우루크 방패, 방어전 3물결, 붕괴로 굴 봉쇄, 책 조각, 출구·저장 */
const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (s: Sim, f: InputFrame, n: number) => {
  for (let i = 0; i < n; i++) stepSim(s, f);
};
/** 조건이 될 때까지 (히트스톱 동안은 방어전 시계도 멈추므로 틱 수를 고정하지 않는다) */
const until = (s: Sim, ok: () => boolean, max: number) => {
  for (let i = 0; i < max && !ok(); i++) stepSim(s, idle());
  expect(ok()).toBe(true);
};
const put = (s: Sim, x: number, y: number, z: number) => s.player.body.setTranslation({ x, y, z }, true);
const immortal = (s: Sim) => {
  s.player.hp = s.player.maxHp = 1e9;
};
/** 방어전 적(시작 뒤에 나온 것)과 무리를 모두 쓰러뜨린다 */
const wipe = (s: Sim) => {
  for (const e of s.enemies) if (e.id >= s.defense.firstId && e.ai !== 'dead') damageEnemy(s, e, 1e6);
  if (s.horde) s.horde.agents = [];
};
const startAtTomb = (s: Sim) => {
  immortal(s);
  // 방을 지키던 적은 먼저 치운다 (물결 처치 XP로 레벨이 오르면 최대 체력이 다시 계산돼 '불사'가 풀린다)
  for (const e of s.enemies) damageEnemy(s, e, 1e6);
  put(s, 0, 1.2, -11.4);
  run(s, idle(), 3);
  expect(nearestInteractable(s)).toEqual({ kind: 'tomb' });
  stepSim(s, idle(BTN_INTERACT));
  stepSim(s, idle());
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('우루크 — 방패', () => {
  const ARENA: Level = {
    solids: [{ kind: 'box', pos: [0, -0.5, 0], half: [20, 0.5, 20], surface: 'floor' }],
    torches: [[0, 2.6, 4]],
    spawn: [0, 1.2, 8],
    enemies: [{ kind: 'uruk', pos: [0, 1.2, 6.6], patrol: [[0, 1.2, 6.6]] }],
  };
  /** 플레이어(z 8, 북쪽을 봄)가 우루크를 친다. front = 우루크가 플레이어를 마주 봄 */
  const strike = (front: boolean, button: number) => {
    const s = createSim(ARENA, 1);
    const u = s.enemies[0]!;
    u.facing = front ? 2048 : 0; // 2048 = +Z (플레이어 쪽)
    // 굳혀 둔다 (휘청임 상태는 돌지도 움직이지도 않는다)
    u.ai = 'stagger';
    u.staggerLen = 10_000;
    run(s, idle(), 2);
    stepSim(s, idle(button));
    run(s, idle(button === BTN_HEAVY ? BTN_HEAVY : 0), button === BTN_HEAVY ? 14 : 0);
    run(s, idle(), 24);
    const out = { lost: URUK_HP - u.hp, ai: u.ai, staggerLen: u.staggerLen, ev: s.events.map((e) => e.type) };
    disposeSim(s);
    return out;
  };

  it('앞에서 약공격: 20%만 들어가고 막는다 / 뒤에서는 다 들어간다', () => {
    const f = strike(true, BTN_LIGHT);
    const b = strike(false, BTN_LIGHT);
    expect(f.ev).toContain('block');
    expect(f.lost).toBeGreaterThan(0);
    expect(f.lost).toBeLessThanOrEqual(4);
    expect(b.ev).not.toContain('block');
    expect(b.lost).toBeGreaterThanOrEqual(10);
  });

  it('앞에서 강공격: 방패가 깨지고 길게 휘청인다', () => {
    const f = strike(true, BTN_HEAVY);
    expect(f.ev).toContain('guardBreak');
    expect(f.ev).not.toContain('block');
    expect(f.lost).toBeGreaterThanOrEqual(20);
    expect(f.ai).toBe('stagger');
    expect(f.staggerLen).toBe(60);
  });

  it('막힌 일격은 휘두르던 공격을 끊지 않는다 (공격권 유지)', () => {
    const s = createSim(ARENA, 2);
    const u = s.enemies[0]!;
    u.ai = 'attack';
    u.hasToken = true;
    s.tokens = 1;
    u.swingTick = 5;
    u.facing = 2048;
    u.staggerLen = 0; // urukGuard가 '막음'을 남긴 상태
    damageEnemy(s, u, 2);
    expect(u.ai).toBe('attack');
    expect(u.swingTick).toBe(5);
    expect(s.tokens).toBe(1);
    disposeSim(s);
  });
});

describe('구역 3 — 마자르불의 방', () => {
  it('입구에서 무덤·양쪽 굴·쇠문 앞·책 조각까지 경로가 이어진다', () => {
    const s = createSim(ZONE3, 1);
    for (const to of [[0, 0, -10.5], [-24, 0, -14], [24, 0, -14], [0, 0, -26.5], [-11, 0, -25], [11, 0, -3]] as const) {
      const p = pathTo(s.nav, [0, 0.2, 13], to);
      expect(p.length, JSON.stringify(to)).toBeGreaterThan(0);
      const e = p[p.length - 1]!;
      expect(Math.hypot(e[0] - to[0], e[2] - to[2]), JSON.stringify(to)).toBeLessThan(0.6);
    }
    disposeSim(s);
  });

  it('무덤에서 E → 3물결을 막으면 쇠문이 열리고 북쪽 출구가 열린다 (디렉터는 쉰다)', () => {
    const s = createSim(ZONE3, 2);
    // 방어전 전에는 북쪽 출구가 잠겨 있다
    // 쇠문은 비문이 아니다 (문 바로 앞에서도 수수께끼가 뜨지 않는다)
    put(s, 0, 1.2, -26);
    run(s, idle(), 2);
    expect(nearestInteractable(s)?.kind).not.toBe('door');
    startAtTomb(s);
    expect(s.defense.state).toBe('warn');
    const counts: number[] = [];
    for (let w = 0; w < 3; w++) {
      until(s, () => s.defense.state === 'wave', 600);
      expect(s.defense.wave).toBe(w);
      const mine = s.enemies.filter((e) => e.id >= s.defense.firstId && e.ai !== 'dead');
      counts.push(mine.length);
      expect(s.horde!.agents.length).toBeGreaterThan(0);
      // 물결 3에는 우루크 셋
      if (w === 2) expect(mine.filter((e) => e.kind === 'uruk').length).toBe(3);
      run(s, idle(), 60);
      expect(s.defense.state).toBe('wave'); // 아직 남아 있다
      wipe(s);
      until(s, () => s.defense.state !== 'wave', 120);
    }
    expect(counts).toEqual([5, 6, 7]);
    expect(s.defense.state).toBe('done');
    expect(s.doors[0]!.open).toBe(true);
    expect(s.events.some((e) => e.type === 'defense' && e.stage === 'done')).toBe(true);
    // 디렉터 물결은 없었다 (물결 사건은 방어전 것뿐)
    expect(s.events.some((e) => e.type === 'wave')).toBe(false);
    put(s, 0, 1.2, -44.5);
    run(s, idle(), 3);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone4', entry: 'south' });
    disposeSim(s);
  });

  it('물결이 정리되지 않아도 90초가 지나면 다음 물결로 간다', () => {
    const s = createSim(ZONE3, 3);
    startAtTomb(s);
    until(s, () => s.defense.state === 'wave', 600);
    run(s, idle(), 90 * 60 - 60);
    expect(s.defense.state).toBe('wave');
    until(s, () => s.defense.state === 'rest', 600);
    expect(s.defense.wave).toBe(1);
    disposeSim(s);
  });

  it('서쪽 굴 입구 기둥을 무너뜨리면 물결은 동쪽 굴에서만 나온다', () => {
    const s = createSim(ZONE3, 4);
    immortal(s);
    damageCollapse(s, 0, 999);
    run(s, idle(), 420);
    expect(s.collapses[0]!.state).toBe('down');
    expect(s.navBlock.excluded.size).toBeGreaterThan(0);
    startAtTomb(s);
    until(s, () => s.defense.state === 'wave', 600);
    const mine = s.enemies.filter((e) => e.id >= s.defense.firstId);
    expect(mine.length).toBe(5);
    for (const e of mine) expect(e.body.translation().x).toBeGreaterThan(10);
    expect(s.horde!.agents.every((a) => a.x > 10)).toBe(true);
    disposeSim(s);
  });

  it('스냅샷: 물결 한가운데에서 찍어 이어 돌려도 같은 해시', () => {
    const a = createSim(ZONE3, 5);
    startAtTomb(a);
    until(a, () => a.defense.state === 'wave', 600);
    run(a, idle(), 60);
    const b = restoreSim(ZONE3, 5, 'human', takeSnapshot(a));
    expect(b.defense).toEqual(a.defense);
    for (let i = 0; i < 120; i++) {
      stepSim(a, idle());
      stepSim(b, idle());
    }
    expect(hashSim(b)).toBe(hashSim(a));
    [a, b].forEach(disposeSim);
  });

  it('책 조각: E로 줍고, 저장에서 되살린다. 방어전 완료도 저장된다', () => {
    const s = createSim(ZONE3, 6);
    immortal(s);
    const pg = s.pages[1]!;
    put(s, pg.x, 1.2, pg.z + 1.2);
    run(s, idle(), 3);
    expect(nearestInteractable(s)).toEqual({ kind: 'page', index: 1 });
    stepSim(s, idle(BTN_INTERACT));
    expect(pg.taken).toBe(true);
    expect(s.events.find((e) => e.type === 'page')).toMatchObject({ id: 1 });

    const t = createSim(ZONE3, 7);
    restorePages(t, [1, 7]);
    expect(t.pages.map((x) => x.taken)).toEqual([false, true, false, false]);
    restoreProgress(t, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [], defended: true }, 'south');
    expect(t.defense.state).toBe('done');
    expect(t.doors[0]!.open).toBe(true);
    expect(progressOf(t).defended).toBe(true);
    expect(progressOf(s).defended).toBeUndefined();
    [s, t].forEach(disposeSim);
  });

  it('남쪽 출구 → 구역 2 북쪽 입구, 구역 2 북쪽 출구 → 구역 3', () => {
    const s = createSim(ZONE3, 8);
    run(s, { buttons: 0, moveX: 0, moveY: 127, yaw: 2048 }, 60);
    expect(s.events.find((e) => e.type === 'exit')).toMatchObject({ to: 'zone2', entry: 'north' });
    const z2 = createSim(ZONE2, 8);
    restoreProgress(z2, { doorsOpen: [], lit: [], checkpoint: -1, bossesDown: [], lampsLit: [] }, 'north');
    expect(z2.player.body.translation()).toMatchObject({ x: 0, z: -70 });
    [s, z2].forEach(disposeSim);
  });
});

/** 방어전 적이 실제로 싸운다: 우루크가 다가와 휘두른다 (무덤 앞에 서 있으면 맞는다) */
describe('방어전 적', () => {
  it('물결 3의 우루크가 무덤 앞의 플레이어에게 와서 때린다', () => {
    const s = createSim(ZONE3, 9);
    startAtTomb(s);
    // 물결 1·2를 지운다
    for (let w = 0; w < 2; w++) {
      until(s, () => s.defense.state === 'wave' && s.defense.wave === w, 600);
      wipe(s);
      until(s, () => s.defense.state === 'rest', 120);
    }
    until(s, () => s.defense.state === 'wave', 900);
    expect(s.defense.wave).toBe(2);
    const uruks = (): Enemy[] => s.enemies.filter((e) => e.kind === 'uruk' && e.id >= s.defense.firstId);
    let swung = false;
    for (let i = 0; i < 60 * 30 && !swung; i++) {
      s.player.hp = 1e9;
      stepSim(s, idle());
      swung = s.events.some((e) => e.type === 'swing' && uruks().some((u) => u.id === e.actor));
      if (s.events.length > 200) s.events.length = 0;
    }
    expect(swung).toBe(true);
    disposeSim(s);
  });
});
