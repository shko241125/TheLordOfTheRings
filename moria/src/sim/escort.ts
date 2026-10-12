import { DT } from '../core/loop';
import type { Level } from './level';
import { refreshMods } from './growth';
import { pathTo } from './nav';
import type { Sim, V3 } from './types';

/**
 * 호위 (계획서 7장 구역 2 사이드 퀘스트 '갇힌 광부 구출' — 퀘스트 유형 6종 중 호위).
 *   21번째 홀 구석에 갇힌 광부가 E로 말을 걸면 따라온다 (내비메시 경로로 플레이어 2.2m 뒤까지, 3.6m/s).
 *   적(진짜 고블린·궁수·우루크 1.3m, 무리 1m) 곁에 있으면 다친다 — 지켜야 한다. 체력 0이면 쓰러진다 (다시 하려면 화로에서 이어하기).
 *   동쪽 층계 화로 곁(goal)에 닿으면 구출: 미스릴 4 + 금화 60 + 영구 '동료 게이지 +25%' (계획서: 사이드 보상 = 동료 호출 강화).
 * 광부는 물리 바디가 없는 점이다 (적의 공격 대상이 아니고 길도 막지 않는다 — 다치는 것은 '적 곁'이라는 거리로만).
 */
export type EscortState = {
  state: 'waiting' | 'following' | 'saved' | 'dead';
  x: number;
  y: number;
  z: number;
  hp: number;
  path: V3[];
  pathIdx: number;
  repathAt: number;
  /** 다쳤다는 알림을 다시 내도 되는 틱 */
  hurtAt: number;
};

export const ESCORT_HP = 100;
const SPEED = 3.6;
const KEEP = 2.2;
const ENEMY_R = 1.3;
const HORDE_R = 1.0;

export function createEscort(level: Level): EscortState {
  const p = level.escort?.pos ?? [0, 0, 0];
  return { state: 'waiting', x: p[0], y: p[1], z: p[2], hp: ESCORT_HP, path: [], pathIdx: 0, repathAt: 0, hurtAt: 0 };
}

export function startEscort(sim: Sim) {
  if (!sim.level.escort || sim.escort.state !== 'waiting') return;
  sim.escort.state = 'following';
  sim.events.push({ type: 'escort', tick: sim.tick, stage: 'follow' });
}

/** 구출 (도착했을 때, 저장에서 되살릴 때) — 광부는 목적지에 선다 */
export function finishEscort(sim: Sim) {
  const g = sim.level.escort?.goal;
  if (!g) return;
  Object.assign(sim.escort, { state: 'saved', x: g[0] - 1.2, y: g[1], z: g[2] + 1.6, path: [] });
}

export function stepEscort(sim: Sim) {
  const es = sim.escort;
  const def = sim.level.escort;
  if (!def || es.state !== 'following') return;
  const pt = sim.player.body.translation();
  const footY = pt.y - (sim.player.stats.capsuleHalf + sim.player.stats.capsuleRadius);
  // 따라가기: 플레이어 2.2m 뒤까지
  const dx = pt.x - es.x, dz = pt.z - es.z;
  if (dx * dx + dz * dz > KEEP * KEEP) {
    if (sim.tick >= es.repathAt || es.pathIdx >= es.path.length) {
      es.path = pathTo(sim.nav, [es.x, es.y, es.z], [pt.x, footY, pt.z], sim.navBlock.filter);
      es.pathIdx = 0;
      es.repathAt = sim.tick + 30;
    }
    let step = SPEED * DT;
    while (step > 0 && es.pathIdx < es.path.length) {
      const c = es.path[es.pathIdx]!;
      const cx = c[0] - es.x, cz = c[2] - es.z;
      const d = Math.sqrt(cx * cx + cz * cz);
      if (d <= step) {
        es.x = c[0];
        es.z = c[2];
        es.y = c[1];
        es.pathIdx++;
        step -= d;
      } else {
        es.x += (cx / d) * step;
        es.z += (cz / d) * step;
        step = 0;
      }
    }
  }
  // 적 곁이면 다친다
  let dmg = 0;
  for (const e of sim.enemies) {
    if (e.ai === 'dead' || sim.bosses.includes(e.id)) continue;
    const t = e.body.translation();
    if ((t.x - es.x) ** 2 + (t.z - es.z) ** 2 < ENEMY_R * ENEMY_R) dmg += 0.25;
  }
  for (const a of sim.horde?.agents ?? []) if ((a.x - es.x) ** 2 + (a.z - es.z) ** 2 < HORDE_R * HORDE_R) dmg += 0.1;
  if (dmg > 0) {
    es.hp = Math.max(0, es.hp - dmg);
    if (sim.tick >= es.hurtAt) {
      es.hurtAt = sim.tick + 180;
      sim.events.push({ type: 'escort', tick: sim.tick, stage: 'hurt' });
    }
    if (es.hp === 0) {
      es.state = 'dead';
      sim.events.push({ type: 'escort', tick: sim.tick, stage: 'dead' });
      return;
    }
  }
  // 도착
  const g = def.goal;
  if ((g[0] - es.x) ** 2 + (g[2] - es.z) ** 2 < def.goalR * def.goalR) {
    finishEscort(sim);
    const p = sim.player;
    p.mithril += 4;
    p.gold += 60;
    if (!p.perks.includes('miner')) p.perks.push('miner');
    refreshMods(sim);
    sim.events.push({ type: 'escort', tick: sim.tick, stage: 'saved' });
  }
}
