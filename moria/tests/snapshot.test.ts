import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { damageCollapse } from '../src/sim/collapse';
import { TEST_ROOM, type Level } from '../src/sim/level';
import { hordeStart, scriptedInputs, trollStart } from '../src/sim/scripted';
import { createSim, disposeSim, hashSim, stepSim, type Sim } from '../src/sim/sim';
import { restoreSim, takeSnapshot } from '../src/sim/snapshot';
import { ZONE1 } from '../src/sim/zone1';

/**
 * 스냅샷 복원 정확성 (리플레이의 전제): 한 번에 쭉 돌린 실행과, 중간에 스냅샷을 찍어 새 시뮬레이션으로 되살려 이어 돌린 실행이
 * 같은 입력에서 같은 해시를 내야 한다. 전투·AI·던진 횃불·물결·트롤·공중의 붕괴 조각까지 들어간 순간에 찍는다.
 */
const SEED = 20260928;

function compare(level: Level, setup: (s: Sim) => void, at: number, total: number, midway?: (s: Sim) => void) {
  const inputs = scriptedInputs(SEED, total);
  const a = createSim(level, SEED);
  setup(a);
  let snap: ReturnType<typeof takeSnapshot> | null = null;
  const ha: number[] = [];
  for (let i = 0; i < total; i++) {
    if (i === at) snap = takeSnapshot(a);
    if (i === at - 20) midway?.(a);
    stepSim(a, inputs[i]!);
    a.events.length = 0;
    if (i >= at && i % 20 === 0) ha.push(hashSim(a));
  }
  const b = restoreSim(level, SEED, 'human', snap!);
  expect(b.tick).toBe(at);
  const hb: number[] = [];
  for (let i = at; i < total; i++) {
    stepSim(b, inputs[i]!);
    b.events.length = 0;
    if (i % 20 === 0) hb.push(hashSim(b));
  }
  disposeSim(a);
  disposeSim(b);
  return { ha, hb };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('스냅샷 → 복원 → 이어 돌리기 = 한 번에 돌리기', () => {
  it('시험 방: 전투·고블린 AI·던진 횃불·디렉터 물결 (40초 지점에서 찍고 20초 더)', () => {
    const { ha, hb } = compare(TEST_ROOM, () => {}, 2400, 3600);
    expect(hb).toEqual(ha);
  });

  it('구역 1 트롤전: 깨우기·내려찍기 한가운데', () => {
    const { ha, hb } = compare(ZONE1, trollStart, 1100, 1800);
    expect(hb).toEqual(ha);
  });

  it('구역 1 물결 + 공중의 붕괴 조각 (쓰러지기 20틱 뒤에 찍는다)', () => {
    const { ha, hb } = compare(ZONE1, hordeStart, 400, 900, (s) => damageCollapse(s, 0, 999));
    expect(hb).toEqual(ha);
  });

  it('−0·NaN을 잃지 않는다 (흐름장의 막힌 칸 NaN)', () => {
    const s = createSim(ZONE1, 1);
    s.player.vx = -0;
    const b = restoreSim(ZONE1, 1, 'human', takeSnapshot(s));
    expect(Object.is(b.player.vx, -0)).toBe(true);
    expect(Number.isNaN(b.horde!.field.height[0]!)).toBe(Number.isNaN(s.horde!.field.height[0]!));
    expect(b.horde!.field.height.filter(Number.isNaN).length).toBe(s.horde!.field.height.filter(Number.isNaN).length);
    [s, b].forEach(disposeSim);
  });
});
