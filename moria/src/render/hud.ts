import type { Interactable } from '../sim/interact';
import type { Level } from '../sim/level';
import type { Sim } from '../sim/types';
import { STAMINA_MAX } from '../sim/combat';
import { xpToNext } from '../sim/growth';
import { GRADE_COLORS, GRADE_NAMES } from '../sim/items';

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
    #dead .book { display: block; max-width: min(640px, 90vw); margin: 10px auto 14px; font: italic 17px/1.6 serif; color: #d9c7a6; }
    #prompt { position: fixed; left: 50%; bottom: 22%; transform: translateX(-50%); font: 16px/1 serif; color: #f0e2c0; text-shadow: 0 0 6px #000; pointer-events: none; display: none; }
    #prompt b { display: inline-block; padding: 2px 7px; margin-right: 6px; border: 1px solid #cbbd9e; border-radius: 3px; font: 600 13px ui-monospace, monospace; }
    #boss { position: fixed; left: 50%; top: 22px; width: min(460px, 70vw); transform: translateX(-50%); pointer-events: none; display: none; font: 15px/1.4 serif; color: #e6d6b8; text-align: center; text-shadow: 0 0 5px #000; }
    #boss .bar { height: 9px; margin-top: 4px; background: rgba(0,0,0,.6); border: 1px solid rgba(203,189,158,.4); }
    #boss .bar > i { display: block; height: 100%; background: #8e2a1c; transition: width .12s linear; }
    #minimap { position: fixed; right: 16px; top: 16px; pointer-events: none; opacity: .85; }
    .gob-mark { position: fixed; left: 0; top: 0; font: 700 22px/1 serif; color: #ffcf6a; text-shadow: 0 0 6px #000, 0 0 2px #000; pointer-events: none; display: none; }
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hudbars';
  root.innerHTML = `<div id="lv" class="row" style="margin:0 0 4px"></div><div id="hp" class="bar"><i></i></div><div id="st" class="bar"><i></i></div><div class="row"><span id="torch"></span><span id="state"></span></div>`;
  const lock = Object.assign(document.createElement('div'), { id: 'lock' });
  const toast = Object.assign(document.createElement('div'), { id: 'toast' });
  const dead = Object.assign(document.createElement('div'), { id: 'dead' });
  dead.innerHTML = '쓰러졌다<small>R — 다시 시작</small>';
  let deathMode: 'auto' | 'shown' = 'auto';
  const prompt = Object.assign(document.createElement('div'), { id: 'prompt' });
  const boss = Object.assign(document.createElement('div'), { id: 'boss' });
  boss.innerHTML = '<span></span><div class="bar"><i></i></div>';
  document.body.append(root, lock, toast, dead, prompt, boss);
  const hp = root.querySelector<HTMLElement>('#hp > i')!;
  const st = root.querySelector<HTMLElement>('#st > i')!;
  const stBar = root.querySelector<HTMLElement>('#st')!;
  const torch = root.querySelector<HTMLElement>('#torch')!;
  const level = root.querySelector<HTMLElement>('#lv')!;
  const state = root.querySelector<HTMLElement>('#state')!;
  let toastUntil = 0;
  let clock = 0;

  return {
    toast(text: string, seconds = 0.8) {
      toast.textContent = text;
      toast.style.opacity = '1';
      toastUntil = clock + seconds;
    },
    /**
     * 쓰러짐 화면: 마자르불의 책 한 줄 + 안내. replayReady면 'B — 마지막 60초 보기'.
     * mode 'replay'는 재생이 끝났을 때 (다시 보기 / 게임으로)
     */
    death(line: string, mode: 'saving' | 'ready' | 'none' | 'replay') {
      deathMode = 'shown';
      const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      const hint =
        mode === 'replay' ? 'R — 다시 보기 · Enter — 게임으로'
        : mode === 'ready' ? 'B — 마지막 60초 보기 · R — 다시 시작'
        : mode === 'saving' ? '기록을 적는 중… · R — 다시 시작'
        : 'R — 다시 시작';
      dead.innerHTML = `${mode === 'replay' ? '기록은 여기서 끝난다' : '쓰러졌다'}<span class="book">마자르불의 책 — “${esc(line)}”</span><small>${hint}</small>`;
      dead.style.display = 'grid';
    },
    /** 보스 체력바 (깨어 있을 때만) */
    boss(b: { name: string; hp: number; max: number; awake: boolean } | null) {
      boss.style.display = b?.awake ? 'block' : 'none';
      if (!b?.awake) return;
      boss.querySelector('span')!.textContent = b.name;
      boss.querySelector<HTMLElement>('i')!.style.width = `${(b.hp / b.max) * 100}%`;
    },
    /** 가까운 상호작용 대상 안내 (창이 열려 있으면 숨긴다) */
    prompt(target: Interactable | null, hidden: boolean) {
      const text = !target || hidden ? ''
        : target.kind === 'door' ? '비문 읽기'
        : target.kind === 'lamp' ? '등불 밝히기'
        : target.kind === 'loot' ? `줍기 — <span style="color:${GRADE_COLORS[target.grade]}">${GRADE_NAMES[target.grade]} ${target.name}</span>`
        : target.lit ? '쉬기 (저장)' : '화로 밝히기';
      prompt.style.display = text ? 'block' : 'none';
      if (text) prompt.innerHTML = `<b>E</b>${text}`;
    },
    update(dt: number, sim: Sim, lockScreen: { x: number; y: number } | null) {
      clock += dt;
      const p = sim.player;
      hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
      st.style.width = `${(p.stamina / STAMINA_MAX) * 100}%`;
      stBar.classList.toggle('low', p.exhausted);
      const senseLeft = Math.max(0, p.senseReadyAt - sim.tick);
      const ally = p.companion >= 100 ? '준비 (Q)' : `${Math.floor(p.companion)}%`;
      level.textContent = `Lv ${p.level} · XP ${Math.floor(p.xp)}/${xpToNext(p.level)}${p.points ? ` · 스킬 포인트 ${p.points} (Tab)` : ''}`;
      torch.textContent = `횃불 ${p.heldTorch >= 0 ? '들고 있음' : '없음'} · 예비 ${p.spareTorches} · 돌의 감각 ${senseLeft > 0 ? `${Math.ceil(senseLeft / 60)}초` : '준비'} · 동료 ${ally}`;
      state.textContent = sim.tick < p.riposteUntil ? '반격!' : '';
      if (lockScreen) {
        lock.style.display = 'block';
        lock.style.left = `${lockScreen.x}px`;
        lock.style.top = `${lockScreen.y}px`;
      } else lock.style.display = 'none';
      if (clock > toastUntil) toast.style.opacity = '0';
      if (deathMode === 'auto') dead.style.display = p.action === 'dead' ? 'grid' : 'none';
    },
  };
}

/**
 * 미니맵 (오른쪽 위). 가 본 방과, 밝힌 화로가 있는 방·그 이웃 방만 그린다 (계획서: 드워프 등불이 지도를 밝힌다).
 * 방이 없는 레벨에서는 만들지 않는다. 위쪽 = 북(−Z).
 */
export function createMinimap(level: Level) {
  const rooms = level.rooms ?? [];
  if (!rooms.length) return null;
  const minX = Math.min(...rooms.map((r) => r.min[0]));
  const maxX = Math.max(...rooms.map((r) => r.max[0]));
  const minZ = Math.min(...rooms.map((r) => r.min[2]));
  const maxZ = Math.max(...rooms.map((r) => r.max[2]));
  const scale = 240 / (maxZ - minZ);
  const pad = 6;
  const canvas = Object.assign(document.createElement('canvas'), { id: 'minimap' });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = (maxX - minX) * scale + pad * 2;
  const h = (maxZ - minZ) * scale + pad * 2;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  document.body.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const X = (x: number) => pad + (x - minX) * scale;
  const Y = (z: number) => pad + (z - minZ) * scale;
  const visited = new Set<number>();
  const portals = level.portals ?? [];
  const braziers = level.braziers ?? [];
  const roomOf = (x: number, y: number, z: number) =>
    rooms.findIndex((r) => x >= r.min[0] && x <= r.max[0] && y >= r.min[1] - 0.5 && y <= r.max[1] && z >= r.min[2] && z <= r.max[2]);

  return {
    visit(room: number) {
      if (room >= 0) visited.add(room);
    },
    draw(sim: Sim, px: number, pz: number, yaw: number) {
      const shown = new Set(visited);
      sim.braziers.forEach((b) => {
        if (!b.lit) return;
        const r = roomOf(b.x, b.y + 0.5, b.z);
        shown.add(r);
        for (const pt of portals) if (pt.a === r) shown.add(pt.b); else if (pt.b === r) shown.add(pt.a);
      });
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,.45)';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#8a7a5c';
      g.fillStyle = 'rgba(120,100,70,.28)';
      g.lineWidth = 1;
      rooms.forEach((r, i) => {
        if (!shown.has(i)) return;
        g.fillRect(X(r.min[0]), Y(r.min[2]), (r.max[0] - r.min[0]) * scale, (r.max[2] - r.min[2]) * scale);
        g.strokeRect(X(r.min[0]) + 0.5, Y(r.min[2]) + 0.5, (r.max[0] - r.min[0]) * scale - 1, (r.max[2] - r.min[2]) * scale - 1);
      });
      (level.lamps ?? []).forEach((l, i) => {
        if (!shown.has(roomOf(l[0], l[1] + 0.5, l[2]))) return;
        g.fillStyle = sim.lamps[i]?.lit ? '#ffcf60' : '#777';
        g.beginPath();
        g.arc(X(l[0]), Y(l[2]), 4, 0, Math.PI * 2);
        g.fill();
      });
      braziers.forEach((b, i) => {
        if (!shown.has(roomOf(b[0], b[1] + 0.5, b[2]))) return;
        g.fillStyle = sim.braziers[i]?.lit ? '#ffa040' : '#666';
        g.beginPath();
        g.arc(X(b[0]), Y(b[2]), 2.5, 0, Math.PI * 2);
        g.fill();
      });
      // 플레이어: 카메라가 보는 방향 삼각형 (앞 = (−sin, −cos))
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      g.fillStyle = '#f4ecd8';
      g.beginPath();
      g.moveTo(X(px + fx * 3), Y(pz + fz * 3));
      g.lineTo(X(px - fx * 1.5 + fz * 1.6), Y(pz - fz * 1.5 - fx * 1.6));
      g.lineTo(X(px - fx * 1.5 - fz * 1.6), Y(pz - fz * 1.5 + fx * 1.6));
      g.fill();
    },
  };
}
