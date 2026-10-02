import { CMD_BUY, OFFERS, cannotBuy, type NpcKind } from '../sim/shop';
import type { Sim } from '../sim/types';

/**
 * 상점 창 (NPC 곁에서 E). 장비 창과 같은 자리·모양. 사는 것은 입력 명령으로 보낸다 (리플레이가 재현한다).
 */
export function createShopPanel(host: HTMLElement, sim: Sim, send: (cmd: number) => void) {
  const style = document.createElement('style');
  style.textContent = `
    #shop { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100vw - 24px));
      max-height: calc(100vh - 40px); overflow: auto; padding: 14px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0;
      font: 13px/1.4 serif; text-align: left; cursor: default; z-index: 2; }
    #shop h3 { margin: 0 0 4px; font-weight: normal; }
    #shop .sub { color: #a09070; margin-bottom: 10px; font-style: italic; }
    #shop .it { border: 1px solid #3a342a; padding: 6px 8px; background: #15130f; margin-bottom: 6px; display: flex; justify-content: space-between; gap: 10px; align-items: center; }
    #shop .it small { display: block; color: #9a8f7a; }
    #shop button { font: 12px serif; padding: 3px 12px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; white-space: nowrap; }
    #shop button:disabled { opacity: .4; cursor: default; }
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'shop' });
  host.append(panel);
  panel.addEventListener('click', (e) => e.stopPropagation());
  let who: { kind: NpcKind; name: string } | null = null;
  const GREET: Record<NpcKind, string> = {
    merchant: '“어둠 속에서 장사라니, 미쳤다고들 하지. 그래도 금은 금이야.”',
    smith: '“모루가 다시 노래하는군. 미스릴만 가져오면 왕의 도끼를 벼려 주지.”',
  };

  function render() {
    if (!who) return;
    const p = sim.player;
    const rows = OFFERS.map((o, k) => ({ o, k }))
      .filter(({ o }) => o.npc === who!.kind)
      .map(({ o, k }) => {
        const why = cannotBuy(sim, k);
        const price = [o.gold ? `금화 ${o.gold}` : '', o.mithril ? `미스릴 ${o.mithril}` : ''].filter(Boolean).join(' · ');
        return `<div class="it"><div><b>${o.name}</b><small>${o.desc}${why ? ` — ${why}` : ''}</small></div>
          <button data-cmd="${CMD_BUY + k}" ${why ? 'disabled' : ''}>${price}</button></div>`;
      })
      .join('');
    const smithLine = who.kind === 'smith' ? '<small style="display:block;margin-top:6px;color:#9a8f7a">대장장이 곁에서는 장비 창(I)에서 강화도 할 수 있다.</small>' : '';
    panel.innerHTML = `<h3>${who.name}</h3><div class="sub">${GREET[who.kind]}</div>
      <div style="margin-bottom:8px">금화 ${p.gold} · 미스릴 ${p.mithril} · 예비 횃불 ${p.spareTorches}</div>${rows}${smithLine}
      <div style="text-align:right;margin-top:10px"><button data-close>닫기 (E)</button></div>`;
    panel.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => b.addEventListener('click', () => send(Number(b.dataset.cmd))));
    panel.querySelector('[data-close]')!.addEventListener('click', () => api.close());
  }

  const api = {
    get open() {
      return panel.style.display === 'block';
    },
    show(npc: { kind: NpcKind; name: string }) {
      who = npc;
      panel.style.display = 'block';
      render();
    },
    close() {
      panel.style.display = 'none';
    },
    refresh() {
      if (api.open) render();
    },
  };
  return api;
}
