import { takeSnapshot, type SimSnapshot } from '../sim/snapshot';
import type { InputFrame, Sim } from '../sim/types';

/**
 * 입력 기록기 (계획서 M4 3번). 틱마다 입력을 쌓고, 2분마다 경량 체크포인트(스냅샷)를 찍는다.
 * 체크포인트는 최근 2개만 둔다 → 언제 쓰러져도 '60초 전'보다 앞선 체크포인트가 하나는 있다 (세션이 짧으면 시작 시점).
 * 오래된 체크포인트 앞의 입력은 버린다 → 메모리는 최대 4분치 입력(≈ 86KB) + 스냅샷 2개.
 */
export const CHECKPOINT_TICKS = 2 * 60 * 60;
export const SHOW_TICKS = 60 * 60;

type Checkpoint = { tick: number; snap: SimSnapshot };

export function createRecorder(sim: Sim) {
  let checkpoints: Checkpoint[] = [{ tick: sim.tick, snap: takeSnapshot(sim) }];
  let inputs: InputFrame[] = [];
  /** inputs[0]의 틱 */
  let base = sim.tick;

  return {
    /** stepSim 직전에: 이 틱에 넣을 입력 */
    record(sim: Sim, f: InputFrame) {
      if (sim.tick > checkpoints[checkpoints.length - 1]!.tick && (sim.tick - checkpoints[0]!.tick) % CHECKPOINT_TICKS === 0) {
        checkpoints.push({ tick: sim.tick, snap: takeSnapshot(sim) });
        if (checkpoints.length > 2) {
          const drop = checkpoints[1]!.tick - base;
          checkpoints = checkpoints.slice(1);
          inputs = inputs.slice(drop);
          base = checkpoints[0]!.tick;
        }
      }
      inputs.push({ ...f });
    },
    /** 재생 조각: '보여 줄 시작'(쓰러지기 60초 전)보다 앞선 가장 늦은 체크포인트 + 그 뒤 입력 전부 */
    clip(deathTick: number) {
      const showTick = Math.max(checkpoints[0]!.tick, deathTick - SHOW_TICKS);
      const cp = [...checkpoints].reverse().find((c) => c.tick <= showTick) ?? checkpoints[0]!;
      return { fromTick: cp.tick, showTick, snapshot: cp.snap, inputs: inputs.slice(cp.tick - base) };
    },
  };
}
