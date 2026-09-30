import RAPIER from '@dimforge/rapier3d-compat';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeReplay, encodeReplay, packInputs, unpackInputs } from '../src/replay/codec';
import { deathLine, josa } from '../src/replay/book';
import { CHECKPOINT_TICKS, createRecorder, SHOW_TICKS } from '../src/replay/recorder';
import { TEST_ROOM } from '../src/sim/level';
import { scriptedInputs } from '../src/sim/scripted';
import { createSim, disposeSim, hashSim, stepSim } from '../src/sim/sim';
import { restoreSim } from '../src/sim/snapshot';

/** 마자르불의 책: 입력 코덱 왕복, 파일 왕복, 기록기 → 재생 = 원래 결말, 책 문장 */
beforeAll(async () => {
  await RAPIER.init();
});

describe('리플레이', () => {
  it('입력 6바이트 델타 왕복 (음수 이동·큰 버튼 비트·yaw 4095)', () => {
    const frames = scriptedInputs(3, 500);
    frames.push({ buttons: 0x1fff, moveX: -127, moveY: 127, yaw: 4095 });
    const packed = packInputs(frames);
    expect(packed.length).toBe(frames.length * 6);
    expect(unpackInputs(packed)).toEqual(frames);
  });

  it('기록기: 4분 넘게 돌아도 체크포인트는 최근 2개, 재생 조각은 쓰러지기 60초 전보다 앞선 체크포인트에서 시작', () => {
    const sim = createSim(TEST_ROOM, 7);
    const rec = createRecorder(sim);
    const inputs = scriptedInputs(7, CHECKPOINT_TICKS * 2 + 3000);
    for (const f of inputs) {
      rec.record(sim, f);
      stepSim(sim, f);
      sim.events.length = 0;
    }
    const clip = rec.clip(sim.tick);
    expect(clip.showTick).toBe(sim.tick - SHOW_TICKS);
    expect(clip.fromTick).toBeLessThanOrEqual(clip.showTick);
    expect(clip.fromTick % CHECKPOINT_TICKS).toBe(0);
    expect(clip.inputs.length).toBe(sim.tick - clip.fromTick);
    disposeSim(sim);
  }, 120_000);

  it('파일 왕복 후 재생하면 원래 실행과 같은 결말 (해시)', async () => {
    const sim = createSim(TEST_ROOM, 11);
    const rec = createRecorder(sim);
    const inputs = scriptedInputs(11, CHECKPOINT_TICKS + 1500);
    for (const f of inputs) {
      rec.record(sim, f);
      stepSim(sim, f);
      sim.events.length = 0;
    }
    const end = hashSim(sim);
    const clip = rec.clip(sim.tick);
    const bytes = await encodeReplay({
      header: { v: 1, simVersion: __SIM_VERSION__, zone: 'test', seed: 11, classId: 'human', fromTick: clip.fromTick, showTick: clip.showTick, deathTick: sim.tick, line: 'x' },
      snapshot: clip.snapshot,
      inputs: clip.inputs,
    });
    const r = await decodeReplay(bytes);
    expect(r.header.fromTick).toBe(clip.fromTick);
    const b = restoreSim(TEST_ROOM, 11, 'human', r.snapshot);
    for (const f of r.inputs) {
      stepSim(b, f);
      b.events.length = 0;
    }
    expect(b.tick).toBe(sim.tick);
    expect(hashSim(b)).toBe(end);
    // 크기: 입력은 델타 + deflate로 크게 준다
    expect(bytes.length).toBeLessThan(clip.snapshot.world.length + clip.snapshot.state.length + clip.inputs.length * 6);
    [sim, b].forEach(disposeSim);
  }, 120_000);

  it('책 문장: 받침에 맞는 조사, 같은 틱이면 같은 문장', () => {
    expect(josa('고블린들', '이')).toBe('고블린들이');
    expect(josa('무언가', '이')).toBe('무언가가');
    expect(josa('드워프', '을')).toBe('드워프를');
    expect(josa('사람', '은')).toBe('사람은');
    for (let t = 0; t < 16; t++) {
      const l = deathLine(t, 'unknown', '기둥 홀', 'dwarf');
      expect(l).not.toMatch(/[{}]/);
      expect(l).not.toMatch(/무언가이|무언가을|무언가은|드워프을|드워프은/);
    }
    expect(deathLine(5, 'troll', '트롤 굴', 'human')).toBe(deathLine(5, 'troll', '트롤 굴', 'human'));
  });
});
