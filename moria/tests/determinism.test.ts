import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { TEST_ROOM } from '../src/sim/level';
import { HORDE_TICKS, TROLL_TICKS, ZONE1_TICKS, hordeStart, scriptedInputs, trollStart, zone1Inputs } from '../src/sim/scripted';
import { ZONE1 } from '../src/sim/zone1';
import { createSim, disposeSim, hashSim, stepSim, type InputFrame } from '../src/sim/sim';
import golden from './golden/determinism.json';

/**
 * 결정성 회귀 테스트 (계획서 6장 기둥 3).
 * 같은 시드 + 같은 입력 → 60틱마다 같은 상태 해시. 이 테스트가 깨지면 리플레이·핏자국·시드 던전이 모두 깨진다.
 */
const TICKS = 600;
const SEED = 20260928;
const LONG_TICKS = 6000;

function run(inputs: InputFrame[]) {
  const sim = createSim(TEST_ROOM, SEED);
  const hashes: number[] = [];
  const t = sim.player.body.translation();
  const start = { x: t.x, y: t.y, z: t.z };
  for (let i = 0; i < inputs.length; i++) {
    stepSim(sim, inputs[i]!);
    if (sim.tick % 60 === 0) hashes.push(hashSim(sim));
  }
  const e = sim.player.body.translation();
  const end = { x: e.x, y: e.y, z: e.z };
  disposeSim(sim);
  return { hashes, start, end };
}

beforeAll(async () => {
  await RAPIER.init();
});

describe('결정성', () => {
  const inputs = scriptedInputs(SEED, TICKS);

  it('같은 입력을 두 번 돌리면 모든 체크포인트 해시가 같다', () => {
    const a = run(inputs);
    const b = run(inputs);
    expect(a.hashes).toHaveLength(TICKS / 60);
    expect(b.hashes).toEqual(a.hashes);
  });

  it('입력이 달라지면 해시가 갈라진다 (해시가 실제로 상태를 본다)', () => {
    // 한 틱만 바꾸면 그 틱에 공격·휘청임 중이라 이동 입력이 (정상적으로) 무시될 수 있다 → 1초 구간을 바꾼다
    const changed = inputs.map((f, i) => (i >= 100 && i < 160 ? { ...f, moveX: f.moveX === 127 ? -127 : 127 } : f));
    expect(run(changed).hashes).not.toEqual(run(inputs).hashes);
  });

  it('플레이어가 실제로 움직였다 (정지 상태 해시끼리 비교하는 헛검사 방지)', () => {
    const { start, end } = run(inputs);
    const d = Math.hypot(end.x - start.x, end.z - start.z);
    expect(d).toBeGreaterThan(1);
  });

  it('고정 기준값과 일치 (엔진·OS가 달라도 같아야 한다)', () => {
    expect(run(inputs).hashes).toEqual(golden.hashes);
  });

  it('긴 실행(100초): 북소리 예고와 디렉터 물결 스폰까지 결정적이다', () => {
    const long = scriptedInputs(SEED, LONG_TICKS);
    const sim = createSim(TEST_ROOM, SEED);
    const hashes: number[] = [];
    let waves = 0;
    for (const f of long) {
      stepSim(sim, f);
      for (const ev of sim.events.splice(0)) if (ev.type === 'wave') waves++;
      if (sim.tick % 600 === 0) hashes.push(hashSim(sim));
    }
    disposeSim(sim);
    expect(waves).toBeGreaterThan(0); // 이 실행 안에 물결이 실제로 나온다 (헛검사 방지)
    expect(hashes).toEqual(golden.longHashes);
  }, 60_000);

  it('구역 1 경로(문·디렉터·구역 내비메시) 해시가 골든과 같다 — 브라우저 자가진단(runDeterminism().zone1)과 같은 값', () => {
    const sim = createSim(ZONE1, SEED);
    const out: number[] = [];
    for (const f of zone1Inputs(SEED, ZONE1_TICKS)) {
      stepSim(sim, f);
      sim.events.length = 0;
      if (sim.tick % 300 === 0) out.push(hashSim(sim));
    }
    expect(sim.doors[0]!.open).toBe(true);
    disposeSim(sim);
    expect(out).toEqual((golden as { zone1?: number[] }).zone1);
  }, 120_000);

  it('트롤전(깨우기·내려찍기·기둥·유인) 해시가 골든과 같다 — runDeterminism().troll과 같은 값', () => {
    const sim = createSim(ZONE1, SEED);
    trollStart(sim);
    const out: number[] = [];
    for (const f of scriptedInputs(SEED, TROLL_TICKS)) {
      stepSim(sim, f);
      sim.events.length = 0;
      if (sim.tick % 180 === 0) out.push(hashSim(sim));
    }
    const troll = sim.enemies.find((e) => e.kind === 'troll')!;
    expect(troll.ai).not.toBe('patrol'); // 실제로 싸움이 일어났다
    disposeSim(sim);
    expect(out).toEqual((golden as { troll?: number[] }).troll);
  }, 120_000);

  it('물결(흐름장·빛 경계·승격·강등) 해시가 골든과 같다 — runDeterminism().horde와 같은 값', () => {
    const sim = createSim(ZONE1, SEED);
    hordeStart(sim);
    const out: number[] = [];
    let promoted = 0;
    for (const f of scriptedInputs(SEED, HORDE_TICKS)) {
      stepSim(sim, f);
      sim.events.length = 0;
      promoted = Math.max(promoted, sim.enemies.filter((e) => e.fromHorde).length);
      if (sim.tick % 120 === 0) out.push(hashSim(sim));
    }
    expect(promoted).toBeGreaterThan(0); // 실제로 승격이 일어났다
    disposeSim(sim);
    expect(out).toEqual((golden as { horde?: number[] }).horde);
  }, 120_000);
});
