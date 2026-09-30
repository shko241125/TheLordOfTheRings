import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { progressOf, restoreProgress } from '../src/sim/interact';
import type { Level } from '../src/sim/level';
import { migrate } from '../src/save';
import { BTN_PARRY, createSim, disposeSim, stepSim, type Enemy, type InputFrame, type Sim } from '../src/sim/sim';
import { TROLL_HP, TROLL_SLAM, TROLL_SWEEP } from '../src/sim/troll';

/** 동굴 트롤 규칙 (계획서 9장): 예고 1초 내려찍기(패링 불가)·기둥 파괴·기둥 뒤 휘두르기 차단·빛 유인·귀환 */

// 넓은 바닥 + 기둥 하나(0, −4). 트롤은 (0, −9)에서 잔다. 플레이어 스폰 (0, 1, 6)
const ARENA: Level = {
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [40, 0.5, 40], surface: 'floor' },
    { kind: 'cylinder', pos: [0, 5, -4], radius: 1, halfHeight: 5, surface: 'stone' },
  ],
  torches: [],
  spawn: [0, 1.2, 6],
  bosses: [{ kind: 'troll', pos: [0, 1.8, -9] }],
  breakable: [1],
};

const idle = (buttons = 0): InputFrame => ({ buttons, moveX: 0, moveY: 0, yaw: 0 });
const run = (sim: Sim, f: InputFrame, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepSim(sim, f);
};
const troll = (sim: Sim): Enemy => sim.enemies.find((e) => e.kind === 'troll')!;
const put = (sim: Sim, who: 'player' | Enemy, x: number, z: number, y = who === 'player' ? 1.2 : 1.8) =>
  (who === 'player' ? sim.player.body : who.body).setTranslation({ x, y, z }, true);
/** 공격을 직접 시작시킨다 (기술 선택 난수와 무관하게 규칙만 검사) */
const force = (e: Enemy, move: 'slam' | 'sweep') => {
  e.ai = 'attack';
  e.aiTick = 0;
  e.move = move;
  e.swingTick = 0;
  e.hitSet.clear();
};

beforeAll(async () => {
  await RAPIER.init();
});

describe('동굴 트롤', () => {
  it('자다가, 횃불 든 플레이어가 다가오면 깬다. 깨어 있는 동안 디렉터는 쉰다', () => {
    const sim = createSim(ARENA, 1);
    run(sim, idle(), 60);
    expect(troll(sim).ai).toBe('patrol');
    put(sim, 'player', 5, -9); // 기둥에 가리지 않는 옆자리
    run(sim, idle(), 240);
    expect(troll(sim).ai).not.toBe('patrol');
    const t0 = sim.director.phaseTick;
    run(sim, idle(), 30);
    expect(sim.director.phaseTick).toBe(t0);
    disposeSim(sim);
  });

  it('내려찍기: 예고 1초 뒤 맞고, 패링으로는 못 막는다 (피해 40)', () => {
    const sim = createSim(ARENA, 2);
    const e = troll(sim);
    put(sim, 'player', 0, -11); // 트롤 뒤쪽(+Z 반대)… 트롤은 −Z를 보므로 앞 = −Z
    run(sim, idle(), 20);
    e.facing = 0;
    force(e, 'slam');
    const hp0 = sim.player.hp;
    run(sim, idle(BTN_PARRY), TROLL_SLAM.windup - 12); // 패링 버튼 유지 (창은 이미 지났다)
    stepSim(sim, idle());
    stepSim(sim, idle(BTN_PARRY)); // 충격 직전에 새로 패링
    run(sim, idle(), 12);
    expect(sim.player.hp).toBe(hp0 - TROLL_SLAM.damage);
    expect(sim.events.some((x) => x.type === 'slam')).toBe(true);
    disposeSim(sim);
  });

  it('기둥을 내려찍으면 기둥이 부서지고 트롤이 오래 휘청인다', () => {
    const sim = createSim(ARENA, 3);
    const e = troll(sim);
    put(sim, e, 0, -6.4); // 기둥(0,−4)을 향해 2.4m
    put(sim, 'player', 0, 4);
    run(sim, idle(), 20);
    e.facing = 2048; // +Z를 본다 → 겨냥점 ≈ 기둥
    force(e, 'slam');
    run(sim, idle(), TROLL_SLAM.windup + 2);
    expect(sim.pillars[0]!.body).toBeNull();
    expect(sim.events.some((x) => x.type === 'pillar')).toBe(true);
    expect(e.ai).toBe('stagger');
    expect(e.staggerLen).toBeGreaterThanOrEqual(120);
    disposeSim(sim);
  });

  it('휘두르기는 기둥 뒤에 있으면 막히고, 트인 곳에서는 맞는다', () => {
    const hit = (behind: boolean) => {
      const sim = createSim(ARENA, 4);
      const e = troll(sim);
      put(sim, e, 0, -7);
      put(sim, 'player', behind ? 0 : 3, behind ? -1.4 : -7); // 기둥(0,−4) 뒤 / 옆 트인 곳, 둘 다 3~5.6m 안
      run(sim, idle(), 20);
      e.facing = behind ? 2048 : 3072; // 플레이어 쪽
      force(e, 'sweep');
      const hp0 = sim.player.hp;
      run(sim, idle(), TROLL_SWEEP.windup + TROLL_SWEEP.active + 2);
      const lost = hp0 - sim.player.hp;
      disposeSim(sim);
      return lost;
    };
    expect(hit(false)).toBe(TROLL_SWEEP.damage);
    expect(hit(true)).toBe(0);
  });

  it('빛에 끌린다: 플레이어가 멀면 가까운 바닥 횃불로 가서 내려찍어 끈다', () => {
    const sim = createSim(ARENA, 5);
    const e = troll(sim);
    put(sim, 'player', 12, 10);
    run(sim, idle(), 20);
    e.ai = 'chase';
    // 들고 있던 횃불을 트롤 옆 6m에 떨어뜨린 것으로
    const t = sim.torches[0]!;
    sim.player.heldTorch = -1;
    t.state = 'ground';
    [t.x, t.y, t.z] = [6, 0.1, -9];
    run(sim, idle(), 60 * 8);
    expect(sim.torches.length).toBe(0);
    expect(sim.player.hp).toBe(sim.player.maxHp);
    disposeSim(sim);
  });

  it('너무 멀리 끌려가면 집으로 돌아가 체력을 되찾는다', () => {
    const sim = createSim(ARENA, 6);
    const e = troll(sim);
    run(sim, idle(), 20);
    e.ai = 'chase';
    e.hp = 100;
    put(sim, e, 0, 20); // 집(0,−9)에서 29m
    put(sim, 'player', 0, 34);
    run(sim, idle(), 60 * 20);
    expect(e.ai).toBe('patrol');
    expect(e.hp).toBe(TROLL_HP);
    disposeSim(sim);
  });

  it('쓰러뜨린 보스는 저장되고, 복원하면 쓰러진 채로 시작한다 (저장 v1 → v2 이전 포함)', () => {
    const a = createSim(ARENA, 7);
    const e = troll(a);
    e.hp = 0;
    e.ai = 'dead';
    expect(progressOf(a).bossesDown).toEqual([0]);
    const b = createSim(ARENA, 7);
    restoreProgress(b, progressOf(a));
    expect(troll(b).ai).toBe('dead');
    expect(migrate({ v: 1, classId: 'dwarf', progress: { doorsOpen: [0], lit: [1], checkpoint: 1 } })).toEqual({
      v: 2, classId: 'dwarf', progress: { doorsOpen: [0], lit: [1], checkpoint: 1, bossesDown: [] },
    });
    expect(migrate({ v: 3 })).toBeNull();
    expect(migrate({ v: 2, classId: 'orc', progress: {} })).toBeNull();
    [a, b].forEach(disposeSim);
  });
});
