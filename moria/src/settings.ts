/**
 * 설정·접근성 (계획서 M5 3번). 브라우저에 저장하고, 막힌 환경(시크릿 창 등)에서는 기본값으로 돈다.
 * 시뮬레이션 규칙은 바꾸지 않는다 — 모두 보이는 것·조작 해석만 바꾼다 (리플레이 결정성과 무관).
 */
export type Action = 'forward' | 'back' | 'left' | 'right' | 'dodge' | 'parry' | 'crouch' | 'torch' | 'sense' | 'interact' | 'call';

export const ACTION_NAMES: Record<Action, string> = {
  forward: '앞으로', back: '뒤로', left: '왼쪽', right: '오른쪽', dodge: '회피 / 질주(길게)', parry: '패링',
  crouch: '웅크리기', torch: '횃불 (길게: 던지기)', sense: '돌의 감각', interact: '상호작용', call: '동료 호출',
};

export const DEFAULT_KEYS: Record<Action, string> = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', dodge: 'Space', parry: 'ShiftLeft',
  crouch: 'KeyC', torch: 'KeyF', sense: 'KeyV', interact: 'KeyE', call: 'KeyQ',
};

export type Settings = {
  /** 화면 흔들림 */
  shake: boolean;
  /** 돌의 감각 음파·드러남 세기 0..1 (0 = 음파 없이 적만 드러남) */
  pulse: number;
  /** 밝기 (톤매핑 노출) 0.6..1.8 */
  brightness: number;
  /** 글자 크기 배율 */
  textScale: number;
  /** 마우스 감도 배율 */
  mouseSens: number;
  invertY: boolean;
  /** 색각 보정: 빨강·주황 신호(트롤 예고 고리, 금 간 기둥)를 노랑·하늘색으로 */
  colorSafe: boolean;
  keys: Record<Action, string>;
};

export const DEFAULTS: Settings = {
  shake: true, pulse: 1, brightness: 1, textScale: 1, mouseSens: 1, invertY: false, colorSafe: false, keys: { ...DEFAULT_KEYS },
};

const KEY = 'moria.settings';
const clamp = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function loadSettings(): Settings {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const keys = { ...DEFAULT_KEYS };
    for (const a of Object.keys(DEFAULT_KEYS) as Action[]) if (typeof r.keys?.[a] === 'string') keys[a] = r.keys[a];
    return {
      shake: r.shake !== false,
      pulse: clamp(r.pulse, 0, 1, 1),
      brightness: clamp(r.brightness, 0.6, 1.8, 1),
      textScale: clamp(r.textScale, 1, 1.6, 1),
      mouseSens: clamp(r.mouseSens, 0.3, 3, 1),
      invertY: r.invertY === true,
      colorSafe: r.colorSafe === true,
      keys,
    };
  } catch {
    return { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장소 없음 — 이번 세션에만 적용 */
  }
}
