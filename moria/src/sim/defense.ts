import { createEnemy } from './enemy';
import { spawnHorde } from './horde';
import { openDoor } from './interact';
import { pathTo } from './nav';
import type { Sim, V3 } from './types';

/**
 * 방어전 (계획서 7장 구역 3 — 봉쇄된 문 지키기, 3웨이브). 퀘스트 유형 '방어'의 첫 구현.
 *   idle → (무덤에서 E) start → 예고 4초 → 물결 1 → 정리되면 쉼 5초 → 물결 2 → … → done (문이 열린다)
 * 물결이 정리됨 = 방어전이 시작된 뒤 나온 진짜 적이 모두 쓰러지고 무리(점)가 2 이하. 90초가 지나면 정리되지 않아도 다음으로 간다
 * (무리 몇 마리가 닿지 못하는 곳에 끼어 방어전이 영영 끝나지 않는 일을 막는다).
 * 스폰 자리는 물결마다 번갈아 쓰고, 붕괴로 봉쇄돼 플레이어에게 가는 길이 없는 자리는 건너뛴다 — 기둥을 무너뜨려 한쪽 굴을 막는 것이 전략이 된다.
 * 방어전 동안 북소리 디렉터는 쉰다 (물결이 겹치지 않게).
 */
export type DefenseState = {
  state: 'idle' | 'warn' | 'wave' | 'rest' | 'done';
  /** 지금(또는 다음) 물결 번호 0.. */
  wave: number;
  tick: number;
  /** 방어전이 시작될 때의 nextEnemyId — 이 뒤로 나온 적이 방어전의 적이다 */
  firstId: number;
};

const WARN = 4 * 60;
const REST = 5 * 60;
const WAVE_MAX = 90 * 60;

export const createDefense = (): DefenseState => ({ state: 'idle', wave: 0, tick: 0, firstId: 0 });

export const defenseActive = (sim: Sim) => sim.defense.state !== 'idle' && sim.defense.state !== 'done';

/** 무덤에서 E */
export function startDefense(sim: Sim) {
  const d = sim.defense;
  if (!sim.level.defense || d.state !== 'idle') return;
  Object.assign(d, { state: 'warn', wave: 0, tick: 0, firstId: sim.nextEnemyId });
  sim.events.push({ type: 'defense', tick: sim.tick, stage: 'start', wave: 0, of: sim.level.defense.waves.length });
}

/** 저장에서: 이미 끝낸 방어전 */
export function finishDefense(sim: Sim, silent: boolean) {
  const def = sim.level.defense;
  if (!def) return;
  sim.defense.state = 'done';
  for (const i of def.doors) {
    if (sim.doors[i]?.open) continue;
    openDoor(sim, i);
    if (!silent) sim.events.push({ type: 'door', tick: sim.tick, door: i });
  }
}

function spawnWave(sim: Sim) {
  const def = sim.level.defense!;
  const w = def.waves[sim.defense.wave]!;
  const me = sim.player.body.translation();
  const open = def.spawns.filter((p) => pathTo(sim.nav, [me.x, me.y, me.z], [p[0], p[1], p[2]], sim.navBlock.filter).length > 0);
  // 모두 막혔으면 (둘 다 무너뜨림) 그래도 나온다 — 무리는 못 오고 진짜 적은 잔해 가장자리까지 온다
  const spots = open.length ? open : def.spawns;
  const kinds = [
    ...Array<'uruk'>(w.uruks).fill('uruk'),
    ...Array<'goblin'>(w.goblins).fill('goblin'),
    ...Array<'archer'>(w.archers).fill('archer'),
  ];
  kinds.forEach((k, i) => {
    const at = spots[(i + sim.defense.wave) % spots.length]!;
    const pos: V3 = [at[0] + ((i >> 1) % 3 - 1) * 0.9, at[1], at[2] + ((i >> 1) % 2) * 0.9];
    const e = createEnemy(sim, sim.nextEnemyId++, pos, [pos], k);
    e.ai = 'chase';
    e.awareness = 1;
    sim.enemies.push(e);
  });
  // 무리는 자리마다 나눠서
  spots.forEach((at, i) => spawnHorde(sim, [at[0], at[1], at[2]], Math.floor(w.horde / spots.length) + (i < w.horde % spots.length ? 1 : 0)));
  sim.events.push({ type: 'defense', tick: sim.tick, stage: 'wave', wave: sim.defense.wave, of: def.waves.length });
}

function cleared(sim: Sim): boolean {
  const first = sim.defense.firstId;
  return sim.enemies.every((e) => e.id < first || e.ai === 'dead') && (sim.horde?.agents.length ?? 0) <= 2;
}

export function stepDefense(sim: Sim) {
  const d = sim.defense;
  const def = sim.level.defense;
  if (!def || d.state === 'idle' || d.state === 'done') return;
  d.tick++;
  if (sim.player.action === 'dead') return;
  if (d.state === 'warn' || d.state === 'rest') {
    if (d.tick >= (d.state === 'warn' ? WARN : REST)) {
      spawnWave(sim);
      d.state = 'wave';
      d.tick = 0;
    }
    return;
  }
  // wave
  if (d.tick < 60 || (!cleared(sim) && d.tick < WAVE_MAX)) return;
  d.wave++;
  d.tick = 0;
  if (d.wave >= def.waves.length) {
    sim.events.push({ type: 'defense', tick: sim.tick, stage: 'done', wave: d.wave, of: def.waves.length });
    finishDefense(sim, false);
    return;
  }
  d.state = 'rest';
  sim.events.push({ type: 'defense', tick: sim.tick, stage: 'clear', wave: d.wave, of: def.waves.length });
}
