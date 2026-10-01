import { checkAnswer } from '../core/riddle';

/** 60초 동안 풀지 못하면 간달프가 힌트를 준다 (계획서 6장 I) */
const HINT_AFTER = 60;
/** 틀린 답이 이만큼이면 60초를 기다리지 않고 힌트 (원작을 모르면 막힌다 — 첫 플레이 피드백) */
const HINT_AFTER_WRONG = 3;
const GANDALF = "간달프: 이런, 너무 어렵게 생각했군. '벗'을 요정의 말로 하면… 멜론(Mellon)일세.";

type Recognition = {
  lang: string;
  processLocally: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = (new () => Recognition) & {
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string>;
};

/**
 * 두린의 문 수수께끼 창 (DOM). 판정은 core/riddle, 정답이면 onSolved → main이 BTN_WORD를 시뮬레이션 입력에 싣는다.
 * 음성: 기기 안에서 인식할 수 있을 때만(SpeechRecognition.available(processLocally) === 'available') 마이크 버튼을 보인다.
 * 클라우드 인식은 쓰지 않고, 언어팩 설치(install)도 하지 않는다 — 타이핑이 항상 기본이다.
 */
export function createDurinUI(onSolved: () => void, onToggle: (open: boolean) => void) {
  const style = document.createElement('style');
  style.textContent = `
    #durin { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 32px)); display: none;
      padding: 22px 24px; background: rgba(6,8,14,.88); border: 1px solid rgba(159,196,255,.45); color: #cfe0ff; font: 15px/1.6 serif; text-align: center; box-shadow: 0 0 40px rgba(120,160,255,.25); }
    #durin .ins { font-style: italic; color: #b8cef5; white-space: pre-line; }
    #durin .row { display: flex; gap: 8px; margin-top: 14px; }
    #durin input { flex: 1; font: 16px serif; padding: 6px 10px; background: #0b0f18; color: #e6eeff; border: 1px solid #52647f; }
    #durin button { font: 14px serif; padding: 6px 12px; background: #1a2233; color: #cfe0ff; border: 1px solid #52647f; cursor: pointer; }
    #durin .msg { min-height: 1.6em; margin-top: 8px; color: #e8c890; }
    #durin small { color: #7f8ca3; }
    #durin.shake { animation: durinShake .3s; }
    @keyframes durinShake { 25% { transform: translate(calc(-50% - 6px), -50%); } 75% { transform: translate(calc(-50% + 6px), -50%); } }
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'durin';
  root.innerHTML = `
    <div class="ins">두린의 문, 모리아의 군주.
말하라, 벗이여. 그리고 들어오라.</div>
    <small>— 문 위의 은빛 글자 (요정의 말)</small>
    <div class="row"><input id="durin-in" autocomplete="off" spellcheck="false" placeholder="문에게 할 말" /><button id="durin-mic" hidden>🎙 말하기</button></div>
    <div class="msg" id="durin-msg"></div>
    <small>Enter 말하기 · Esc 닫기</small>`;
  document.body.appendChild(root);
  const field = root.querySelector<HTMLInputElement>('#durin-in')!;
  const mic = root.querySelector<HTMLButtonElement>('#durin-mic')!;
  const msg = root.querySelector<HTMLElement>('#durin-msg')!;
  let open = false;
  let solved = false;
  let nearTime = 0;
  let hinted = false;
  let wrong = 0;

  const say = (text: string) => {
    if (solved) return;
    if (checkAnswer(text)) {
      solved = true;
      msg.textContent = '문이 소리 없이 열린다…';
      onSolved();
      setTimeout(() => api.close(), 900);
    } else {
      if (text.trim()) wrong++;
      // 틀릴수록 도움이 늘어난다: 1번 침묵 → 2번 비문을 다시 보라 → 3번 간달프
      msg.textContent = !text.trim()
        ? ''
        : wrong >= HINT_AFTER_WRONG
          ? GANDALF
          : wrong === 2
            ? "문은 침묵한다. …비문은 '벗이여'라고 부른다. 벗이라는 말 자체가 열쇠일지도."
            : '문은 침묵한다.';
      if (wrong >= HINT_AFTER_WRONG) hinted = true;
      root.classList.remove('shake');
      void root.offsetWidth; // 애니메이션 재시작
      root.classList.add('shake');
    }
  };
  field.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') say(field.value);
    else if (e.key === 'Escape') api.close();
    e.stopPropagation();
  });

  // --- 기기 안 음성 인식 (가능할 때만) ---
  const Ctor = ((window as unknown as { SpeechRecognition?: RecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition) as RecognitionCtor | undefined;
  let micChecked = false;
  async function checkMic() {
    micChecked = true;
    try {
      if (Ctor?.available && (await Ctor.available({ langs: ['en-US'], processLocally: true })) === 'available') mic.hidden = false;
    } catch {
      /* 지원 안 함 → 버튼 숨김 유지 */
    }
  }
  mic.addEventListener('click', () => {
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'en-US';
    r.processLocally = true;
    r.interimResults = false;
    r.maxAlternatives = 3;
    mic.disabled = true;
    msg.textContent = '듣는 중…';
    r.onresult = (e) => {
      const alts = Array.from(e.results[0] ?? [], (a) => a.transcript);
      const hit = alts.find((a) => checkAnswer(a));
      field.value = hit ?? alts[0] ?? '';
      say(field.value);
    };
    r.onend = r.onerror = () => {
      mic.disabled = false;
      if (msg.textContent === '듣는 중…') msg.textContent = '';
    };
    r.start();
  });

  const api = {
    get isOpen() {
      return open;
    },
    open() {
      if (open || solved) return;
      open = true;
      root.style.display = 'block';
      field.value = '';
      field.focus();
      if (!micChecked) void checkMic();
      onToggle(true);
    },
    close() {
      if (!open) return;
      open = false;
      root.style.display = 'none';
      field.blur();
      onToggle(false);
    },
    /** 매 프레임: 문 앞에 머문 시간을 세어 힌트. 힌트 문구를 돌려주면 main이 알림으로 띄운다 */
    update(dt: number, nearDoor: boolean): string | null {
      if (solved || !nearDoor) return null;
      nearTime += dt;
      if (hinted || nearTime < HINT_AFTER) return null;
      hinted = true;
      const hint = GANDALF;
      msg.textContent = hint;
      return hint;
    },
  };
  return api;
}
