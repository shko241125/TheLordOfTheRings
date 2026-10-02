import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import type { ClassId } from './classes';
import type { Level } from './level';
import { makeController } from './move';
import { createSim } from './sim';
import type { Enemy, Sim } from './types';

/**
 * 시뮬레이션 전체 상태의 스냅샷 (리플레이 체크포인트 — 계획서 M4 3번 "2분 경량 체크포인트").
 *   world: Rapier 월드 스냅샷 (바디·충돌체·속도·접촉까지 — Rapier가 보장하는 결정적 복원)
 *   state: JS 쪽 상태 JSON. 바디는 핸들 번호로 적고 복원할 때 새 월드에서 다시 찾는다.
 * JSON은 −0을 0으로, NaN을 null로 바꾼다 → 표시를 붙여 보존한다 (−0과 0은 해시 바이트가 다르다).
 * 내비메시·흐름장 격자 모양·정적 광원처럼 레벨에서 다시 만들 수 있는 것은 담지 않는다 (흐름장의 높이·거리 값은 담는다: 붕괴가 바꾼다).
 * 복원 정확성은 tests/snapshot.test.ts가 "스냅샷에서 이어 돌린 해시 = 원래 실행의 해시"로 검사한다.
 */
export type SimSnapshot = { world: Uint8Array; state: string };

const replacer = (_k: string, v: unknown) =>
  typeof v === 'number' ? (Number.isNaN(v) ? '§NaN' : Object.is(v, -0) ? '§-0' : v === Infinity ? '§Inf' : v === -Infinity ? '§-Inf' : v) : v;
const reviver = (_k: string, v: unknown) =>
  v === '§NaN' ? NaN : v === '§-0' ? -0 : v === '§Inf' ? Infinity : v === '§-Inf' ? -Infinity : v;
const handle = (b: RAPIER.RigidBody | null) => (b ? b.handle : -1);

export function takeSnapshot(sim: Sim): SimSnapshot {
  const p = sim.player;
  // controller·stats는 복원 쪽이 새로 만든다 (나머지 요소 구조 분해로 빼낸다)
  const { body, collider, controller: _c, stats: _s, hitSet, ...player } = p;
  const state = {
    tick: sim.tick,
    rng: sim.rng.state(),
    nextTorchId: sim.nextTorchId,
    noise: sim.noise,
    hitstop: sim.hitstop,
    tokens: sim.tokens,
    director: sim.director,
    nextEnemyId: sim.nextEnemyId,
    checkpoint: sim.checkpoint,
    player: { ...player, hitSet: [...hitSet], body: body.handle, collider: collider.handle },
    enemies: sim.enemies.map((e) => {
      const { body: b, collider: c, hitSet: hs, ...rest } = e;
      return { ...rest, hitSet: [...hs], body: b.handle, collider: c.handle };
    }),
    torches: sim.torches.map((t) => ({ ...t, body: handle(t.body) })),
    doors: sim.doors.map((d) => ({ open: d.open, body: handle(d.body) })),
    braziers: sim.braziers.map((b) => b.lit),
    pillars: sim.pillars.map((x) => handle(x.body)),
    bosses: [...sim.bosses],
    horde: sim.horde && {
      agents: sim.horde.agents,
      nextId: sim.horde.nextId,
      height: [...sim.horde.field.height],
      dist: [...sim.horde.field.dist],
    },
    collapses: sim.collapses.map((c) => ({ hp: c.hp, state: c.state, tick: c.tick, body: handle(c.body), chunks: c.chunks.map((b) => b.handle) })),
    navBlock: [...sim.navBlock.excluded],
    arrows: sim.arrows,
    nextArrowId: sim.nextArrowId,
    loot: sim.loot,
    nextLootId: sim.nextLootId,
    nextItemId: sim.nextItemId,
    defense: sim.defense,
    forge: sim.forge,
    pages: sim.pages.map((x) => x.taken),
  };
  return { world: sim.world.takeSnapshot(), state: JSON.stringify(state, replacer) };
}

type State = ReturnType<typeof parse>;
const parse = (s: string) => JSON.parse(s, reviver) as {
  tick: number; rng: number; nextTorchId: number; noise: Sim['noise']; hitstop: number; tokens: number;
  director: Sim['director']; nextEnemyId: number; checkpoint: number;
  player: Record<string, unknown> & { hitSet: number[]; body: number; collider: number };
  enemies: (Record<string, unknown> & { hitSet: number[]; body: number; collider: number })[];
  torches: (Record<string, unknown> & { body: number })[];
  doors: { open: boolean; body: number }[];
  braziers: boolean[];
  pillars: number[];
  bosses: number[];
  horde: { agents: NonNullable<Sim['horde']>['agents']; nextId: number; height: number[]; dist: number[] } | null;
  collapses: { hp: number; state: 'standing' | 'falling' | 'down'; tick: number; body: number; chunks: number[] }[];
  navBlock: number[];
  arrows: Sim['arrows'];
  nextArrowId: number;
  loot: Sim['loot'];
  nextLootId: number;
  nextItemId: number;
  defense?: Sim['defense'];
  forge?: Sim['forge'];
  pages?: boolean[];
};

/**
 * 스냅샷에서 시뮬레이션을 되살린다. 같은 레벨·시드·종족으로 새 시뮬레이션을 만들어(내비메시·격자) 뼈대로 쓰고,
 * 월드를 스냅샷 월드로 바꾼 뒤 JS 상태를 덮는다. RAPIER.init() 뒤에만.
 */
export function restoreSim(level: Level, seed: number, classId: ClassId, snap: SimSnapshot): Sim {
  const sim = createSim(level, seed, classId);
  const st: State = parse(snap.state);
  sim.world.free();
  const world = RAPIER.World.restoreSnapshot(snap.world);
  world.timestep = DT;
  const body = (h: number) => (h < 0 ? null : world.getRigidBody(h));
  const mut = sim as unknown as Record<string, unknown>;
  mut.world = world;
  mut.enemyController = makeController(world);
  sim.tick = st.tick;
  sim.rng.setState(st.rng);
  sim.nextTorchId = st.nextTorchId;
  sim.noise = st.noise;
  sim.hitstop = st.hitstop;
  sim.tokens = st.tokens;
  sim.director = st.director;
  sim.nextEnemyId = st.nextEnemyId;
  sim.checkpoint = st.checkpoint;
  sim.events = [];

  const { hitSet, body: pb, collider: pc, ...pr } = st.player;
  mut.player = { ...sim.player, ...pr, hitSet: new Set(hitSet), body: world.getRigidBody(pb), collider: world.getCollider(pc), controller: makeController(world) };

  sim.enemies.length = 0;
  for (const e of st.enemies) {
    const { hitSet: hs, body: b, collider: c, ...rest } = e;
    sim.enemies.push({ ...(rest as unknown as Enemy), hitSet: new Set(hs), body: world.getRigidBody(b), collider: world.getCollider(c) });
  }
  sim.torches.length = 0;
  for (const t of st.torches) sim.torches.push({ ...(t as unknown as Sim['torches'][number]), body: body(t.body) });
  st.doors.forEach((d, i) => Object.assign(sim.doors[i]!, { open: d.open, body: body(d.body) }));
  st.braziers.forEach((lit, i) => (sim.braziers[i]!.lit = lit));
  st.pillars.forEach((h, i) => (sim.pillars[i]!.body = body(h)));
  sim.bosses.splice(0, sim.bosses.length, ...st.bosses);
  if (sim.horde && st.horde) {
    sim.horde.agents = st.horde.agents;
    sim.horde.nextId = st.horde.nextId;
    sim.horde.field.height.set(st.horde.height);
    sim.horde.field.dist.set(st.horde.dist);
  }
  st.collapses.forEach((c, i) => {
    Object.assign(sim.collapses[i]!, { hp: c.hp, state: c.state, tick: c.tick, body: body(c.body), chunks: c.chunks.map((h) => world.getRigidBody(h)) });
  });
  sim.arrows = st.arrows ?? [];
  sim.nextArrowId = st.nextArrowId ?? 0;
  sim.loot = st.loot ?? [];
  sim.nextLootId = st.nextLootId ?? 0;
  sim.nextItemId = st.nextItemId ?? 0;
  if (st.defense) sim.defense = st.defense;
  if (st.forge) sim.forge = st.forge;
  st.pages?.forEach((t, i) => (sim.pages[i]!.taken = t));
  sim.navBlock.excluded.clear();
  for (const r of st.navBlock) sim.navBlock.excluded.add(r);
  return sim;
}
