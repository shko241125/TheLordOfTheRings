import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DODGE_IFRAME_FROM, GOBLIN_ATTACK, HEAVY, HEAVY_CHARGE_MAX, LIGHT_COMBO, attackLength, heavyDamage, inArc,
} from '../src/sim/combat';
import { GOBLIN_HP, MAX_TOKENS } from '../src/sim/enemy';
import type { Level } from '../src/sim/level';
import { lightAt, noiseAt } from '../src/sim/perception';
import {
  BTN_DODGE, BTN_HEAVY, BTN_LIGHT, BTN_PARRY, BTN_SENSE, BTN_THROW, BTN_TORCH, createSim, disposeSim, stepSim, type InputFrame, type Sim,
} from '../src/sim/sim';

/**
 * 전투 규칙을 숫자로 고정한다 (계획서 9장·6장). 조작감 튜닝은 수치만 바꾸고, 규칙의 퇴행은 여기서 막는다.
 */

const ARENA = (enemies: Level['enemies'] = []): Level => ({
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [40, 0.5, 40], surface: 'floor' },
    { kind: 'box', pos: [0, 2, -30.5], half: [40, 2, 0.5], surface: 'wall' },
  ],
  torches: [],
  spawn: [0, 1.0, 0],
  enemies,
});

const idle: InputFrame = { buttons: 0, moveX: 0, moveY: 0, yaw: 0 };
const btn = (b: number): InputFrame => ({ ...idle, buttons: b });
function run(sim: Sim, frames: InputFrame[] | InputFrame, n = 1) {
  const list = Array.isArray(frames) ? frames : Array(n).fill(frames);
  for (const f of list) stepSim(sim, f);
}
function settle(sim: Sim) {
  run(sim, idle, 20);
  sim.events.length = 0;
}
/** 적을 플레이어 앞 d미터에 세우고, 눈치채지 못한 상태(순찰, 제자리 순찰점)로 둔다 */
function oneGoblinAhead(d: number): Sim {
  const sim = createSim(ARENA([{ pos: [0, 1, -d], patrol: [[0, 1, -d]] }]), 1);
  // 플레이어 횃불을 끄고(내려놓지 않고 제거) 시작 — 감지 테스트가 아닌 경우 적이 먼저 덤비지 않게
  sim.torches.length = 0;
  sim.player.heldTorch = -1;
  settle(sim);
  return sim;
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('수치 규칙', () => {
  it('강공격 피해는 차지에 따라 1.0~1.8배', () => {
    expect(heavyDamage(0)).toBe(HEAVY.damage);
    expect(heavyDamage(HEAVY_CHARGE_MAX)).toBe(Math.round(HEAVY.damage * 1.8));
  });

  it('부채꼴 판정: 앞은 맞고, 뒤·사거리 밖·높이 차는 빗나간다', () => {
    const a = LIGHT_COMBO[0]!;
    // 앞(−Z) 1.5m
    expect(inArc(0, 1, 0, 0, 0, 1, -1.5, 0.3, a.reach, a.halfArc)).toBe(true);
    expect(inArc(0, 1, 0, 0, 0, 1, 1.5, 0.3, a.reach, a.halfArc)).toBe(false);
    expect(inArc(0, 1, 0, 0, 0, 1, -3, 0.3, a.reach, a.halfArc)).toBe(false);
    expect(inArc(0, 1, 0, 0, 0, 2.5, -1.5, 0.3, a.reach, a.halfArc)).toBe(false);
  });

  it('고블린 공격 예고(예비 동작)는 0.5초 — 반응할 시간이 있다', () => {
    expect(GOBLIN_ATTACK.windup / 60).toBeGreaterThanOrEqual(0.45);
  });
});

describe('감지 필드', () => {
  it('lightAt: 광원 가까이 밝고 멀면 0, 1을 넘지 않는다', () => {
    const L = [{ x: 0, y: 1, z: 0, intensity: 1, range: 8 }, { x: 1, y: 1, z: 0, intensity: 1, range: 8 }];
    expect(lightAt(0, 1, 0, L)).toBe(1);
    expect(lightAt(20, 1, 0, L)).toBe(0);
    // x=7: 1·(1−49/64) + 1·(1−36/64) ≈ 0.67 (x=5면 두 광원 합이 1.36이라 1로 잘린다)
    expect(lightAt(7, 1, 0, L)).toBeCloseTo((1 - 49 / 64) + (1 - 36 / 64), 5);
    expect(lightAt(7, 1, 0, L)).toBeLessThan(1);
  });

  it('noiseAt: 시간이 지나고 멀어질수록 작아진다', () => {
    const ev = [{ x: 0, y: 0, z: 0, tick: 0, ttl: 30, radius: 10, loudness: 1 }];
    expect(noiseAt(0, 0, 0, ev, 0)).toBe(1);
    expect(noiseAt(0, 0, 0, ev, 15)).toBeCloseTo(0.5);
    expect(noiseAt(5, 0, 0, ev, 0)).toBeCloseTo(0.75);
    expect(noiseAt(0, 0, 0, ev, 30)).toBe(0);
  });

  it('횃불을 들면 멀리서 들키고, 끄면 훨씬 가까이 가야 들킨다 (빛의 도박)', () => {
    const detectDistance = (withTorch: boolean) => {
      // 고블린은 −Z 방향 멀리서 플레이어 쪽(+Z)을 바라본다. 플레이어가 천천히(걷기) 다가간다.
      const sim = createSim(ARENA([{ pos: [0, 1, -24], patrol: [[0, 1, -24]] }]), 3);
      const g = sim.enemies[0]!;
      g.facing = 2048; // +Z를 본다
      if (!withTorch) {
        sim.torches.length = 0;
        sim.player.heldTorch = -1;
      }
      settle(sim);
      const walk: InputFrame = { buttons: 0, moveX: 0, moveY: 60, yaw: 0 }; // 반 기울기 = 걷기
      for (let i = 0; i < 3000; i++) {
        stepSim(sim, walk);
        g.facing = 2048;
        if (g.ai === 'chase' || g.ai === 'engage' || g.ai === 'attack') {
          const d = sim.player.body.translation().z - g.body.translation().z;
          disposeSim(sim);
          return d;
        }
      }
      disposeSim(sim);
      return 0;
    };
    const lit = detectDistance(true);
    const dark = detectDistance(false);
    expect(lit).toBeGreaterThan(8);
    expect(dark).toBeLessThan(lit * 0.5);
    expect(dark).toBeGreaterThan(0); // 코앞의 기척으로는 결국 들킨다
  });
});

describe('플레이어 전투', () => {
  it('약공격: 사거리 안 적을 판정 구간에서 한 번만 맞힌다 (횃불 없는 어둠 → 빛의 도박 1.5배)', () => {
    const sim = oneGoblinAhead(1.4);
    const g = sim.enemies[0]!;
    run(sim, [btn(BTN_LIGHT), ...Array(40).fill(idle)]);
    expect(g.hp).toBe(GOBLIN_HP - Math.round(LIGHT_COMBO[0]!.damage * 1.5));
    expect(sim.events.filter((e) => e.type === 'hit')).toHaveLength(1);
    disposeSim(sim);
  });

  it('4타 콤보: 판정 뒤 누르면 이어지고, 3번 맞으면 고블린이 죽는다', () => {
    const sim = oneGoblinAhead(1.4);
    const g = sim.enemies[0]!;
    const frames: InputFrame[] = [];
    for (let k = 0; k < 3; k++) frames.push(btn(BTN_LIGHT), ...Array(14).fill(idle));
    run(sim, [...frames, ...Array(60).fill(idle)]);
    expect(g.ai).toBe('dead');
    expect(sim.events.some((e) => e.type === 'death')).toBe(true);
    disposeSim(sim);
  });

  it('입력 버퍼(150ms): 캔슬이 열리기 9틱 안에 누른 회피는 버려지지 않고 열리는 순간 나간다', () => {
    const sim = oneGoblinAhead(10);
    const p = sim.player;
    run(sim, btn(BTN_LIGHT));
    // 회피 캔슬은 판정 끝 +2틱(=13틱)부터. 6틱째(예비 동작 중)에 누르면 7틱 뒤 → 버퍼(9틱) 안
    run(sim, [idle, idle, idle, idle, idle, btn(BTN_DODGE)]);
    expect(p.action).toBe('attack');
    run(sim, idle, 8);
    expect(p.action).toBe('dodge');
    disposeSim(sim);
  });

  it('입력 버퍼는 150ms를 넘기면 버린다 (너무 이른 입력이 한참 뒤에 나가지 않게)', () => {
    const sim = oneGoblinAhead(10);
    const p = sim.player;
    run(sim, [btn(BTN_LIGHT), idle, btn(BTN_DODGE)]); // 캔슬까지 11틱 남음 → 버퍼 초과
    run(sim, idle, 30);
    expect(p.action).not.toBe('dodge');
    disposeSim(sim);
  });

  it('회피 무적: 고블린 공격이 무적 구간에 닿으면 피해가 없다', () => {
    const sim = oneGoblinAhead(1.2);
    const g = sim.enemies[0]!;
    // 고블린을 강제로 공격 상태로: 판정 직전까지 진행
    g.ai = 'attack'; g.aiTick = 0; g.hasToken = true; sim.tokens = 1; g.swingTick = GOBLIN_ATTACK.windup - DODGE_IFRAME_FROM - 2;
    g.facing = 2048; // 플레이어(+Z) 쪽
    const hp = sim.player.hp;
    run(sim, [btn(BTN_DODGE), ...Array(20).fill(idle)]);
    expect(sim.player.hp).toBe(hp);
    disposeSim(sim);
  });

  it('패링: 창 안에 맞으면 피해 없이 고블린이 오래 휘청이고, 다음 공격은 2.5배', () => {
    const sim = oneGoblinAhead(1.2);
    const g = sim.enemies[0]!;
    g.ai = 'attack'; g.aiTick = 0; g.hasToken = true; sim.tokens = 1; g.swingTick = GOBLIN_ATTACK.windup - 6;
    g.facing = 2048;
    const hp = sim.player.hp;
    run(sim, [btn(BTN_PARRY), ...Array(8).fill(idle)]);
    expect(sim.player.hp).toBe(hp);
    expect(g.ai).toBe('stagger');
    expect(sim.events.some((e) => e.type === 'parry')).toBe(true);
    // 반격
    run(sim, idle, 24);
    run(sim, [btn(BTN_LIGHT), ...Array(30).fill(idle)]);
    expect(g.hp).toBe(Math.max(0, GOBLIN_HP - Math.round(LIGHT_COMBO[0]!.damage * 2.5 * 1.5)));
    disposeSim(sim);
  });

  it('맞으면 체력이 줄고 휘청인다', () => {
    const sim = oneGoblinAhead(1.2);
    const g = sim.enemies[0]!;
    g.ai = 'attack'; g.aiTick = 0; g.hasToken = true; sim.tokens = 1; g.swingTick = GOBLIN_ATTACK.windup - 2;
    g.facing = 2048;
    run(sim, idle, 10);
    expect(sim.player.hp).toBe(100 - GOBLIN_ATTACK.damage);
    expect(['stagger', 'free']).toContain(sim.player.action);
    disposeSim(sim);
  });

  it('스태미나가 바닥나면 회피가 나가지 않는다', () => {
    const sim = oneGoblinAhead(10);
    sim.player.stamina = 0;
    sim.player.staminaRegenAt = sim.tick + 1000;
    run(sim, btn(BTN_DODGE));
    run(sim, idle, 12);
    expect(sim.player.action).toBe('free');
    disposeSim(sim);
  });

  it('강공격: 누르고 있으면 차지하고, 떼면 나간다', () => {
    const sim = oneGoblinAhead(1.5);
    const g = sim.enemies[0]!;
    run(sim, btn(BTN_HEAVY), 40);
    expect(sim.player.charging).toBe(true);
    run(sim, idle, attackLength(HEAVY) + 4);
    expect(g.hp).toBeLessThan(GOBLIN_HP - HEAVY.damage + 1);
    disposeSim(sim);
  });
});

describe('빛의 도박', () => {
  it('같은 공격이 횃불을 들면 1.0배, 어둠에서는 1.5배', () => {
    const hit = (withTorch: boolean) => {
      const sim = createSim(ARENA([{ pos: [0, 1, -1.4], patrol: [[0, 1, -1.4]] }]), 1);
      if (!withTorch) {
        sim.torches.length = 0;
        sim.player.heldTorch = -1;
      }
      settle(sim);
      const g = sim.enemies[0]!;
      run(sim, [btn(BTN_LIGHT), ...Array(30).fill(idle)]);
      const dmg = GOBLIN_HP - g.hp;
      disposeSim(sim);
      return dmg;
    };
    expect(hit(true)).toBe(LIGHT_COMBO[0]!.damage);
    expect(hit(false)).toBe(Math.round(LIGHT_COMBO[0]!.damage * 1.5));
  });
});

describe('돌의 감각', () => {
  it('V: 음파 사건과 15m 소음을 내고, 8초 쿨다운 동안은 다시 안 된다', () => {
    const sim = createSim(ARENA(), 1);
    settle(sim);
    run(sim, [btn(BTN_SENSE), idle]);
    expect(sim.events.filter((e) => e.type === 'sense')).toHaveLength(1);
    expect(sim.noise.some((n) => n.radius === 15)).toBe(true);
    run(sim, [btn(BTN_SENSE), idle]);
    expect(sim.events.filter((e) => e.type === 'sense')).toHaveLength(1);
    run(sim, idle, 8 * 60);
    run(sim, [btn(BTN_SENSE), idle]);
    expect(sim.events.filter((e) => e.type === 'sense')).toHaveLength(2);
    disposeSim(sim);
  });
});

describe('횃불', () => {
  it('F 짧게: 내려놓기 → 다시 줍기, 빈손이면 예비 횃불', () => {
    const sim = createSim(ARENA(), 1);
    settle(sim);
    const p = sim.player;
    expect(p.heldTorch).toBeGreaterThanOrEqual(0);
    run(sim, [btn(BTN_TORCH), idle]);
    expect(p.heldTorch).toBe(-1);
    expect(sim.torches[0]!.state).toBe('ground');
    run(sim, [btn(BTN_TORCH), idle]);
    expect(p.heldTorch).toBe(sim.torches[0]!.id); // 발 앞의 횃불을 주웠다
    disposeSim(sim);
  });

  it('F 길게: 던진 횃불은 날아가 떨어지고, 줍지 못하고, 40초 뒤 꺼진다', () => {
    const sim = createSim(ARENA(), 1);
    settle(sim);
    run(sim, [btn(BTN_THROW), idle]);
    const t = sim.torches[0]!;
    expect(t.thrown).toBe(true);
    run(sim, idle, 180);
    expect(t.state).toBe('ground');
    const z = sim.player.body.translation().z - t.z;
    expect(z).toBeGreaterThan(3); // 앞으로 날아갔다
    const spare = sim.player.spareTorches;
    run(sim, [btn(BTN_TORCH), idle]); // 줍기 대신 예비 횃불을 켠다
    expect(sim.player.spareTorches).toBe(spare - 1);
    run(sim, idle, 40 * 60);
    expect(sim.torches.some((x) => x.id === t.id)).toBe(false);
    disposeSim(sim);
  });
});

describe('무리 행동', () => {
  it('고블린 6마리가 둘러싸도 동시에 공격하는 것은 최대 2마리', () => {
    const ring = Array.from({ length: 6 }, (_, i) => {
      const x = [-3, 3, -3, 3, 0, 0][i]!, z = [-2, -2, 2, 2, -4, 4][i]!;
      return { pos: [x, 1, z] as const, patrol: [[x, 1, z] as const] };
    });
    const sim = createSim(ARENA(ring), 5);
    settle(sim);
    for (const e of sim.enemies) { e.awareness = 1; e.ai = 'chase'; }
    let maxAttackers = 0;
    let attacks = 0;
    for (let i = 0; i < 1200; i++) {
      stepSim(sim, idle);
      const n = sim.enemies.filter((e) => e.ai === 'attack').length;
      maxAttackers = Math.max(maxAttackers, n);
      expect(sim.tokens).toBe(n);
      if (sim.player.action === 'dead') break;
    }
    attacks = sim.events.filter((e) => e.type === 'swing' && e.actor >= 0).length;
    expect(maxAttackers).toBeLessThanOrEqual(MAX_TOKENS);
    expect(maxAttackers).toBe(MAX_TOKENS); // 실제로 두 마리가 붙는 순간이 있다
    expect(attacks).toBeGreaterThan(0);
    disposeSim(sim);
  });
});
