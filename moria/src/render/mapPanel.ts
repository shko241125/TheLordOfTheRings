import { ZONE_NAMES } from '../sim/zones';
import type { ZoneId } from '../sim/level';
import type { Sim } from '../sim/types';

/**
 * 전체 지도 (M 또는 일시정지 화면의 🗺 지도, 계획서 13장 메뉴의 '지도'): 미니맵과 같은 규칙(가 본 방 + 밝힌 화로 곁)을
 * 크게, 방 이름과 함께 그린다. 열 때 한 번 그린다 — 창이 열려 있으면 일시정지라 그동안 아무것도 움직이지 않는다.
 */
export function createMapPanel(host: HTMLElement, sim: Sim, draw: ((c: HTMLCanvasElement, maxW: number, maxH: number) => void) | null) {
  const style = document.createElement('style');
  style.textContent = `
    #map { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); min-width: min(480px, calc(100vw - 24px)); max-width: calc(100vw - 24px); box-sizing: border-box;
      padding: 14px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0;
      font: 13px/1.5 serif; text-align: left; cursor: default; z-index: 2; }
    #map h3 { margin: 0 0 8px; font-weight: normal; }
    #map canvas { display: block; margin: 0 auto; }
    #map small { display: inline; font-size: 12px; color: #9a8f7a; }
    #map .legend span { white-space: nowrap; }
    #map i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin: 0 4px 0 10px; vertical-align: -1px; }
    #map button, #mapBtn { font: 12px serif; padding: 3px 12px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #mapBtn { position: fixed; right: 390px; bottom: 18px; font-size: 14px; padding: 6px 12px; background: rgba(20,18,15,.8); }
    @media (max-width: 480px) { #mapBtn { right: 296px; bottom: 62px; } } /* 좁은 화면: 아래 버튼 줄에 자리가 없어 일지 위로 */
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'map' });
  const btn = Object.assign(document.createElement('button'), { id: 'mapBtn', textContent: '🗺 지도' });
  host.append(panel, btn);
  for (const el of [panel, btn]) el.addEventListener('click', (e) => e.stopPropagation());
  btn.addEventListener('click', () => api.toggle());

  function render() {
    const zone = sim.level.id ? ZONE_NAMES[sim.level.id as ZoneId] : '시험 방';
    panel.innerHTML = `<h3>지도 <small>— ${zone}</small></h3><canvas></canvas>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:12px">
        <small class="legend">가 본 곳과 밝힌 화로 곁만 보인다 · 위가 북쪽 <span><i style="background:#f4ecd8;border-radius:0"></i>나</span> <span><i style="background:#ffa040"></i>화로</span> <span><i style="background:#ffcf60"></i>등불</span></small>
        <button data-close>닫기 (M)</button></div>`;
    const canvas = panel.querySelector('canvas')!;
    if (draw) draw(canvas, Math.min(820, innerWidth - 60), innerHeight - 270); // 위 탭 줄(top 40px)과 겹치지 않게 위아래 여백을 남긴다
    else canvas.replaceWith(Object.assign(document.createElement('div'), { textContent: '이곳에는 지도가 없다.' }));
    panel.querySelector('[data-close]')!.addEventListener('click', () => api.close());
  }

  const api = {
    get open() {
      return panel.style.display === 'block';
    },
    toggle() {
      if (api.open) api.close();
      else {
        panel.style.display = 'block';
        render();
      }
    },
    close() {
      panel.style.display = 'none';
    },
  };
  return api;
}
