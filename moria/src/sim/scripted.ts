import { createRng } from '../core/rng';
import { ANGLE_STEPS } from '../core/trig';
import {
  BTN_CROUCH, BTN_DODGE, BTN_HEAVY, BTN_LIGHT, BTN_LOCK, BTN_PARRY, BTN_SENSE, BTN_SPRINT, BTN_THROW, BTN_TORCH, type InputFrame,
} from './types';

/**
 * 결정성 검증용 입력 스크립트. 사람이 조작하는 것처럼 30~90틱마다 방향·속도(아날로그 포함)·질주·웅크리기를
 * 바꾸고 시점을 돌린다. 틈틈이 공격·강공격 차지·회피·패링·락온·돌의 감각·횃불 던지기도 누른다 → 전투·AI·동적 물리까지 해시에 들어간다.
 * Node 테스트와 브라우저 자가진단이 같은 함수를 써서 결과 해시를 비교한다.
 */
export function scriptedInputs(seed: number, ticks: number): InputFrame[] {
  const rng = createRng(seed);
  const out: InputFrame[] = [];
  let yaw = 0;
  let turn = 0;
  let frame: InputFrame = { buttons: 0, moveX: 0, moveY: 127, yaw };
  let hold = 0;
  let pressLeft = 0;
  let pressBits = 0;
  for (let i = 0; i < ticks; i++) {
    if (hold-- <= 0) {
      hold = 30 + rng.int(61);
      const dir = [-127, -60, 0, 60, 127] as const; // ±60 = 스틱 반 기울기(걷기)
      const r = rng.next();
      frame = {
        buttons: r < 0.25 ? BTN_SPRINT : r < 0.35 ? BTN_CROUCH : 0,
        moveX: dir[rng.int(5)]!,
        moveY: dir[rng.int(5)]!,
        yaw,
      };
      turn = rng.int(41) - 20; // 틱당 -20..20 (정수 각도)
    }
    // 전투 입력: 평균 12틱마다 하나
    if (pressLeft <= 0 && rng.next() < 1 / 12) {
      const k = rng.next();
      if (k < 0.45) { pressBits = BTN_LIGHT; pressLeft = 1 + rng.int(3); }
      else if (k < 0.55) { pressBits = BTN_HEAVY; pressLeft = 12 + rng.int(40); }
      else if (k < 0.72) { pressBits = BTN_DODGE; pressLeft = 1; }
      else if (k < 0.82) { pressBits = BTN_PARRY; pressLeft = 2; }
      else if (k < 0.88) { pressBits = BTN_LOCK; pressLeft = 1; }
      else if (k < 0.92) { pressBits = BTN_SENSE; pressLeft = 1; }
      else if (k < 0.97) { pressBits = BTN_TORCH; pressLeft = 1; }
      else { pressBits = BTN_THROW; pressLeft = 1; }
    }
    const extra = pressLeft-- > 0 ? pressBits : 0;
    yaw = (yaw + turn + ANGLE_STEPS) % ANGLE_STEPS;
    out.push({ ...frame, buttons: frame.buttons | extra, yaw });
  }
  return out;
}
