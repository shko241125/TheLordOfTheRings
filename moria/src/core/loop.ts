/** 시뮬레이션은 항상 1/60초 단위로만 진행한다. 렌더는 주사율대로 돌며 두 틱 사이를 보간한다. */
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
const DT_MS = 1000 / TICK_HZ;
/** 탭 복귀처럼 긴 공백 뒤 한 프레임에 몰아서 돌릴 최대 틱 수 (스텝 폭주 방지) */
export const MAX_STEPS_PER_FRAME = 5;
/** 이보다 긴 프레임 간격은 잘라낸다 (디버거 중단 등) */
const MAX_FRAME_MS = 250;

export type FixedStep = {
  /** 경과 ms를 넣으면 이번 프레임에 돌릴 틱 수와 보간 계수(0~1)를 돌려준다. */
  advance(frameMs: number): { steps: number; alpha: number };
};

export function createFixedStep(): FixedStep {
  let acc = 0;
  return {
    advance(frameMs) {
      acc += Math.min(Math.max(frameMs, 0), MAX_FRAME_MS);
      let steps = 0;
      while (acc >= DT_MS && steps < MAX_STEPS_PER_FRAME) {
        acc -= DT_MS;
        steps++;
      }
      // 상한에 걸렸으면 밀린 시간은 버린다 (따라잡으려다 더 느려지는 악순환 방지)
      if (acc >= DT_MS) acc = 0;
      return { steps, alpha: acc / DT_MS };
    },
  };
}
