import { finishDefense, startDefense } from './defense';
import { lightForge } from './forge';
import { LOOT_PICK_R, pickupItem } from './gear';
import { BTN_INTERACT, BTN_WORD, type Sim } from './types';

/** E가 닿는 거리 (m) */
export const INTERACT_RANGE = 2.2;
/** 두린의 문 앞으로 인정하는 거리 (m) — 수수께끼 창도 이 안에서만 열린다 */
export const DOOR_RANGE = 6;

export type Interactable =
  | { kind: 'brazier'; index: number; lit: boolean }
  | { kind: 'door'; index: number }
  | { kind: 'lamp'; index: number }
  | { kind: 'loot'; id: number; name: string; grade: number }
  | { kind: 'tomb' }
  | { kind: 'npc'; index: number; name: string }
  | { kind: 'page'; index: number };

/** 지금 플레이어가 상호작용할 수 있는 가장 가까운 대상 (렌더의 안내 문구와 시뮬레이션이 같은 판정을 쓴다) */
export function nearestInteractable(sim: Sim): Interactable | null {
  const t = sim.player.body.translation();
  let best: Interactable | null = null;
  let bestD = Infinity;
  // 결정성: Math.hypot은 구현마다 근사가 달라도 되지만 Math.sqrt는 정확히 반올림된다
  const dist = (x: number, z: number) => Math.sqrt((x - t.x) * (x - t.x) + (z - t.z) * (z - t.z));
  for (let i = 0; i < sim.braziers.length; i++) {
    const b = sim.braziers[i]!;
    const d = dist(b.x, b.z);
    if (d <= INTERACT_RANGE && Math.abs(b.y + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'brazier', index: i, lit: b.lit };
    }
  }
  for (const l of sim.loot) {
    if (!l.item) continue;
    const d = dist(l.x, l.z);
    if (d <= LOOT_PICK_R && Math.abs(l.y + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'loot', id: l.id, name: l.item.name, grade: l.item.grade };
    }
  }
  for (let i = 0; i < sim.lamps.length; i++) {
    const l = sim.lamps[i]!;
    const d = dist(l.x, l.z);
    if (!l.lit && d <= INTERACT_RANGE + 0.6 && Math.abs(l.y + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'lamp', index: i };
    }
  }
  for (const [i, n] of (sim.level.npcs ?? []).entries()) {
    const d = dist(n.pos[0], n.pos[2]);
    if (d <= INTERACT_RANGE + 0.3 && Math.abs(n.pos[1] + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'npc', index: i, name: n.name };
    }
  }
  const def = sim.level.defense;
  if (def && sim.defense.state === 'idle') {
    const d = dist(def.at[0], def.at[2]);
    if (d <= INTERACT_RANGE + 1 && Math.abs(def.at[1] + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'tomb' };
    }
  }
  for (let i = 0; i < sim.pages.length; i++) {
    const pg = sim.pages[i]!;
    const d = dist(pg.x, pg.z);
    if (!pg.taken && d <= INTERACT_RANGE && Math.abs(pg.y + 1 - t.y) < 2 && d < bestD) {
      bestD = d;
      best = { kind: 'page', index: i };
    }
  }
  for (let i = 0; i < sim.doors.length; i++) {
    const door = sim.doors[i]!;
    // 등불로 여는 문은 비문 수수께끼가 아니다
    if (sim.level.lampDoors?.includes(i) || sim.level.defense?.doors.includes(i) || sim.level.forge?.doors.includes(i)) continue;
    const d = dist(door.pos[0], door.pos[2]);
    if (!door.open && d <= DOOR_RANGE && d < bestD) {
      bestD = d;
      best = { kind: 'door', index: i };
    }
  }
  return best;
}

export function openDoor(sim: Sim, index: number) {
  const door = sim.doors[index]!;
  if (door.open) return;
  if (door.body) sim.world.removeRigidBody(door.body);
  door.body = null;
  door.open = true;
}

/** 화로에서 쉬기: 처음이면 밝힌다. 체력·스태미나·예비 횃불을 채우고 체크포인트로 삼는다 */
export function restAt(sim: Sim, index: number) {
  const b = sim.braziers[index]!;
  const p = sim.player;
  const first = !b.lit;
  b.lit = true;
  p.hp = p.maxHp;
  p.spareTorches = Math.max(p.spareTorches, 2);
  sim.checkpoint = index;
  sim.events.push({ type: 'rest', tick: sim.tick, brazier: index, first });
}

/** 한 틱: 누른 순간(pressed)의 E·암호를 처리한다. 싸우는 중(행동 중)에는 받지 않는다 */
export function stepInteract(sim: Sim, pressed: number) {
  if ((pressed & (BTN_INTERACT | BTN_WORD)) === 0 || sim.player.action !== 'free') return;
  const target = nearestInteractable(sim);
  if (!target) return;
  if (target.kind === 'brazier' && (pressed & BTN_INTERACT) !== 0) restAt(sim, target.index);
  else if (target.kind === 'lamp' && (pressed & BTN_INTERACT) !== 0) lightLamp(sim, target.index);
  else if (target.kind === 'loot' && (pressed & BTN_INTERACT) !== 0) pickupItem(sim, target.id);
  else if (target.kind === 'tomb' && (pressed & BTN_INTERACT) !== 0) startDefense(sim);
  else if (target.kind === 'page' && (pressed & BTN_INTERACT) !== 0) {
    const pg = sim.pages[target.index]!;
    pg.taken = true;
    sim.events.push({ type: 'page', tick: sim.tick, id: pg.id });
  }
  else if (target.kind === 'door' && (pressed & BTN_WORD) !== 0) {
    openDoor(sim, target.index);
    sim.events.push({ type: 'door', tick: sim.tick, door: target.index });
  }
}

/** 등불 밝히기. 모두 밝히면 등불 문이 열린다 */
export function lightLamp(sim: Sim, index: number, silent = false) {
  const l = sim.lamps[index];
  if (!l || l.lit) return;
  l.lit = true;
  const allLit = sim.lamps.every((x) => x.lit);
  if (!silent) sim.events.push({ type: 'lamp', tick: sim.tick, index, allLit });
  if (allLit) {
    for (const d of sim.level.lampDoors ?? []) {
      if (sim.doors[d]?.open) continue;
      openDoor(sim, d);
      if (!silent) sim.events.push({ type: 'door', tick: sim.tick, door: d });
    }
  }
}

/** 구역 출구: 상자 안이고 조건을 채웠으면 한 번 'exit'. 조건이 안 되면 들어설 때 한 번 'exitLocked' */
export function stepExits(sim: Sim) {
  if (sim.exited) return;
  const t = sim.player.body.translation();
  let inside = false;
  for (const x of sim.level.exits ?? []) {
    if (t.x < x.min[0] || t.x > x.max[0] || t.y < x.min[1] || t.y > x.max[1] || t.z < x.min[2] || t.z > x.max[2]) continue;
    inside = true;
    const ok = (x.requires ?? []).every((r) =>
      r === 'bosses' ? sim.bosses.every((id) => sim.enemies.find((e) => e.id === id)?.ai === 'dead')
        : r === 'lamps' ? sim.lamps.every((l) => l.lit)
          : r === 'forge' ? sim.forge.lit
            : sim.defense.state === 'done',
    );
    if (ok) {
      sim.exited = true;
      sim.events.push({ type: 'exit', tick: sim.tick, to: x.to, entry: x.entry });
      return;
    }
    if (!sim.exitLockedShown) {
      sim.exitLockedShown = true;
      sim.events.push({ type: 'exitLocked', tick: sim.tick, reason: x.locked ?? '길이 막혀 있다' });
    }
  }
  if (!inside) sim.exitLockedShown = false;
}

/** 저장에서 되살릴 진행 상태 */
export type Progress = {
  doorsOpen: number[];
  lit: number[];
  checkpoint: number;
  /** 쓰러뜨린 보스 (레벨 bosses 번호) */
  bossesDown: number[];
  /** 밝힌 퀘스트 등불 */
  lampsLit: number[];
  /** 방어전을 끝냈다 (구역 3) */
  defended?: boolean;
  /** 모루를 다시 지폈다 (구역 4) */
  forged?: boolean;
};

export function progressOf(sim: Sim): Progress {
  return {
    doorsOpen: sim.doors.flatMap((d, i) => (d.open ? [i] : [])),
    lit: sim.braziers.flatMap((b, i) => (b.lit ? [i] : [])),
    checkpoint: sim.checkpoint,
    bossesDown: sim.bosses.flatMap((id, i) => (sim.enemies.find((e) => e.id === id)?.ai === 'dead' ? [i] : [])),
    lampsLit: sim.lamps.flatMap((l, i) => (l.lit ? [i] : [])),
    ...(sim.defense.state === 'done' ? { defended: true } : {}),
    ...(sim.forge.lit ? { forged: true } : {}),
  };
}

/** 새로 만든 시뮬레이션에 진행 상태를 입힌다 (첫 틱 전에만 호출). 범위를 벗어난 번호는 무시한다 */
export function restoreProgress(sim: Sim, pr: Progress, entry: string | null = null) {
  for (const i of pr.doorsOpen) if (sim.doors[i]) openDoor(sim, i);
  for (const i of pr.lampsLit ?? []) lightLamp(sim, i, true);
  for (const i of pr.lit) if (sim.braziers[i]) sim.braziers[i]!.lit = true;
  if (pr.defended) finishDefense(sim, true);
  if (pr.forged) lightForge(sim, true);
  for (const i of pr.bossesDown) {
    const e = sim.enemies.find((x) => x.id === sim.bosses[i]);
    if (!e) continue;
    // 조용히 쓰러진 상태로 (사건·긴장도 없이)
    e.hp = 0;
    e.ai = 'dead';
    e.aiTick = 10_000;
    e.collider.setCollisionGroups(0);
  }
  const b = sim.braziers[pr.checkpoint];
  // 쉰 화로가 없으면 들어온 입구에 선다 (구역을 옮겨 왔을 때)
  const en = entry ? sim.level.entries?.[entry] : undefined;
  if (!b && en) {
    sim.player.body.setTranslation({ x: en.pos[0], y: en.pos[1], z: en.pos[2] }, true);
    sim.player.facing = en.facing;
    return;
  }
  if (!b) return;
  sim.checkpoint = pr.checkpoint;
  // 화로 1.5m 앞(+Z)에서, 캡슐 중심은 바닥 + 1.2m (레벨 spawn과 같은 규칙)
  sim.player.body.setTranslation({ x: b.x, y: b.y + 1.2, z: b.z + 1.5 }, true);
}

/** 저장에서: 이미 주운 책 조각 (게임 전체의 id) */
export function restorePages(sim: Sim, ids: readonly number[]) {
  for (const pg of sim.pages) if (ids.includes(pg.id)) pg.taken = true;
}
