import RAPIER from '@dimforge/rapier3d-compat';
import { DEFAULT_QUERY_FILTER, queryPolygons, type NodeRef, type QueryFilter } from 'navcat';
import { damageEnemy } from './enemy';
import { XP, addXp } from './growth';
import { blockCells } from './horde';
import type { Level } from './level';
import { hitPlayer } from './player';
import { G_LEVEL, groups, type Sim } from './types';

/**
 * 무너지는 모리아 (계획서 6장 E — TRIZ 22 전화위복). 금 간 기둥을 무너뜨려 물결을 깔아뭉개고 굴 입구를 막는다.
 *   서 있음 (고정 원기둥) → 공격 피해 누적(또는 트롤 내려찍기) → 쓰러짐: 미리 나눈 조각 6개가 동적 강체로 넘어진다
 *   → 50틱 뒤 땅에 닿음: 쓰러지는 띠 안의 무리·고블린은 깔리고, 플레이어도 맞는다(피하면 안 맞음)
 *   → 5초 뒤 조각을 고정: 흐름장 칸과 내비메시 폴리곤을 막는다 (잔해가 통로를 막는다)
 * 넘어지는 방향은 레벨 데이터가 정한다 — 붕괴 지점은 우회로가 있는 곳(굴 입구)에만 둔다 (주 동선은 막지 않는다: 테스트).
 * 결정성: 조각 생성 순서 고정, Rapier는 결정적, 판정은 정수 틱.
 */
const CHUNKS = 6;
const IMPACT_TICKS = 50;
const SETTLE_TICKS = 300;
/** 쓰러지는 띠의 반폭 (m) */
const CRUSH_HALF = 1.3;
const CRUSH_PLAYER = 50;

export type CollapseState = 'standing' | 'falling' | 'down';
export type Collapse = {
  readonly x: number; readonly y: number; readonly z: number;
  readonly radius: number; readonly height: number;
  /** 넘어지는 방향 (단위 벡터 x, z) */
  readonly dx: number; readonly dz: number;
  /** 굳은 뒤 봉쇄하는 영역 (내비메시 폴리곤·흐름장 칸) — 레벨이 정한다 */
  readonly seals: readonly [number, number, number, number, number, number] | null;
  hp: number;
  state: CollapseState;
  /** 쓰러지기 시작한 틱 */
  tick: number;
  body: RAPIER.RigidBody | null;
  chunks: RAPIER.RigidBody[];
};

export type NavBlock = { excluded: Set<NodeRef>; filter: QueryFilter };

/** 내비메시 필터: 잔해가 덮은 폴리곤은 지나가지 못한다 (경로·스폰 거리 모두 이 필터를 쓴다) */
export function createNavBlock(): NavBlock {
  const excluded = new Set<NodeRef>();
  return {
    excluded,
    filter: {
      passFilter: (ref, nav) => !excluded.has(ref) && DEFAULT_QUERY_FILTER.passFilter(ref, nav),
      getCost: (...a) => DEFAULT_QUERY_FILTER.getCost(...a),
    },
  };
}

export function createCollapses(sim: Sim, level: Level): Collapse[] {
  return (level.collapses ?? []).map((c) => {
    const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(c.pos[0], c.pos[1] + c.height / 2, c.pos[2]));
    sim.world.createCollider(RAPIER.ColliderDesc.cylinder(c.height / 2, c.radius).setCollisionGroups(groups(G_LEVEL, 0xffff)), body);
    const l = Math.sqrt(c.dir[0] * c.dir[0] + c.dir[1] * c.dir[1]);
    return {
      x: c.pos[0], y: c.pos[1], z: c.pos[2], radius: c.radius, height: c.height,
      dx: c.dir[0] / l, dz: c.dir[1] / l, seals: c.seals ?? null, hp: c.hp, state: 'standing', tick: 0, body, chunks: [],
    };
  });
}

/** 피해를 준다. 0이 되면 쓰러지기 시작 */
export function damageCollapse(sim: Sim, i: number, dmg: number) {
  const c = sim.collapses[i]!;
  if (c.state !== 'standing') return;
  c.hp -= dmg;
  sim.events.push({ type: 'crack', tick: sim.tick, index: i, hp: Math.max(0, c.hp) });
  if (c.hp <= 0) topple(sim, i);
}

function topple(sim: Sim, i: number) {
  const c = sim.collapses[i]!;
  c.state = 'falling';
  c.tick = sim.tick;
  if (c.body) sim.world.removeRigidBody(c.body);
  c.body = null;
  // 원기둥을 6토막으로: 아래에서 위로. 윗토막일수록 넘어지는 방향으로 빠르게 (넘어지는 막대의 각속도 ω로 v = ω·h)
  const seg = c.height / CHUNKS;
  const w = 1.6; // rad/s
  // 넘어지는 축 = 위(0,1,0) × 방향(dx,0,dz) = (dz, 0, −dx)
  for (let k = 0; k < CHUNKS; k++) {
    const h = seg * (k + 0.5);
    const b = sim.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(c.x, c.y + h, c.z)
        .setLinvel(c.dx * w * h, 0, c.dz * w * h)
        .setAngvel({ x: c.dz * w, y: 0, z: -c.dx * w })
        .setLinearDamping(0.1)
        .setAngularDamping(0.6),
    );
    // 조각끼리 살짝 겹치지 않게 (Rapier가 밀어내며 튀는 것을 막는다)
    sim.world.createCollider(
      RAPIER.ColliderDesc.cylinder(seg / 2 - 0.02, c.radius).setDensity(2400).setFriction(0.9).setCollisionGroups(groups(G_LEVEL, G_LEVEL)),
      b,
    );
    c.chunks.push(b);
  }
  sim.events.push({ type: 'collapse', tick: sim.tick, index: i, stage: 'fall' });
}

/** 쓰러지는 띠(기둥 밑동 → 방향으로 높이만큼, 반폭 CRUSH_HALF) 안인가 */
function inBand(c: Collapse, x: number, z: number): boolean {
  const px = x - c.x, pz = z - c.z;
  const along = px * c.dx + pz * c.dz;
  const side = px * -c.dz + pz * c.dx;
  return along >= -c.radius && along <= c.height && side >= -CRUSH_HALF && side <= CRUSH_HALF;
}

export function stepCollapses(sim: Sim) {
  for (let i = 0; i < sim.collapses.length; i++) {
    const c = sim.collapses[i]!;
    if (c.state !== 'falling') continue;
    const t = sim.tick - c.tick;
    if (t === IMPACT_TICKS) {
      // 땅에 닿음: 띠 안의 무리·고블린은 깔리고, 플레이어는 맞는다 (회피 무적이면 피한다)
      if (sim.horde) {
        const before = sim.horde.agents.length;
        sim.horde.agents = sim.horde.agents.filter((a) => !inBand(c, a.x, a.z));
        const crushed = before - sim.horde.agents.length;
        sim.player.companion = Math.min(100, sim.player.companion + crushed * sim.player.mods.ally);
        addXp(sim, crushed * XP.horde);
      }
      for (const e of sim.enemies) {
        if (e.ai === 'dead') continue;
        const t2 = e.body.translation();
        if (inBand(c, t2.x, t2.z)) damageEnemy(sim, e, e.kind === 'troll' ? 60 : 999);
      }
      const p = sim.player.body.translation();
      if (inBand(c, p.x, p.z)) {
        // 넉백은 넘어지는 방향으로 직접 준다 (hitPlayer의 넉백은 0)
        const r = hitPlayer(sim, CRUSH_PLAYER, c.x, c.z, 0, { unparryable: true, knockback: 0, source: 'collapse' });
        if (r === 'hit') {
          sim.player.vx = c.dx * 5;
          sim.player.vz = c.dz * 5;
        }
      }
      sim.events.push({ type: 'collapse', tick: sim.tick, index: i, stage: 'impact' });
    }
    if (t >= SETTLE_TICKS) {
      // 굳힘: 조각을 고정한다. 봉쇄 영역(굴 안쪽)의 폴리곤은 경로에서 빼고, 흐름장은 봉쇄 영역 + 잔해 발자국 칸을 막는다.
      // (잔해 둘레 상자로 폴리곤을 빼면 기둥 홀의 큰 폴리곤까지 빠져 주 동선이 끊길 수 있다 → 봉쇄 영역은 레벨이 명시)
      c.state = 'down';
      for (const b of c.chunks) {
        b.setBodyType(RAPIER.RigidBodyType.Fixed, true);
        const p = b.translation();
        const r = c.radius * 0.8;
        blockCells(sim, p.x - r, p.z - r, p.x + r, p.z + r);
      }
      if (c.seals) {
        for (const ref of queryPolygons(sim.nav, [...c.seals], DEFAULT_QUERY_FILTER)) sim.navBlock.excluded.add(ref);
        blockCells(sim, c.seals[0], c.seals[2], c.seals[3], c.seals[5]);
      }
      sim.events.push({ type: 'collapse', tick: sim.tick, index: i, stage: 'settled' });
    }
  }
}
