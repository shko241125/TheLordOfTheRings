import {
  BTN_CALL, BTN_DODGE, BTN_HEAVY, BTN_INTERACT, BTN_LIGHT, BTN_LOCK, BTN_PARRY, BTN_SENSE, BTN_SPRINT, BTN_THROW, BTN_TORCH,
} from '../sim/types';

/**
 * 터치 조작 (계획서 M5 2번 — 모바일 Low 단계). 터치 이벤트의 손가락 번호(identifier)로 여러 손가락을 따로 추적한다.
 * (처음엔 포인터 이벤트였는데, 브라우저 자동화의 터치 에뮬레이션이 포인터 이벤트 좌표를 0으로 보내 검증할 수 없었다.
 *  터치 이벤트는 모든 모바일 브라우저가 지원하고 좌표가 정확하다)
 *   화면 왼쪽 절반: 누른 자리가 가상 조이스틱 중심 (반쯤 = 걷기, 끝까지 = 조깅)
 *   화면 오른쪽 빈 곳: 끌어서 카메라
 *   오른쪽 버튼: PC와 같은 탭/홀드 규칙 — 회피(탭)·질주(홀드 180ms), 횃불(탭)·던지기(홀드 250ms), 강공격은 누르는 동안 차지
 * 입력 계층(core/input)이 매 틱 이 상태를 키보드·패드와 합친다 — 시뮬레이션은 터치를 모른다.
 */
const HOLD_MS = 180;
const THROW_HOLD_MS = 250;
const STICK_R = 60; // px: 끝까지 기울인 반경
const LOOK_SENS = 0.006; // rad/px

type Btn = { id: string; label: string; bit: number; kind: 'hold' | 'pulse' | 'dodge' | 'torch'; x: number; y: number; r: number };

// 오른쪽 아래 기준 좌표 (px, 화면 오른쪽·아래에서 버튼 중심까지)
const BUTTONS: Btn[] = [
  { id: 'light', label: '공격', bit: BTN_LIGHT, kind: 'hold', x: 90, y: 110, r: 42 },
  { id: 'heavy', label: '강', bit: BTN_HEAVY, kind: 'hold', x: 175, y: 70, r: 32 },
  { id: 'dodge', label: '회피', bit: BTN_DODGE, kind: 'dodge', x: 60, y: 205, r: 32 },
  { id: 'parry', label: '막기', bit: BTN_PARRY, kind: 'hold', x: 175, y: 150, r: 30 },
  { id: 'torch', label: '횃불', bit: BTN_TORCH, kind: 'torch', x: 255, y: 60, r: 26 },
  { id: 'sense', label: '감각', bit: BTN_SENSE, kind: 'pulse', x: 145, y: 225, r: 26 },
  { id: 'lock', label: '락온', bit: BTN_LOCK, kind: 'pulse', x: 235, y: 135, r: 24 },
  { id: 'interact', label: 'E', bit: BTN_INTERACT, kind: 'pulse', x: 255, y: 205, r: 26 },
  { id: 'call', label: '동료', bit: BTN_CALL, kind: 'pulse', x: 60, y: 295, r: 26 },
];

export type TouchControls = ReturnType<typeof createTouch>;

export function createTouch(view: { yaw: number; pitch: number }, onInteract: () => void) {
  const style = document.createElement('style');
  style.textContent = `
    #touch { position: fixed; inset: 0; z-index: 5; touch-action: none; user-select: none; -webkit-user-select: none; }
    #touch .tb { position: absolute; border-radius: 50%; border: 2px solid rgba(216,203,176,.45); background: rgba(20,18,15,.35);
      color: #e8dcc0; font: 600 14px/1 serif; display: grid; place-items: center; }
    #touch .tb.on { background: rgba(255,176,80,.35); border-color: #ffb050; }
    #touch .stick { position: absolute; width: 120px; height: 120px; margin: -60px 0 0 -60px; border-radius: 50%; border: 2px solid rgba(216,203,176,.3); display: none; }
    #touch .knob { position: absolute; left: 50%; top: 50%; width: 48px; height: 48px; margin: -24px 0 0 -24px; border-radius: 50%; background: rgba(216,203,176,.35); }
    #touch .pause { position: absolute; left: 12px; top: 12px; width: 44px; height: 44px; border-radius: 8px; }
    /* 가로 화면에서 오른쪽 위 미니맵(세로 약 260px)이 버튼 무리와 겹쳤다(스크린샷) → 일시정지 버튼 옆으로, 60% 크기 */
    body.touch #minimap { left: 66px; right: auto; top: 10px; transform: scale(.6); transform-origin: top left; }
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `<div class="stick"><div class="knob"></div></div><div class="tb pause" data-pause>❚❚</div>${BUTTONS.map(
    (b) => `<div class="tb" data-b="${b.id}" style="width:${b.r * 2}px;height:${b.r * 2}px;right:${b.x - b.r}px;bottom:${b.y - b.r}px">${b.label}</div>`,
  ).join('')}`;
  document.body.appendChild(root);
  document.body.classList.add('touch');
  const stick = root.querySelector<HTMLElement>('.stick')!;
  const knob = root.querySelector<HTMLElement>('.knob')!;

  let moveX = 0;
  let moveY = 0;
  let held = 0;
  let pulses = 0;
  let onPause: (() => void) | null = null;
  // 손가락별 역할
  const fingers = new Map<number, { role: 'stick' | 'look' | 'btn'; x: number; y: number; btn?: Btn; downAt: number; fired?: boolean }>();
  const btnEl = (b: Btn) => root.querySelector<HTMLElement>(`[data-b="${b.id}"]`)!;

  type P = { id: number; x: number; y: number; target: HTMLElement };
  const onDown = (e: P) => {
    const t = e.target;
    if (t.dataset.pause !== undefined) {
      onPause?.();
      return;
    }
    const b = BUTTONS.find((x) => x.id === t.dataset.b);
    const now = performance.now();
    if (b) {
      fingers.set(e.id, { role: 'btn', x: e.x, y: e.y, btn: b, downAt: now });
      btnEl(b).classList.add('on');
      if (b.kind === 'hold') held |= b.bit;
      else if (b.kind === 'pulse') {
        pulses |= b.bit;
        if (b.id === 'interact') onInteract();
      }
      return;
    }
    if (e.x < innerWidth * 0.45) {
      fingers.set(e.id, { role: 'stick', x: e.x, y: e.y, downAt: now });
      stick.style.display = 'block';
      stick.style.left = `${e.x}px`;
      stick.style.top = `${e.y}px`;
      knob.style.transform = '';
    } else fingers.set(e.id, { role: 'look', x: e.x, y: e.y, downAt: now });
  };
  const onMove = (e: P) => {
    const f = fingers.get(e.id);
    if (!f) return;
    if (f.role === 'stick') {
      let dx = e.x - f.x;
      let dy = e.y - f.y;
      const d = Math.hypot(dx, dy);
      if (d > STICK_R) {
        dx *= STICK_R / d;
        dy *= STICK_R / d;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const dead = 8;
      const k = d < dead ? 0 : 1;
      moveX = Math.round((dx / STICK_R) * 127 * k);
      moveY = Math.round((-dy / STICK_R) * 127 * k);
    } else if (f.role === 'look') {
      view.yaw -= (e.x - f.x) * LOOK_SENS;
      view.pitch = Math.min(0.55, Math.max(-1.1, view.pitch - (e.y - f.y) * LOOK_SENS));
      f.x = e.x;
      f.y = e.y;
    }
  };
  const onUp = (e: P) => {
    const f = fingers.get(e.id);
    if (!f) return;
    fingers.delete(e.id);
    const now = performance.now();
    if (f.role === 'stick') {
      moveX = moveY = 0;
      stick.style.display = 'none';
    } else if (f.role === 'btn' && f.btn) {
      const b = f.btn;
      btnEl(b).classList.remove('on');
      if (b.kind === 'hold') held &= ~b.bit;
      else if (b.kind === 'dodge' && now - f.downAt < HOLD_MS) pulses |= BTN_DODGE;
      else if (b.kind === 'torch' && !f.fired && now - f.downAt < THROW_HOLD_MS) pulses |= BTN_TORCH;
    }
  };
  // 바뀐 손가락(changedTouches)마다. 버튼은 누른 순간의 요소로 정한다 (touch.target은 끝까지 처음 요소)
  const each = (fn: (p: P) => void) => (ev: TouchEvent) => {
    ev.preventDefault(); // 스크롤·확대·마우스 흉내 이벤트 막기
    for (const t of Array.from(ev.changedTouches)) fn({ id: t.identifier, x: t.clientX, y: t.clientY, target: t.target as HTMLElement });
  };
  root.addEventListener('touchstart', each(onDown), { passive: false });
  root.addEventListener('touchmove', each(onMove), { passive: false });
  root.addEventListener('touchend', each(onUp), { passive: false });
  root.addEventListener('touchcancel', each(onUp), { passive: false });

  return {
    root,
    /** 일시정지 버튼 (시작 화면을 다시 띄운다) */
    set onPause(cb: (() => void) | null) {
      onPause = cb;
    },
    show(on: boolean) {
      root.style.display = on ? 'block' : 'none';
    },
    /** 틱마다 입력 계층이 부른다: 이동, 누르고 있는 버튼 + 이번 틱 펄스 */
    sample(): { moveX: number; moveY: number; buttons: number } {
      const now = performance.now();
      let hold = held;
      for (const f of fingers.values()) {
        if (f.role !== 'btn' || !f.btn) continue;
        if (f.btn.kind === 'dodge' && now - f.downAt >= HOLD_MS) hold |= BTN_SPRINT;
        if (f.btn.kind === 'torch' && !f.fired && now - f.downAt >= THROW_HOLD_MS) {
          f.fired = true;
          pulses |= BTN_THROW;
        }
      }
      const out = { moveX, moveY, buttons: hold | pulses };
      pulses = 0;
      return out;
    },
    /** 자동 락온 등 UI가 한 틱짜리 버튼을 넣는다 */
    pulse(bits: number) {
      pulses |= bits;
    },
    dispose() {
      root.remove();
      style.remove();
    },
  };
}
