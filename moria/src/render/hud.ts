import type { Interactable } from '../sim/interact';
import type { Level } from '../sim/level';
import type { Sim } from '../sim/types';
import { STAMINA_MAX } from '../sim/combat';
import { SENSE_COOLDOWN } from '../sim/player';
import { xpToNext } from '../sim/growth';
import { GRADE_COLORS, GRADE_NAMES } from '../sim/items';

/**
 * HUD (HTML 오버레이 — 계획서 13장). 전투 중에는 가장자리에만: 좌하단 체력·스태미나, 락온 표식, 짧은 알림.
 *  - 지연 체력바: 맞으면 줄어든 만큼 흰 띠가 0.5초 남았다가 천천히 따라 줄어든다 (플레이어·보스).
 *  - 비전투 5초가 지나면 좌하단 막대가 흐려진다 (opacity 0.3). 체력이 35% 아래면 늘 또렷하게.
 *  - 보스바 눈금: 페이즈가 바뀌는 체력 지점.
 *  - 하단 중앙 행동 칸 4개: 횃불(예비 수) · 돌의 감각(재사용 원형 스위프) · 동료(게이지 스위프) · 약초(개수). 칸 위에 지금 키.
 *  - 월드 안: 락온한 적의 작은 체력바(보스는 위쪽 보스바), 피해 숫자 (노드 8개를 돌려 쓴다 — DOM이 늘지 않는다).
 * 게임 로직은 DOM을 만지지 않는다 — 여기서 시뮬레이션 상태를 읽기만 한다.
 */
export function createHud() {
  const style = document.createElement('style');
  style.textContent = `
    #hudbars { position: fixed; left: 16px; bottom: 44px; width: 260px; pointer-events: none; font: 12px/1.3 ui-monospace, monospace; color: #cbbd9e; }
    #hudbars { transition: opacity .6s; }
    #hudbars .bar { position: relative; height: 8px; background: rgba(0,0,0,.55); border: 1px solid rgba(203,189,158,.35); margin-top: 5px; }
    #hudbars .bar > i, #boss .bar > i { position: relative; display: block; height: 100%; transition: width .08s linear; }
    .bar > b { position: absolute; left: 0; top: 0; bottom: 0; background: rgba(240,228,205,.75); }
    #boss .bar > s { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: rgba(240,228,205,.8); }
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
    #boss .bar { position: relative; height: 9px; margin-top: 4px; background: rgba(0,0,0,.6); border: 1px solid rgba(203,189,158,.4); }
    #boss .bar > i { background: #8e2a1c; }
    #goal { position: fixed; left: 16px; top: 60px; max-width: min(420px, 60vw); font: 14px/1.4 serif; color: #e6d6b8; text-shadow: 0 0 5px #000, 0 0 2px #000; pointer-events: none; }
    #goal b { display: block; font: 600 11px/1.4 ui-monospace, monospace; color: #b8a888; letter-spacing: .05em; }
    #page { position: fixed; left: 50%; bottom: 30%; transform: translateX(-50%); max-width: min(560px, 88vw); padding: 12px 18px; background: rgba(30,22,12,.82); border: 1px solid rgba(203,189,158,.45); font: italic 16px/1.6 serif; color: #e6d6b8; pointer-events: none; opacity: 0; transition: opacity .4s; }
    #page b { display: block; font: 600 13px/1.4 serif; font-style: normal; color: #cbbd9e; margin-bottom: 4px; }
    #minimap { position: fixed; right: 16px; top: 16px; pointer-events: none; opacity: .85; }
    #lockhp { position: fixed; width: 54px; height: 4px; margin: 16px 0 0 -27px; background: rgba(0,0,0,.6); border: 1px solid rgba(203,189,158,.4); pointer-events: none; display: none; }
    #lockhp > i { display: block; height: 100%; background: #a83a2c; }
    .dmg { position: fixed; left: 0; top: 0; font: 700 16px/1 ui-monospace, monospace; color: #f0e2c0; text-shadow: 0 0 4px #000, 0 0 2px #000; pointer-events: none; opacity: 0; }
    .dmg.heavy { font-size: 21px; color: #ffcf6a; }
    #slots { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); display: flex; gap: 8px; pointer-events: none; transition: opacity .6s; }
    #slots > div { position: relative; width: 50px; height: 50px; border: 1px solid rgba(203,189,158,.45); background: rgba(74,64,48,.6); font: 11px/1.2 serif; color: #e6d6b8; text-align: center; overflow: hidden; }
    #slots > div > u { position: absolute; inset: 0; background: conic-gradient(rgba(0,0,0,.8) calc(var(--p, 0) * 1turn), transparent 0); text-decoration: none; }
    #slots span { position: relative; display: block; margin-top: 17px; text-shadow: 0 0 3px #000; }
    #slots kbd { position: absolute; left: 3px; top: 2px; font: 600 10px ui-monospace, monospace; color: #b8a888; }
    #slots em { position: absolute; right: 4px; bottom: 2px; font: 600 12px ui-monospace, monospace; font-style: normal; }
    #slots .ready { border-color: rgba(255,207,106,.9); box-shadow: 0 0 6px rgba(255,170,70,.5); }
    #slots .empty { opacity: .45; }
    .gob-mark { position: fixed; left: 0; top: 0; font: 700 22px/1 serif; color: #ffcf6a; text-shadow: 0 0 6px #000, 0 0 2px #000; pointer-events: none; display: none; }
  `;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.id = 'hudbars';
  root.innerHTML = `<div id="lv" class="row" style="margin:0 0 4px"></div><div id="hp" class="bar"><b></b><i></i></div><div id="st" class="bar"><i></i></div><div class="row"><span id="state"></span></div>`;
  const lock = Object.assign(document.createElement('div'), { id: 'lock' });
  const toast = Object.assign(document.createElement('div'), { id: 'toast' });
  const dead = Object.assign(document.createElement('div'), { id: 'dead' });
  dead.innerHTML = '쓰러졌다<small>R — 다시 시작</small>';
  let deathMode: 'auto' | 'shown' = 'auto';
  const prompt = Object.assign(document.createElement('div'), { id: 'prompt' });
  const boss = Object.assign(document.createElement('div'), { id: 'boss' });
  boss.innerHTML = '<span></span><div class="bar"><b></b><i></i></div>';
  const page = Object.assign(document.createElement('div'), { id: 'page' });
  const goal = Object.assign(document.createElement('div'), { id: 'goal' });
  const lockHp = Object.assign(document.createElement('div'), { id: 'lockhp', innerHTML: '<i></i>' });
  const dmg = Array.from({ length: 8 }, () => Object.assign(document.createElement('div'), { className: 'dmg' }));
  let dmgNext = 0;
  const slots = Object.assign(document.createElement('div'), { id: 'slots' });
  const SLOT_NAMES = { torch: '횃불', sense: '감각', call: '동료', drink: '약초' } as const;
  type SlotId = keyof typeof SLOT_NAMES;
  slots.innerHTML = (Object.keys(SLOT_NAMES) as SlotId[]).map((k) => `<div data-s="${k}"><u></u><kbd></kbd><span>${SLOT_NAMES[k]}</span><em></em></div>`).join('');
  const slot = (k: SlotId) => {
    const el = slots.querySelector<HTMLElement>(`[data-s="${k}"]`)!;
    return { el, sweep: el.querySelector('u')!, key: el.querySelector('kbd')!, count: el.querySelector('em')! };
  };
  const slotEls = { torch: slot('torch'), sense: slot('sense'), call: slot('call'), drink: slot('drink') };
  document.body.append(root, lock, toast, dead, prompt, boss, page, goal, lockHp, slots, ...dmg);
  let goalText = '';
  let pageUntil = 0;
  const hp = root.querySelector<HTMLElement>('#hp > i')!;
  const st = root.querySelector<HTMLElement>('#st > i')!;
  const stBar = root.querySelector<HTMLElement>('#st')!;
  const level = root.querySelector<HTMLElement>('#lv')!;
  const state = root.querySelector<HTMLElement>('#state')!;
  let toastUntil = 0;
  let clock = 0;
  /** 지연 막대: 보이는 폭(0..1)이 목표를 따라간다. 줄 때만 0.5초 기다렸다가 초당 40%씩. 목표가 바뀌었으면 true */
  let lastDt = 0;
  const trail = (el: HTMLElement) => {
    let shown = 1;
    let last = 1;
    let holdUntil = 0;
    return (target: number) => {
      if (target < last) holdUntil = clock + 0.5;
      const changed = target !== last;
      last = target;
      if (target >= shown) shown = target;
      else if (clock >= holdUntil) shown = Math.max(target, shown - 0.4 * lastDt);
      el.style.width = `${shown * 100}%`;
      return changed;
    };
  };
  const hpTrail = trail(root.querySelector<HTMLElement>('#hp > b')!);
  const bossTrail = trail(boss.querySelector<HTMLElement>('b')!);
  let bossMarks = '';
  let interactKey = 'E';
  let lastPrompt = '';
  let lastBusy = -Infinity;

  return {
    /** 지금 목표 한 줄 (메인 퀘스트의 지금 단계). 바뀔 때만 다시 쓴다 */
    goal(title: string, text: string) {
      const t = `${title}\n${text}`;
      if (t === goalText) return;
      goalText = t;
      goal.innerHTML = '<b></b><span></span>';
      goal.querySelector('b')!.textContent = title;
      goal.querySelector('span')!.textContent = text;
      goal.style.display = text ? 'block' : 'none';
    },
    /** 마자르불의 책 조각 한 장 (몇 초 보였다 사라진다) */
    page(title: string, text: string, seconds = 9) {
      page.innerHTML = '<b></b><span></span>';
      page.querySelector('b')!.textContent = title;
      page.querySelector('span')!.textContent = `“${text}”`;
      page.style.opacity = '1';
      pageUntil = clock + seconds;
    },
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
    /** 보스 체력바 (깨어 있을 때만). marks: 페이즈가 바뀌는 체력 비율 (눈금) */
    boss(b: { name: string; hp: number; max: number; awake: boolean; marks?: readonly number[] } | null) {
      boss.style.display = b?.awake ? 'block' : 'none';
      if (!b?.awake) return;
      boss.querySelector('span')!.textContent = b.name;
      boss.querySelector<HTMLElement>('i')!.style.width = `${(b.hp / b.max) * 100}%`;
      bossTrail(b.hp / b.max);
      const key = (b.marks ?? []).join();
      if (key !== bossMarks) {
        bossMarks = key;
        const bar = boss.querySelector('.bar')!;
        bar.querySelectorAll('s').forEach((x) => x.remove());
        for (const m of b.marks ?? []) bar.insertAdjacentHTML('beforeend', `<s style="left:${m * 100}%"></s>`);
      }
    },
    /** 행동 칸·상호작용 안내에 보일 키 이름 (키 배치를 바꾸거나 마지막으로 쓴 장치가 바뀌면 다시 부른다) */
    keys(k: Record<SlotId | 'interact', string>) {
      for (const id of Object.keys(slotEls) as SlotId[]) slotEls[id].key.textContent = k[id];
      interactKey = k.interact;
      lastPrompt = '';
    },
    /** 피해 숫자 (화면 좌표). 0.8초 동안 떠오르며 사라진다. 가장 오래된 노드를 다시 쓴다 */
    damage(x: number, y: number, amount: number, heavy: boolean) {
      const el = dmg[dmgNext++ % dmg.length]!;
      el.textContent = String(Math.round(amount));
      el.classList.toggle('heavy', heavy);
      el.style.left = `${x + (Math.random() - 0.5) * 24}px`;
      el.style.top = `${y}px`;
      el.getAnimations().forEach((a) => a.cancel());
      el.animate([{ transform: 'translate(-50%, 0)', opacity: 1 }, { transform: 'translate(-50%, -42px)', opacity: 0 }], { duration: 800, easing: 'ease-out' });
    },
    /** 가까운 상호작용 대상 안내 (창이 열려 있으면 숨긴다) */
    prompt(target: Interactable | null, hidden: boolean) {
      const text = !target || hidden ? ''
        : target.kind === 'door' ? '비문 읽기'
        : target.kind === 'lamp' ? '등불 밝히기'
        : target.kind === 'npc' ? `대화 — ${target.name}`
        : target.kind === 'escort' ? `${target.saved ? '대화' : '데리고 나가기'} — ${target.name}`
        : target.kind === 'tomb' ? '발린의 무덤 — 책을 펼친다 (방어전 시작)'
        : target.kind === 'page' ? '마자르불의 책 조각 줍기'
        : target.kind === 'loot' ? `줍기 — <span style="color:${GRADE_COLORS[target.grade]}">${GRADE_NAMES[target.grade]} ${target.name}</span>`
        : target.lit ? '쉬기 (저장)' : '화로 밝히기';
      prompt.style.display = text ? 'block' : 'none';
      if (text && text !== lastPrompt) prompt.innerHTML = `${interactKey ? `<b>${interactKey}</b>` : ''}${text}`;
      lastPrompt = text;
    },
    /** lockHp: 락온한 일반 적의 체력 비율 (보스·없음이면 null) */
    update(dt: number, sim: Sim, lockScreen: { x: number; y: number } | null, lockHpFrac: number | null = null) {
      clock += dt;
      lastDt = dt;
      const p = sim.player;
      hp.style.width = `${(p.hp / p.maxHp) * 100}%`;
      const hpChanged = hpTrail(p.hp / p.maxHp);
      // 전투 중 = 락온, 스태미나 회복 중, 체력 변화, 공격·회피 등 행동 중. 그 뒤 5초 지나면 흐리게
      if (lockScreen || p.stamina < STAMINA_MAX || p.action !== 'free' || hpChanged) lastBusy = clock;
      root.style.opacity = slots.style.opacity = clock - lastBusy > 5 && p.hp > p.maxHp * 0.35 ? '0.3' : '1';
      st.style.width = `${(p.stamina / STAMINA_MAX) * 100}%`;
      stBar.classList.toggle('low', p.exhausted);
      const senseLeft = Math.max(0, p.senseReadyAt - sim.tick);
      level.textContent = `Lv ${p.level} · XP ${Math.floor(p.xp)}/${xpToNext(p.level)}${p.points ? ` · 스킬 포인트 ${p.points} (Tab)` : ''}${p.perks.includes('story') ? ' · 스토리' : ''}`;
      const { torch: t, sense: se, call: ca, drink: dr } = slotEls;
      t.count.textContent = String(p.spareTorches);
      t.el.classList.toggle('ready', p.heldTorch >= 0);
      t.el.classList.toggle('empty', p.heldTorch < 0 && p.spareTorches === 0);
      se.sweep.style.setProperty('--p', String(senseLeft / Math.max(1, SENSE_COOLDOWN - p.mods.senseCd)));
      se.count.textContent = senseLeft > 0 ? String(Math.ceil(senseLeft / 60)) : '';
      ca.sweep.style.setProperty('--p', String(1 - Math.min(100, p.companion) / 100));
      ca.el.classList.toggle('ready', p.companion >= 100);
      dr.count.textContent = String(p.draughts);
      dr.el.classList.toggle('empty', p.draughts === 0);
      state.textContent = sim.tick < p.riposteUntil ? '반격!' : '';
      if (lockScreen) {
        lock.style.display = 'block';
        lock.style.left = `${lockScreen.x}px`;
        lock.style.top = `${lockScreen.y}px`;
      } else lock.style.display = 'none';
      lockHp.style.display = lockScreen && lockHpFrac !== null ? 'block' : 'none';
      if (lockScreen && lockHpFrac !== null) {
        lockHp.style.left = `${lockScreen.x}px`;
        lockHp.style.top = `${lockScreen.y}px`;
        lockHp.querySelector<HTMLElement>('i')!.style.width = `${Math.max(0, lockHpFrac) * 100}%`;
      }
      if (clock > toastUntil) toast.style.opacity = '0';
      if (clock > pageUntil) page.style.opacity = '0';
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
