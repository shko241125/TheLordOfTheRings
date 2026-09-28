import type { Sim } from '../sim/types';
import { STAMINA_MAX } from '../sim/combat';

/**
 * HUD (HTML 오버레이 — 계획서 13장). 전투 중에는 가장자리에만: 좌하단 체력·스태미나, 락온 표식, 짧은 알림.
 * 게임 로직은 DOM을 만지지 않는다 — 여기서 시뮬레이션 상태를 읽기만 한다.
 */
export function createHud() {
  const style = document.createElement('style');
  style.textContent = `
    #hudbars { position: fixed; left: 16px; bottom: 44px; width: 260px; pointer-events: none; font: 12px/1.3 ui-monospace, monospace; color: #cbbd9e; }
    #hudbars .bar { height: 8px; background: rgba(0,0,0,.55); border: 1px solid rgba(203,189,158,.35); margin-top: 5px; }
    #hudbars .bar > i { display: block; height: 100%; transition: width .08s linear; }
    #hp > i { background: #a83a2c; } #st > i { background: #b8a24a; } #st.low > i { background: #6d5e2a; }
    #hudbars .row { display: flex; justify-content: space-between; margin-top: 6px; opacity: .85; }
    #lock { position: fixed; width: 22px; height: 22px; margin: -11px 0 0 -11px; border: 2px solid rgba(255,200,120,.9); border-radius: 50%; pointer-events: none; display: none; box-shadow: 0 0 6px rgba(255,160,60,.6); }
    #toast { position: fixed; left: 50%; top: 38%; transform: translateX(-50%); font: 600 22px/1 serif; color: #ffd28a; text-shadow: 0 0 8px #000; pointer-events: none; opacity: 0; transition: opacity .25s; }
    #dead { position: fixed; inset: 0; display: none; place-items: center; background: rgba(20,0,0,.55); color: #e8c4b0; font: 28px/1.6 serif; text-align: center; }
    #dead small { display: block; font-size: 14px; color: #b09080; }
    .gob-mark { position: fixed; left: 0; top: 0; font: 700 22px/1 serif; color: #ffcf6a; text-shadow: 0 0 6px #000, 0 0 2px #000; pointer-events: none; display: none; }
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hudbars';
  root.innerHTML = `<div id="hp" class="bar"><i></i></div><div id="st" class="bar"><i></i></div><div class="row"><span id="torch"></span><span id="state"></span></div>`;
  const lock = Object.assign(document.createElement('div'), { id: 'lock' });
  const toast = Object.assign(document.createElement('div'), { id: 'toast' });
  const dead = Object.assign(document.createElement('div'), { id: 'dead' });
  dead.innerHTML = '쓰러졌다<small>R — 다시 시작</small>';
  document.body.append(root, lock, toast, dead);
  const hp = root.querySelector<HTMLElement>('#hp > i')!;
  const st = root.querySelector<HTMLElement>('#st > i')!;
  const stBar = root.querySelector<HTMLElement>('#st')!;
  const torch = root.querySelector<HTMLElement>('#torch')!;
  const state = root.querySelector<HTMLElement>('#state')!;
  let toastUntil = 0;
  let clock = 0;

  return {
    toast(text: string, seconds = 0.8) {
      toast.textContent = text;
      toast.style.opacity = '1';
      toastUntil = clock + seconds;
    },
    update(dt: number, sim: Sim, lockScreen: { x: number; y: number } | null) {
      clock += dt;
      const p = sim.player;
      hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
      st.style.width = `${(p.stamina / STAMINA_MAX) * 100}%`;
      stBar.classList.toggle('low', p.exhausted);
      const senseLeft = Math.max(0, p.senseReadyAt - sim.tick);
      torch.textContent = `횃불 ${p.heldTorch >= 0 ? '들고 있음' : '없음'} · 예비 ${p.spareTorches} · 돌의 감각 ${senseLeft > 0 ? `${Math.ceil(senseLeft / 60)}초` : '준비'}`;
      state.textContent = sim.tick < p.riposteUntil ? '반격!' : '';
      if (lockScreen) {
        lock.style.display = 'block';
        lock.style.left = `${lockScreen.x}px`;
        lock.style.top = `${lockScreen.y}px`;
      } else lock.style.display = 'none';
      if (clock > toastUntil) toast.style.opacity = '0';
      dead.style.display = p.action === 'dead' ? 'grid' : 'none';
    },
  };
}
