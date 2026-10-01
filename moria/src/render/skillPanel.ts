import type { ClassId } from '../sim/classes';
import { CMD_RESET, TREES, canLearn, xpToNext, MAX_LEVEL } from '../sim/growth';
import type { PlayerState } from '../sim/types';

/**
 * 스킬 트리 창 (일시정지 화면 안 — 설정 창과 같은 자리). Tab 또는 ✦ 스킬 버튼으로 연다.
 * 배우기·되돌리기는 여기서 바로 바꾸지 않고 입력 명령(cmd)으로 보낸다 → 시뮬레이션이 다음 틱에 적용하고, 리플레이에도 남는다.
 * 되돌리기는 밝힌 화로 곁에서만 (계획서: 등불에서 무료로).
 */
export function createSkillPanel(host: HTMLElement, classId: ClassId, player: () => PlayerState, nearLitBrazier: () => boolean, send: (cmd: number) => void) {
  const style = document.createElement('style');
  style.textContent = `
    #skills { display: none; position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(760px, calc(100vw - 24px));
      max-height: calc(100vh - 40px); overflow: auto; padding: 16px 18px; background: rgba(10,9,8,.96); border: 1px solid #5a5040; color: #d8cbb0;
      font: 13px/1.45 serif; text-align: left; cursor: default; z-index: 2; }
    #skills h3 { margin: 0 0 4px; font-weight: normal; letter-spacing: .06em; }
    #skills .sub { color: #a09070; margin-bottom: 10px; }
    #skills .cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    #skills .col h4 { margin: 0 0 6px; font-weight: normal; color: #e8c890; text-align: center; }
    #skills .node { border: 1px solid #3a342a; padding: 6px 8px; margin-bottom: 6px; background: #15130f; }
    #skills .node b { display: block; font-weight: normal; }
    #skills .node small { color: #9a8f7a; }
    #skills .node.have { border-color: #c09a50; background: #2a2114; }
    #skills .node.can { border-color: #7aa0c0; cursor: pointer; }
    #skills .node.can:hover { background: #1c2430; }
    #skills .node.locked { opacity: .45; }
    #skills .row { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; gap: 10px; }
    #skills button, #skillsBtn { font: 13px serif; padding: 4px 12px; background: #1d1a16; color: #d8cbb0; border: 1px solid #5a5040; cursor: pointer; }
    #skills button:disabled { opacity: .4; cursor: default; }
    #skillsBtn { position: fixed; right: 110px; bottom: 18px; font-size: 14px; padding: 6px 12px; background: rgba(20,18,15,.8); }
  `;
  document.head.appendChild(style);
  const panel = Object.assign(document.createElement('div'), { id: 'skills' });
  const btn = Object.assign(document.createElement('button'), { id: 'skillsBtn', textContent: '✦ 스킬' });
  host.append(panel, btn);
  for (const el of [panel, btn]) el.addEventListener('click', (e) => e.stopPropagation());
  btn.addEventListener('click', () => api.toggle());
  const tree = TREES[classId];

  function render() {
    const p = player();
    const xp = p.level >= MAX_LEVEL ? '최대 레벨' : `XP ${Math.floor(p.xp)} / ${xpToNext(p.level)}`;
    panel.innerHTML = `<h3>스킬 — 레벨 ${p.level}</h3>
      <div class="sub">${xp} · 스킬 포인트 <b>${p.points}</b> · 같은 갈래의 아래 단계를 배워야 다음 단계가 열린다</div>
      <div class="cols">${tree.branches
        .map((name, b) => {
          const nodes = tree.nodes.map((node, i) => ({ node, i })).filter((x) => x.node.branch === b).sort((x, y) => x.node.tier - y.node.tier);
          return `<div class="col"><h4>${name}</h4>${nodes
            .map(({ node, i }) => {
              const have = p.skills.includes(i);
              const can = !have && canLearn(classId, p.skills, p.points, i);
              return `<div class="node ${have ? 'have' : can ? 'can' : 'locked'}" data-i="${i}"><b>${node.tier}. ${node.name}</b><small>${node.desc}</small></div>`;
            })
            .join('')}</div>`;
        })
        .join('')}</div>
      <div class="row"><span class="sub">${nearLitBrazier() ? '화로 곁: 스킬을 무료로 되돌릴 수 있다' : '되돌리기는 밝힌 화로 곁에서'}</span>
        <span><button data-reset ${nearLitBrazier() && p.skills.length ? '' : 'disabled'}>모두 되돌리기</button> <button data-close>닫기 (Tab)</button></span></div>`;
    panel.querySelectorAll<HTMLElement>('.node.can').forEach((el) => el.addEventListener('click', () => send(Number(el.dataset.i) + 1)));
    panel.querySelector('[data-reset]')!.addEventListener('click', () => send(CMD_RESET));
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
    /** 레벨업·스킬 사건 뒤에 다시 그린다 */
    refresh() {
      if (api.open) render();
    },
  };
  return api;
}
