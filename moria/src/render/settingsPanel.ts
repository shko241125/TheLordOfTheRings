import { exportSave, importSave } from '../save';
import { ACTION_NAMES, DEFAULT_KEYS, type Action, type Settings } from '../settings';

/**
 * 설정 창 (일시정지 화면 = 시작 화면 안). 값이 바뀔 때마다 onChange로 알린다 — main이 적용하고 저장한다.
 * 키 배치: '바꾸기'를 누른 뒤 다음 키가 그 동작이 된다 (Esc = 취소). 이미 다른 동작에 쓰인 키면 서로 맞바꾼다.
 * 저장 내보내기·가져오기 (계획서 12장): 브라우저 데이터를 지워도 파일로 되살린다. 가져오면 지금 저장을 덮어쓰고 다시 부팅한다.
 */
export function createSettingsPanel(host: HTMLElement, initial: Settings, onChange: (s: Settings) => void) {
  const style = document.createElement('style');
  style.textContent = `
    #settings { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 32px));
      max-height: calc(100vh - 48px); overflow: auto; padding: 18px 22px; background: rgba(10,9,8,.95); border: 1px solid #5a5040; color: #d8cbb0;
      font: 14px/1.5 serif; text-align: left; cursor: default; }
    #settings h3 { margin: 0 0 10px; font-weight: normal; letter-spacing: .08em; }
    #settings label { display: grid; grid-template-columns: 1fr 180px; align-items: center; gap: 12px; margin: 6px 0; }
    #settings input[type=range] { width: 100%; }
    #settings .keys { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; margin-top: 8px; }
    #settings button { font: 13px ui-monospace, monospace; padding: 3px 10px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #settings button.wait { border-color: #ffb050; color: #ffb050; }
    #settings .row { display: flex; justify-content: space-between; margin-top: 14px; }
    #gear { position: fixed; right: 18px; bottom: 18px; font: 14px serif; padding: 6px 12px; background: rgba(20,18,15,.8); color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
  `;
  document.head.appendChild(style);
  let s: Settings = { ...initial, keys: { ...initial.keys } };
  const panel = document.createElement('div');
  panel.id = 'settings';
  const gear = Object.assign(document.createElement('button'), { id: 'gear', textContent: '⚙ 설정' });
  host.append(panel, gear);
  // 시작 화면을 누르면 포인터 잠금(게임 시작) → 설정 창 안의 클릭은 막는다
  for (const el of [panel, gear]) el.addEventListener('click', (e) => e.stopPropagation());
  gear.addEventListener('click', () => {
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    render();
  });

  let waiting: Action | null = null;
  const keyName = (code: string) => code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Shift').replace('Space', 'Space');

  function slider(label: string, key: 'pulse' | 'brightness' | 'textScale' | 'mouseSens', min: number, max: number, step: number) {
    return `<label>${label}<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"></label>`;
  }
  function check(label: string, key: 'shake' | 'invertY' | 'colorSafe' | 'story') {
    return `<label>${label}<input type="checkbox" data-k="${key}" ${s[key] ? 'checked' : ''}></label>`;
  }
  function render() {
    panel.innerHTML = `<h3>설정</h3>
      ${check('화면 흔들림', 'shake')}
      ${slider('돌의 감각 음파 세기', 'pulse', 0, 1, 0.05)}
      ${slider('밝기', 'brightness', 0.6, 1.8, 0.05)}
      ${slider('글자 크기', 'textScale', 1, 1.6, 0.05)}
      ${slider('마우스 감도', 'mouseSens', 0.3, 3, 0.05)}
      ${check('마우스 상하 반전', 'invertY')}
      ${check('색각 보정 (빨강·주황 신호 → 노랑·하늘색)', 'colorSafe')}
      ${check('스토리 난이도 (받는 피해 절반, 패링 창 2배)', 'story')}
      <div class="keys">${(Object.keys(ACTION_NAMES) as Action[])
        .map((a) => `<span>${ACTION_NAMES[a]}</span><button data-a="${a}" class="${waiting === a ? 'wait' : ''}">${waiting === a ? '키를 누르세요' : keyName(s.keys[a])}</button>`)
        .join('')}</div>
      <div class="row"><button data-export>저장 내보내기</button><button data-import>저장 가져오기</button></div>
      <div class="row"><button data-reset>기본값으로</button><button data-close>닫기</button></div>`;
    panel.querySelectorAll<HTMLInputElement>('input').forEach((el) =>
      el.addEventListener('input', () => {
        const k = el.dataset.k as keyof Settings;
        s = { ...s, [k]: el.type === 'checkbox' ? el.checked : Number(el.value) };
        onChange(s);
      }),
    );
    panel.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((el) =>
      el.addEventListener('click', () => {
        waiting = el.dataset.a as Action;
        render();
      }),
    );
    panel.querySelector('[data-reset]')!.addEventListener('click', () => {
      s = { ...s, keys: { ...DEFAULT_KEYS } };
      onChange(s);
      render();
    });
    panel.querySelector('[data-export]')!.addEventListener('click', () => {
      const text = exportSave();
      if (!text) return alert('아직 저장이 없다 (화로에서 쉬면 저장된다).');
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'application/json' })), download: 'moria-save.json' });
      a.click();
      URL.revokeObjectURL(a.href);
    });
    panel.querySelector('[data-import]')!.addEventListener('click', () => {
      const file = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
      file.addEventListener('change', async () => {
        const text = await file.files?.[0]?.text();
        if (!text || (exportSave() && !confirm('지금 저장을 이 파일로 덮어쓴다. 계속할까?'))) return;
        if (!importSave(text)) return alert('모리아의 저장 파일이 아니거나 손상되었다.');
        location.href = location.pathname; // 가져온 저장으로 다시 부팅 (?new=1 같은 주소 인자는 뺀다)
      });
      file.click();
    });
    panel.querySelector('[data-close]')!.addEventListener('click', () => (panel.style.display = 'none'));
  }
  window.addEventListener(
    'keydown',
    (e) => {
      if (!waiting) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // 이 키가 게임 조작으로 들어가지 않게
      if (e.code !== 'Escape') {
        const keys = { ...s.keys };
        const other = (Object.keys(keys) as Action[]).find((a) => keys[a] === e.code && a !== waiting);
        if (other) keys[other] = keys[waiting]; // 맞바꾸기
        keys[waiting] = e.code;
        s = { ...s, keys };
        onChange(s);
      }
      waiting = null;
      render();
    },
    { capture: true },
  );
  return {
    get open() {
      return panel.style.display === 'block';
    },
  };
}
