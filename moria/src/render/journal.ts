import { QUESTS, mainStatus, sideStatus } from '../quests';
import { ZONE_NAMES } from '../sim/zones';
import type { ZoneId } from '../sim/level';
import type { Sim } from '../sim/types';

/**
 * 퀘스트 일지 (J 또는 일시정지 화면의 📜 일지): 지금 구역의 메인 퀘스트 단계(✓ 끝남 · ▸ 지금), 다른 구역 메인 퀘스트 목록, 사이드 퀘스트.
 * 다른 구역의 진행은 저장에 있는 그 구역 상태로 따로 계산하지 않고 '지나온 구역'만 표시한다 (구역 순서 기준).
 */
const ORDER: readonly ZoneId[] = ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'];

export function createJournal(host: HTMLElement, sim: Sim, pages: () => number) {
  const style = document.createElement('style');
  style.textContent = `
    #journal { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(600px, calc(100vw - 24px));
      max-height: calc(100vh - 40px); overflow: auto; padding: 14px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0;
      font: 13px/1.5 serif; text-align: left; cursor: default; z-index: 2; }
    #journal h3 { margin: 0 0 8px; font-weight: normal; }
    #journal h4 { margin: 12px 0 4px; font-weight: normal; color: #e8c890; }
    #journal .q { margin: 2px 0 2px 4px; }
    #journal .done { color: #8a7f6a; text-decoration: line-through; }
    #journal .now { color: #ffd28a; }
    #journal small { display: inline; font-size: 12px; color: #9a8f7a; } /* 시작 화면의 #start small(블록)을 덮는다 */
    #journal button, #journalBtn { font: 12px serif; padding: 3px 12px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #journalBtn { position: fixed; right: 296px; bottom: 18px; font-size: 14px; padding: 6px 12px; background: rgba(20,18,15,.8); }
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'journal' });
  const btn = Object.assign(document.createElement('button'), { id: 'journalBtn', textContent: '📜 일지' });
  host.append(panel, btn);
  for (const el of [panel, btn]) el.addEventListener('click', (e) => e.stopPropagation());
  btn.addEventListener('click', () => api.toggle());

  function render() {
    const st = mainStatus(sim);
    const here = ORDER.indexOf(sim.level.id as ZoneId);
    const mains = QUESTS.filter((q) => q.main).map((q) => {
      const zi = ORDER.indexOf(q.zone as ZoneId);
      if (st && q === st.quest) {
        const steps = q.steps.map((s, i) => `<div class="q ${i < st.current ? 'done' : i === st.current ? 'now' : ''}">${i < st.current ? '✓' : i === st.current ? '▸' : '·'} ${i === st.current ? st.text : s.text}</div>`).join('');
        return `<h4>${q.title} <small>— ${ZONE_NAMES[q.zone as ZoneId]} · ${q.kind}</small></h4>${steps}`;
      }
      const state = zi < here ? '<span class="done">지나왔다</span>' : '<small>아직 닿지 않았다</small>';
      return `<div class="q">${zi < here ? '✓' : '·'} ${q.title} <small>(${ZONE_NAMES[q.zone as ZoneId]})</small> — ${state}</div>`;
    });
    const sides = sideStatus(sim, pages()).map((s) => `<div class="q ${s.done ? 'done' : ''}">${s.done ? '✓' : '·'} <b>${s.title}</b> <small>(${s.kind})</small> — ${s.detail}</div>`).join('');
    panel.innerHTML = `<h3>일지</h3><h4 style="margin-top:0">메인</h4>${mains.join('')}<h4>사이드</h4>${sides}
      <div style="text-align:right;margin-top:10px"><button data-close>닫기 (J)</button></div>`;
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
