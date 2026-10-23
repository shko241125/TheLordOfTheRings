import { BOOK_EXT, checkBookReplay, inflatedSizeWithin, MAX_BOOK_BYTES, MAX_REPLAY_INFLATED, unwrapBook } from '../replay/bookfile';
import { decodeReplay } from '../replay/codec';
import { loadReplay, saveReplay } from '../replay/storage';
import { exportSave, importSave } from '../save';
import { ACTION_NAMES, DEFAULT_KEYS, type Action, type Settings } from '../settings';
import { CLASS_STATS } from '../sim/classes';
import { ZONES } from '../sim/zones';

/**
 * 설정 창 (일시정지 화면 = 시작 화면 안). 값이 바뀔 때마다 onChange로 알린다 — main이 적용하고 저장한다.
 * 키 배치: '바꾸기'를 누른 뒤 다음 키가 그 동작이 된다 (Esc = 취소). 이미 다른 동작에 쓰인 키면 서로 맞바꾼다.
 * 저장 내보내기·가져오기 (계획서 12장): 브라우저 데이터를 지워도 파일로 되살린다. 가져오면 지금 저장을 덮어쓰고 다시 부팅한다.
 * 책 가져오기: 남이 내보낸 책 파일(.moriabook)을 마지막 기록 칸에 넣고 ?replay=last 로 본다.
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
    #settings select { font: 13px serif; padding: 2px 4px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; }
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
  function check(label: string, key: 'shake' | 'invertY' | 'colorSafe') {
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
      <label>난이도<select data-k="difficulty">${(
        [['story', '스토리 (받는 피해 ½, 패링 창 2배)'], ['easy', '쉬움 (받는 피해 ¾)'], ['normal', '보통'], ['hard', '어려움 (받는 피해 1.5배)']] as const
      ).map(([v, t]) => `<option value="${v}" ${s.difficulty === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <div class="keys">${(Object.keys(ACTION_NAMES) as Action[])
        .map((a) => `<span>${ACTION_NAMES[a]}</span><button data-a="${a}" class="${waiting === a ? 'wait' : ''}">${waiting === a ? '키를 누르세요' : keyName(s.keys[a])}</button>`)
        .join('')}</div>
      <div class="row"><button data-export>저장 내보내기</button><button data-import>저장 가져오기</button><button data-book>책 가져오기</button></div>
      <div class="row"><button data-reset>기본값으로</button><button data-close>닫기</button></div>`;
    panel.querySelectorAll<HTMLInputElement>('input, select').forEach((el) =>
      el.addEventListener('input', () => {
        const k = el.dataset.k as keyof Settings;
        s = { ...s, [k]: el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : Number(el.value) };
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
      setTimeout(() => URL.revokeObjectURL(a.href), 0);
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
    // 책 가져오기: 책 파일(머리 8바이트 + 리플레이)을 확인하고 마지막 기록 칸에 넣은 뒤 바로 본다. 저장은 건드리지 않는다
    panel.querySelector('[data-book]')!.addEventListener('click', () => {
      const file = Object.assign(document.createElement('input'), { type: 'file', accept: `${BOOK_EXT},application/octet-stream` });
      file.addEventListener('change', async () => {
        const f = file.files?.[0];
        if (!f) return;
        if (f.size > MAX_BOOK_BYTES) return alert('파일이 너무 크다 (4MB까지).'); // 메모리로 읽기 전에
        const r = unwrapBook(new Uint8Array(await f.arrayBuffer()));
        if (!r.ok) return alert({ empty: '빈 파일이다.', 'too-big': '파일이 너무 크다 (4MB까지).', magic: '모리아의 책 파일이 아니다.', version: '이 게임이 모르는 책 판이다.' }[r.error]);
        const known = { zones: Object.keys(ZONES), classes: Object.keys(CLASS_STATS) };
        try {
          if (!(await inflatedSizeWithin(r.replay, MAX_REPLAY_INFLATED))) throw new Error('inflate');
          if (checkBookReplay(await decodeReplay(r.replay), known) !== true) throw new Error('header');
        } catch {
          return alert('책이 손상되었다.');
        }
        if ((await loadReplay()) && !confirm('지금 있는 마지막 기록을 이 책으로 바꾼다. 계속할까?')) return;
        if (!(await saveReplay(r.replay))) return alert('이 브라우저에는 기록을 적어 둘 수 없다.');
        location.href = `${location.pathname}?replay=last`;
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
    close() {
      panel.style.display = 'none';
    },
  };
}
