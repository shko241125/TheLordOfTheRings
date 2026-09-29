import { BTN_INTERACT, BTN_WORD, type Sim } from './types';

/** E가 닿는 거리 (m) */
export const INTERACT_RANGE = 2.2;
/** 두린의 문 앞으로 인정하는 거리 (m) — 수수께끼 창도 이 안에서만 열린다 */
export const DOOR_RANGE = 6;

export type Interactable = { kind: 'brazier'; index: number; lit: boolean } | { kind: 'door'; index: number };

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
  for (let i = 0; i < sim.doors.length; i++) {
    const door = sim.doors[i]!;
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
  else if (target.kind === 'door' && (pressed & BTN_WORD) !== 0) {
    openDoor(sim, target.index);
    sim.events.push({ type: 'door', tick: sim.tick, door: target.index });
  }
}

/** 저장에서 되살릴 진행 상태 */
export type Progress = { doorsOpen: number[]; lit: number[]; checkpoint: number };

export function progressOf(sim: Sim): Progress {
  return {
    doorsOpen: sim.doors.flatMap((d, i) => (d.open ? [i] : [])),
    lit: sim.braziers.flatMap((b, i) => (b.lit ? [i] : [])),
    checkpoint: sim.checkpoint,
  };
}

/** 새로 만든 시뮬레이션에 진행 상태를 입힌다 (첫 틱 전에만 호출). 범위를 벗어난 번호는 무시한다 */
export function restoreProgress(sim: Sim, pr: Progress) {
  for (const i of pr.doorsOpen) if (sim.doors[i]) openDoor(sim, i);
  for (const i of pr.lit) if (sim.braziers[i]) sim.braziers[i]!.lit = true;
  const b = sim.braziers[pr.checkpoint];
  if (!b) return;
  sim.checkpoint = pr.checkpoint;
  // 화로 1.5m 앞(+Z)에서, 캡슐 중심은 바닥 + 1.2m (레벨 spawn과 같은 규칙)
  sim.player.body.setTranslation({ x: b.x, y: b.y + 1.2, z: b.z + 1.5 }, true);
}
