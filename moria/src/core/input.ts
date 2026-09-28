import { radToAngle } from './trig';
import {
  BTN_CROUCH, BTN_DODGE, BTN_HEAVY, BTN_LIGHT, BTN_LOCK, BTN_PARRY, BTN_SENSE, BTN_SPRINT, BTN_THROW, BTN_TORCH, type InputFrame,
} from '../sim/types';

const MOUSE_SENS = 0.0022; // rad/px
const PAD_LOOK_SPEED = 3.2; // rad/s (오른쪽 스틱 끝까지)
const PAD_DEADZONE = 0.18;
const PITCH_MIN = -1.1;
const PITCH_MAX = 0.55;
/**
 * 탭/홀드 판정 (소울류 관례): Space(패드 B)는 짧게 = 회피, 길게 = 질주. F(패드 십자키 위)는 짧게 = 내려놓기·줍기,
 * 길게 = 던지기. 탭은 뗄 때 판정하므로 회피가 이만큼 늦게 나간다 → 시뮬레이션 입력 버퍼(150ms)가 흡수한다.
 */
const HOLD_MS = 180;
const THROW_HOLD_MS = 250;

/** 원형 데드존 + 재정규화: 데드존 밖을 0..1로 다시 펴서 미세 조작을 살린다 */
function stick(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < PAD_DEADZONE) return [0, 0];
  const k = Math.min(1, (m - PAD_DEADZONE) / (1 - PAD_DEADZONE)) / m;
  return [x * k, y * k];
}

/** 누른 시각을 기억해 탭/홀드를 가르는 버튼 */
function tapHold(holdMs: number) {
  let downAt = -1;
  let fired = false; // 홀드 동작을 이미 냈는가
  return {
    down(now: number) {
      if (downAt < 0) {
        downAt = now;
        fired = false;
      }
    },
    /** 뗄 때: 짧았으면 true (탭) */
    up(now: number): boolean {
      const tap = downAt >= 0 && !fired && now - downAt < holdMs;
      downAt = -1;
      return tap;
    },
    held: (now: number) => downAt >= 0 && now - downAt >= holdMs,
    /** 홀드 순간에 한 번만 true */
    holdOnce(now: number): boolean {
      if (downAt >= 0 && !fired && now - downAt >= holdMs) {
        fired = true;
        return true;
      }
      return false;
    },
    reset() {
      downAt = -1;
    },
  };
}

/**
 * 키보드·마우스·게임패드 → InputFrame. 카메라 각도(라디안)는 렌더 쪽 상태이고,
 * 시뮬레이션에는 틱마다 정수로 양자화한 값만 넘긴다. 한 틱짜리 펄스(회피·락온·횃불)는 다음 sample()에 한 번 실린다.
 */
export function createInput(target: HTMLElement) {
  const keys = new Set<string>();
  const mouse = new Set<number>();
  const view = { yaw: 0, pitch: -0.28 };
  let crouch = false;
  let pulses = 0;
  const space = tapHold(HOLD_MS);
  const fKey = tapHold(THROW_HOLD_MS);
  const padB = tapHold(HOLD_MS);
  const padUp = tapHold(THROW_HOLD_MS);
  const padPrev = new Map<number, boolean>();
  let lastPadPoll = performance.now();
  let pad: { lx: number; ly: number; buttons: (i: number) => boolean } | null = null;

  const onDown = (e: KeyboardEvent) => {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault(); // 페이지 스크롤·포커스 이동 방지
    if (e.repeat) return;
    keys.add(e.code);
    const now = performance.now();
    if (e.code === 'KeyC') crouch = !crouch;
    if (e.code === 'Space') space.down(now);
    if (e.code === 'KeyF') fKey.down(now);
    if (e.code === 'KeyV') pulses |= BTN_SENSE;
  };
  const onUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
    const now = performance.now();
    if (e.code === 'Space' && space.up(now)) pulses |= BTN_DODGE;
    if (e.code === 'KeyF' && fKey.up(now)) pulses |= BTN_TORCH;
  };
  const onBlur = () => {
    keys.clear(); // 창 전환 시 키가 눌린 채 남지 않게
    mouse.clear();
    space.reset();
    fKey.reset();
  };
  const onMouse = (e: MouseEvent) => {
    if (document.pointerLockElement !== target) return;
    view.yaw -= e.movementX * MOUSE_SENS;
    view.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, view.pitch - e.movementY * MOUSE_SENS));
  };
  const onMouseDown = (e: MouseEvent) => {
    if (document.pointerLockElement !== target) return;
    mouse.add(e.button);
    if (e.button === 1) pulses |= BTN_LOCK;
  };
  const onMouseUp = (e: MouseEvent) => mouse.delete(e.button);
  const onContext = (e: Event) => e.preventDefault();

  window.addEventListener('keydown', onDown);
  window.addEventListener('keyup', onUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouse);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  target.addEventListener('contextmenu', onContext);

  const axis = (neg: string, pos: string) => (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);

  /** 렌더 프레임마다: 패드 읽기 + 오른쪽 스틱 시점 + 패드 탭/홀드 */
  function pollPad(now: number) {
    const dt = Math.min(0.1, (now - lastPadPoll) / 1000);
    lastPadPoll = now;
    const g = navigator.getGamepads?.().find((x) => x?.mapping === 'standard') ?? null;
    if (!g) return null;
    const [lx, ly] = stick(g.axes[0] ?? 0, g.axes[1] ?? 0);
    const [rx, ry] = stick(g.axes[2] ?? 0, g.axes[3] ?? 0);
    view.yaw -= rx * PAD_LOOK_SPEED * dt;
    view.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, view.pitch - ry * PAD_LOOK_SPEED * 0.7 * dt));
    const pressed = (i: number) => g.buttons[i]?.pressed ?? false;
    const edge = (i: number) => {
      const now2 = pressed(i);
      const was = padPrev.get(i) ?? false;
      padPrev.set(i, now2);
      return now2 && !was;
    };
    // standard 매핑: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 10 L3, 11 R3, 12 십자키 위
    if (pressed(1)) padB.down(now);
    else if (padB.up(now)) pulses |= BTN_DODGE;
    if (pressed(12)) padUp.down(now);
    else if (padUp.up(now)) pulses |= BTN_TORCH;
    if (edge(10)) crouch = !crouch;
    if (edge(11)) pulses |= BTN_LOCK;
    if (edge(13)) pulses |= BTN_SENSE; // 십자키 아래
    return { lx, ly, buttons: pressed };
  }

  return {
    view,
    get crouching() {
      return crouch;
    },
    /** 렌더 프레임 시작에 호출 (시점·패드 갱신, 홀드 판정) */
    frame(now: number) {
      pad = pollPad(now);
      if (fKey.holdOnce(now) || padUp.holdOnce(now)) pulses |= BTN_THROW;
    },
    sample(): InputFrame {
      const now = performance.now();
      let x = axis('KeyA', 'KeyD');
      let y = axis('KeyS', 'KeyW');
      if (pad && (pad.lx !== 0 || pad.ly !== 0)) {
        x = pad.lx;
        y = -pad.ly;
      }
      const sprint = space.held(now) || padB.held(now);
      if (sprint && crouch) crouch = false; // 질주하면 일어선다
      const b = (on: boolean, bit: number) => (on ? bit : 0);
      const buttons =
        b(sprint, BTN_SPRINT) |
        b(crouch, BTN_CROUCH) |
        b(mouse.has(0) || !!pad?.buttons(2), BTN_LIGHT) |
        b(mouse.has(2) || !!pad?.buttons(3), BTN_HEAVY) |
        b(keys.has('ShiftLeft') || keys.has('ShiftRight') || !!pad?.buttons(4), BTN_PARRY) |
        pulses;
      pulses = 0;
      return {
        buttons,
        moveX: Math.round(Math.max(-1, Math.min(1, x)) * 127),
        moveY: Math.round(Math.max(-1, Math.min(1, y)) * 127),
        yaw: radToAngle(view.yaw),
      };
    },
    /** raw 마우스 입력을 먼저 시도하고, 지원하지 않으면 일반 포인터 잠금으로 */
    async lock() {
      try {
        await target.requestPointerLock({ unadjustedMovement: true });
      } catch {
        await target.requestPointerLock();
      }
    },
    dispose() {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('mousemove', onMouse);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      target.removeEventListener('contextmenu', onContext);
    },
  };
}
