import RAPIER from '@dimforge/rapier3d-compat';
import { dcos, dsin } from '../core/trig';
import { emitNoise, heldTorchPos } from './perception';
import { G_LEVEL, G_TORCH, groups, type Sim, type TorchItem } from './types';

/**
 * 횃불 아이템 (계획서 A 빛의 도박):
 *  - F 짧게: 들고 있으면 발밑에 내려놓기(계속 탄다) / 가까이 놓인 횃불이 있으면 줍기 / 빈손이면 예비 횃불 켜기
 *  - F 길게: 던지기 — Rapier 공으로 날아가 40초 타고 꺼진다. 던진 횃불은 줍지 못한다.
 *  - 던진 횃불은 최대 6개 (가장 오래된 것부터 꺼진다)
 */
export const THROWN_BURN_TICKS = 40 * 60;
export const MAX_THROWN = 6;
const PICKUP_RANGE = 1.6;

function newTorch(sim: Sim, state: TorchItem['state'], x: number, y: number, z: number): TorchItem {
  const t: TorchItem = { id: sim.nextTorchId++, state, body: null, x, y, z, burn: -1, thrown: false };
  sim.torches.push(t);
  return t;
}

export function giveStartingTorch(sim: Sim) {
  const p = sim.player;
  const tr = p.body.translation();
  const [x, y, z] = heldTorchPos(tr.x, tr.y, tr.z, p.facing);
  p.heldTorch = newTorch(sim, 'held', x, y, z).id;
}

export function removeTorch(sim: Sim, t: TorchItem) {
  if (t.body) sim.world.removeRigidBody(t.body);
  sim.torches.splice(sim.torches.indexOf(t), 1);
}

export function torchTap(sim: Sim) {
  const p = sim.player;
  const tr = p.body.translation();
  if (p.heldTorch >= 0) {
    // 내려놓기: 발 앞 바닥
    const t = sim.torches.find((x) => x.id === p.heldTorch)!;
    t.state = 'ground';
    t.x = tr.x - dsin(p.facing) * 0.5;
    t.z = tr.z - dcos(p.facing) * 0.5;
    t.y = tr.y - (p.stats.capsuleHalf + p.stats.capsuleRadius) + 0.15;
    p.heldTorch = -1;
    return;
  }
  // 줍기: 가장 가까운 '내려놓은' 횃불 (던진 것은 제외)
  let best: TorchItem | null = null;
  let bestD = PICKUP_RANGE * PICKUP_RANGE;
  for (const t of sim.torches) {
    if (t.state !== 'ground' || t.thrown) continue;
    const d = (t.x - tr.x) ** 2 + (t.z - tr.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  if (best) {
    best.state = 'held';
    p.heldTorch = best.id;
    return;
  }
  if (p.spareTorches > 0) {
    p.spareTorches--;
    const [x, y, z] = heldTorchPos(tr.x, tr.y, tr.z, p.facing);
    p.heldTorch = newTorch(sim, 'held', x, y, z).id;
  }
}

export function torchThrow(sim: Sim) {
  const p = sim.player;
  if (p.heldTorch < 0) return;
  const t = sim.torches.find((x) => x.id === p.heldTorch)!;
  p.heldTorch = -1;
  // 던진 횃불 상한: 가장 오래된 것부터 꺼진다
  const thrown = sim.torches.filter((x) => x.thrown);
  if (thrown.length >= MAX_THROWN) removeTorch(sim, thrown[0]!);

  // 막대 모양(상자). 공으로 만들면 Rapier에는 구름 저항이 없어 바닥에서 끝없이 굴렀다 (테스트로 확인).
  const body = sim.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(t.x, t.y, t.z).setLinearDamping(0.2).setAngularDamping(1.5),
  );
  sim.world.createCollider(
    RAPIER.ColliderDesc.cuboid(0.035, 0.25, 0.035).setRestitution(0.1).setFriction(0.9).setDensity(500).setCollisionGroups(groups(G_TORCH, G_LEVEL)),
    body,
  );
  body.setAngvel({ x: -dcos(p.facing) * 6, y: 0, z: dsin(p.facing) * 6 }, true); // 앞으로 공중제비
  body.setLinvel({ x: -dsin(p.facing) * 9 + p.vx * 0.5, y: 4, z: -dcos(p.facing) * 9 + p.vz * 0.5 }, true);
  t.body = body;
  t.state = 'flying';
  t.thrown = true;
  t.burn = THROWN_BURN_TICKS;
}

/** 매 틱: 든 횃불은 손을 따라가고, 날아가는 횃불은 멈추면 바닥 횃불이 되고, 던진 횃불은 탄다 */
export function updateTorches(sim: Sim) {
  const p = sim.player;
  const tr = p.body.translation();
  for (let i = sim.torches.length - 1; i >= 0; i--) {
    const t = sim.torches[i]!;
    if (t.state === 'held') {
      [t.x, t.y, t.z] = heldTorchPos(tr.x, tr.y, tr.z, p.facing);
    } else if (t.body) {
      const b = t.body.translation();
      t.x = b.x;
      t.y = b.y;
      t.z = b.z;
      if (t.state === 'flying') {
        const v = t.body.linvel();
        const w = t.body.angvel();
        if (v.x * v.x + v.y * v.y + v.z * v.z < 0.04 && w.x * w.x + w.y * w.y + w.z * w.z < 0.25) {
          t.state = 'ground';
          emitNoise(sim, t.x, t.y, t.z, 0.4, 6);
        }
      }
    }
    if (t.burn > 0 && --t.burn === 0) removeTorch(sim, t);
  }
}
