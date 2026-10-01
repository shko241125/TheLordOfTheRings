import { CMD_DROP, CMD_EQUIP, CMD_UNEQUIP, CMD_UPGRADE } from '../sim/gear';
import { GRADE_COLORS, GRADE_NAMES, MAX_UPGRADE, SLOT_NAMES, describe, upgradeCost, type Item } from '../sim/items';
import type { PlayerState } from '../sim/types';

/**
 * 장비 창 (일시정지 화면 안 — 스킬 창과 같은 자리). I 또는 ⚔ 장비 버튼.
 * 장착·해제·버리기·강화는 입력 명령으로 보낸다 → 다음 틱에 시뮬레이션이 적용하고 리플레이에 남는다.
 * 인벤토리의 ▲ = 같은 종류 장착품보다 등급이 높다 (계획서: "더 좋은 장비" 비교 화살표).
 */
export function createGearPanel(host: HTMLElement, player: () => PlayerState, nearLitBrazier: () => boolean, send: (cmd: number) => void) {
  const style = document.createElement('style');
  style.textContent = `
    #gear2 { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(820px, calc(100vw - 24px));
      max-height: calc(100vh - 40px); overflow: auto; padding: 14px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0;
      font: 13px/1.4 serif; text-align: left; cursor: default; z-index: 2; }
    #gear2 h3 { margin: 0 0 4px; font-weight: normal; }
    #gear2 .sub { color: #a09070; margin-bottom: 8px; }
    #gear2 .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
    #gear2 .it { border: 1px solid #3a342a; padding: 5px 8px; background: #15130f; }
    #gear2 .it small { display: block; color: #9a8f7a; }
    #gear2 .it .btns { margin-top: 4px; display: flex; gap: 6px; }
    #gear2 button, #gearBtn { font: 12px serif; padding: 2px 10px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #gear2 button:disabled { opacity: .4; cursor: default; }
    #gear2 h4 { margin: 12px 0 6px; font-weight: normal; color: #e8c890; }
    #gearBtn { position: fixed; right: 202px; bottom: 18px; font-size: 14px; padding: 6px 12px; background: rgba(20,18,15,.8); }
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'gear2' });
  const btn = Object.assign(document.createElement('button'), { id: 'gearBtn', textContent: '⚔ 장비' });
  host.append(panel, btn);
  for (const el of [panel, btn]) el.addEventListener('click', (e) => e.stopPropagation());
  btn.addEventListener('click', () => api.toggle());

  const title = (it: Item) => `<b style="color:${GRADE_COLORS[it.grade]}">${GRADE_NAMES[it.grade]} ${it.name}${it.upgrade ? ` +${it.upgrade}` : ''}</b>`;
  const lines = (it: Item) => `<small>${describe(it).join(' · ') || '—'}</small>`;

  function render() {
    const p = player();
    const near = nearLitBrazier();
    const eq = p.equipped
      .map((it, s) => {
        if (!it) return `<div class="it"><small>${SLOT_NAMES[s]}</small>비어 있음</div>`;
        const c = upgradeCost(it.upgrade + 1);
        const canUp = near && it.upgrade < MAX_UPGRADE && p.mithril >= c.mithril && p.gold >= c.gold;
        const up = it.upgrade >= MAX_UPGRADE ? '최대 강화' : `강화 (미스릴 ${c.mithril} · 금화 ${c.gold})`;
        return `<div class="it"><small>${SLOT_NAMES[s]}</small>${title(it)}${lines(it)}
          <div class="btns"><button data-cmd="${CMD_UNEQUIP + s}">해제</button><button data-cmd="${CMD_UPGRADE + s}" ${canUp ? '' : 'disabled'}>${up}</button></div></div>`;
      })
      .join('');
    const inv = p.inventory
      .map((it, i) => {
        const same = p.equipped.filter((e) => e?.slot === it.slot);
        const better = same.length === 0 || same.some((e) => (e?.grade ?? -1) < it.grade);
        return `<div class="it">${better ? '<span style="color:#7fd07f">▲ </span>' : ''}${title(it)}${lines(it)}
          <div class="btns"><button data-cmd="${CMD_EQUIP + i}">장착</button><button data-cmd="${CMD_DROP + i}">버리기</button></div></div>`;
      })
      .join('');
    panel.innerHTML = `<h3>장비</h3>
      <div class="sub">금화 ${p.gold} · 미스릴 ${p.mithril} · 어둠 비율 ${Math.round(p.darkness * 100)}% (높을수록 좋은 전리품) · ${near ? '화로 곁: 강화할 수 있다' : '강화는 밝힌 화로 곁에서'}</div>
      <div class="grid">${eq}</div>
      <h4>가방 ${p.inventory.length} / 40</h4>
      <div class="grid">${inv || '<small>비어 있다 — 적을 쓰러뜨리면 떨어뜨린다 (E로 줍기)</small>'}</div>
      <div style="text-align:right;margin-top:10px"><button data-close>닫기 (I)</button></div>`;
    panel.querySelectorAll<HTMLButtonElement>('button[data-cmd]').forEach((b) => b.addEventListener('click', () => send(Number(b.dataset.cmd))));
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
    refresh() {
      if (api.open) render();
    },
  };
  return api;
}
