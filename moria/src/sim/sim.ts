import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { createRng, fnv1a, streamSeed } from '../core/rng';
import { CLASS_STATS, type ClassId } from './classes';
import { INPUT_BUFFER_TICKS, RIPOSTE_MULT, STAMINA_MAX, inArc, isActive } from './combat';
import { createDirector, stepDirector } from './director';
import { createEnemy, damageEnemy, enemyRadius, stepEnemies } from './enemy';
import type { Level } from './level';
import { makeController } from './move';
import { buildNavMesh } from './nav';
import { allLights, emitNoise, lightAt, pruneNoise } from './perception';
import { stepPlayer } from './player';
import { nearestInteractable, stepExits, stepInteract } from './interact';
import { BASE_MODS, XP, addXp, applyCommand } from './growth';
import { bossAwake } from './troll';
import { stepArrows } from './archer';
import { DARK_EMA, stepLoot } from './gear';
import { createHorde, stepHorde } from './horde';
import { createCollapses, createNavBlock, damageCollapse, stepCollapses } from './collapse';
import { callCompanion } from './companion';
import { giveStartingTorch, updateTorches } from './torch';
import { BTN_CALL, BTN_DODGE, BTN_LIGHT, G_CHAR, G_LEVEL, groups, type InputFrame, type Sim, type SimLight, type V3 } from './types';

export * from './types';

/**
 * 결정적 시뮬레이션. 이 모듈은 three.js도 DOM도 모른다 → Node에서 렌더러 없이 돌릴 수 있다.
 * 규칙: 입력은 InputFrame(정수)만, 시간은 DT만, 난수는 sim.rng만, 삼각함수는 core/trig만.
 * 한 틱 순서: (히트스톱이면 입력만 받고 멈춤) → 플레이어 → 플레이어 공격 판정 → 적(id 순) → 횃불 → 물리 스텝
 */

export const NO_INPUT: InputFrame = { buttons: 0, moveX: 0, moveY: 0, yaw: 0 };
const PLAYER_HP = 100;
const MAX_EVENTS = 256;

/** RAPIER.init()이 끝난 뒤에만 호출한다. */
export function createSim(level: Level, seed: number, classId: ClassId = 'human'): Sim {
  const stats = CLASS_STATS[classId];
  const world = new RAPIER.World({ x: 0, y: -20, z: 0 });
  world.timestep = DT;

  // 레벨 바디: 배열 순서대로 생성 (결정성 규칙 4). 부서지는 기둥은 바디를 기억해 둔다
  const breakable = new Set(level.breakable ?? []);
  const pillars: Sim['pillars'] = [];
  for (const [i, s] of level.solids.entries()) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(s.pos[0], s.pos[1], s.pos[2]);
    if (s.kind === 'box' && s.rot) desc.setRotation({ x: s.rot[0], y: s.rot[1], z: s.rot[2], w: s.rot[3] });
    const body = world.createRigidBody(desc);
    const col =
      s.kind === 'box'
        ? RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2])
        : RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
    world.createCollider(col.setCollisionGroups(groups(G_LEVEL, 0xffff)), body);
    if (breakable.has(i) && s.kind === 'cylinder') pillars.push({ solid: i, x: s.pos[0], z: s.pos[2], r: s.radius, body });
  }

  // 문: 레벨 바디 다음 순서
  const doors = (level.doors ?? []).map((d) => {
    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(d.pos[0], d.pos[1], d.pos[2]));
    world.createCollider(RAPIER.ColliderDesc.cuboid(d.half[0], d.half[1], d.half[2]).setCollisionGroups(groups(G_LEVEL, 0xffff)), body);
    return { pos: [...d.pos] as V3, half: [...d.half] as V3, body, open: false };
  });

  const [sx, sy, sz] = level.spawn;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sx, sy, sz));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(stats.capsuleHalf, stats.capsuleRadius).setCollisionGroups(groups(G_CHAR, 0xffff)),
    body,
  );

  const nav = buildNavMesh(level);
  const sim: Sim = {
    level,
    tick: 0,
    world,
    rng: createRng(streamSeed(seed, 'sim')),
    player: {
      body, collider, controller: makeController(world), stats,
      vx: 0, vz: 0, vy: 0, facing: 0, grounded: false, airTicks: 0,
      crouching: false, landedTick: -1, landedAirTicks: 0,
      hp: PLAYER_HP, maxHp: PLAYER_HP, stamina: STAMINA_MAX, staminaRegenAt: 0, exhausted: false,
      action: 'free', actionTick: 0, attack: null, combo: 0, comboQueued: false,
      heavyCharge: 0, charging: false, hitSet: new Set(), buffer: null, prevButtons: 0,
      lockTarget: -1, riposteUntil: -1, dodgeDirX: 0, dodgeDirZ: 0,
      heldTorch: -1, spareTorches: 2, senseReadyAt: 0, companion: 0,
      level: 1, xp: 0, points: 0, skills: [], mods: { ...BASE_MODS },
      inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0, darkness: 0,
    },
    enemies: [],
    enemyController: makeController(world),
    nav,
    staticLights: level.torches.map(([x, y, z]) => ({ x, y, z, intensity: 0.9, range: 7 })),
    torches: [],
    nextTorchId: 0,
    noise: [],
    hitstop: 0,
    tokens: 0,
    events: [],
    director: createDirector(),
    spawnPoints: (level.spawnPoints ?? []).map((p) => [p[0], p[1], p[2]] as [number, number, number]),
    nextEnemyId: (level.enemies?.length ?? 0) + (level.bosses?.length ?? 0),
    doors,
    braziers: (level.braziers ?? []).map(([x, y, z]) => ({ x, y, z, lit: false })),
    checkpoint: -1,
    pillars,
    bosses: [],
    horde: createHorde(level, nav),
    collapses: [],
    arrows: [],
    nextArrowId: 0,
    loot: [],
    nextLootId: 0,
    nextItemId: 0,
    lamps: (level.lamps ?? []).map(([x, y, z]) => ({ x, y, z, lit: false })),
    exited: false,
    exitLockedShown: false,
    navBlock: createNavBlock(),
    classId,
  };
  // 붕괴 기둥: 레벨·문 바디 다음, 플레이어보다 뒤 — 생성 순서 고정 (결정성 규칙 4)
  sim.collapses.push(...createCollapses(sim, level));
  (level.enemies ?? []).forEach((e, i) => sim.enemies.push(createEnemy(sim, i, [...e.pos], e.patrol.map((p) => [...p] as [number, number, number]), e.kind ?? 'goblin')));
  (level.bosses ?? []).forEach((b, i) => {
    const id = (level.enemies?.length ?? 0) + i;
    sim.enemies.push(createEnemy(sim, id, [...b.pos], [[...b.pos]], b.kind));
    sim.bosses.push(id);
  });
  giveStartingTorch(sim);
  return sim;
}

/**
 * 빛의 도박 (계획서 A): 어둠 속에서 친 공격일수록 세다. 배율 = 1 + 0.5 × (1 − 플레이어 가슴 높이의 밝기).
 * 횃불을 들면 거의 1.0배, 빛 없는 곳에서는 1.5배. 대신 어둠에서는 적이 보이지 않는다.
 */
export const DARK_BONUS = 0.5;
export function darkMultiplier(sim: Sim, lights: readonly SimLight[]): number {
  const t = sim.player.body.translation();
  return 1 + (DARK_BONUS + sim.player.mods.dark) * (1 - lightAt(t.x, t.y + 0.3, t.z, lights));
}

/** 플레이어 공격의 판정 구간: 부채꼴 안의 적에게 한 번씩 피해 */
function resolvePlayerAttack(sim: Sim, lights: readonly SimLight[]) {
  const p = sim.player;
  const a = p.attack;
  if (p.action !== 'attack' || !a || p.charging || !isActive(a, p.actionTick)) return;
  const me = p.body.translation();
  for (const e of sim.enemies) {
    if (e.ai === 'dead' || p.hitSet.has(e.id)) continue;
    const t = e.body.translation();
    const radius = e.kind === 'goblin' || e.kind === 'archer' ? 0.3 : enemyRadius(e.kind);
    if (!inArc(me.x, me.y, me.z, p.facing, t.x, t.y, t.z, radius, a.reach, a.halfArc)) continue;
    p.hitSet.add(e.id);
    const riposte = sim.tick < p.riposteUntil;
    const dark = darkMultiplier(sim, lights);
    const m = p.mods;
    const dmg = Math.round(a.damage * m.dmg * (a.id === 'heavy' ? m.heavy : 1) * (riposte ? RIPOSTE_MULT + m.riposte : 1) * dark);
    if (riposte) p.riposteUntil = -1;
    damageEnemy(sim, e, dmg);
    sim.hitstop = Math.max(sim.hitstop, riposte ? a.hitstop + 4 : a.hitstop);
    emitNoise(sim, t.x, t.y, t.z, 0.8, 10, 20);
    sim.events.push({ type: 'hit', tick: sim.tick, target: e.id, x: t.x, y: t.y + 0.4, z: t.z, heavy: a.id === 'heavy' || riposte, dark });
  }
  // 금 간 기둥: 칼에 닿으면 금이 간다 (판정 구간마다 한 번 — hitSet에 음수 번호로 기록)
  for (let i = 0; i < sim.collapses.length; i++) {
    const c = sim.collapses[i]!;
    const key = -100 - i;
    if (c.state !== 'standing' || p.hitSet.has(key)) continue;
    if (!inArc(me.x, me.y, me.z, p.facing, c.x, me.y, c.z, c.radius, a.reach, a.halfArc)) continue;
    p.hitSet.add(key);
    damageCollapse(sim, i, a.damage);
    sim.hitstop = Math.max(sim.hitstop, a.hitstop);
  }
  // 무리(물리 없는 점)도 칼에 닿으면 쓰러진다 — 한 번에 하나씩, 판정 구간마다 최대 3마리
  const h = sim.horde;
  if (h && h.agents.length) {
    let cut = 0;
    h.agents = h.agents.filter((g) => {
      if (cut >= 3 || !inArc(me.x, me.y, me.z, p.facing, g.x, g.y + 0.8, g.z, 0.3, a.reach, a.halfArc)) return true;
      cut++;
      sim.events.push({ type: 'hit', tick: sim.tick, target: -1, x: g.x, y: g.y + 1, z: g.z, heavy: a.id === 'heavy', dark: 1 });
      return false;
    });
    if (cut) {
      sim.hitstop = Math.max(sim.hitstop, a.hitstop);
      p.companion = Math.min(100, p.companion + cut * p.mods.ally);
      addXp(sim, cut * XP.horde);
    }
  }
}

export function stepSim(sim: Sim, input: InputFrame): void {
  if (sim.events.length > MAX_EVENTS) sim.events.splice(0, sim.events.length - MAX_EVENTS);
  // UI 명령 (스킬 배우기·초기화) — 히트스톱이어도 받는다
  if (input.cmd) {
    const near = nearestInteractable(sim);
    applyCommand(sim, input.cmd, near?.kind === 'brazier' && near.lit);
  }
  if (sim.hitstop > 0) {
    // 히트스톱: 세상은 멈추지만 입력은 흘려보내지 않는다 (누른 순간을 버퍼에 담는다)
    sim.hitstop--;
    latchDuringHitstop(sim, input);
    sim.tick++;
    return;
  }
  const lights = allLights(sim);
  sim.director.cameraYaw = input.yaw;
  // 어둠 비율 (전리품 등급 — 빛의 도박): 가슴 높이 밝기 0.2 미만이면 어둠
  {
    const t = sim.player.body.translation();
    sim.player.darkness = sim.player.darkness * DARK_EMA + (lightAt(t.x, t.y + 0.3, t.z, lights) < 0.2 ? 1 - DARK_EMA : 0);
  }
  const pressed = input.buttons & ~sim.player.prevButtons; // stepPlayer가 prevButtons를 갱신하기 전에
  stepPlayer(sim, input);
  stepInteract(sim, pressed);
  stepExits(sim);
  if ((pressed & BTN_CALL) !== 0) callCompanion(sim, sim.classId);
  resolvePlayerAttack(sim, lights);
  stepEnemies(sim, lights);
  stepHorde(sim, lights);
  stepArrows(sim);
  stepLoot(sim);
  stepCollapses(sim);
  // 문이 닫힌 동안(서문 밖)은 디렉터가 쉰다 — 내비메시는 문을 열린 상태로 보므로 물결이 문에 막혀 버린다
  // 보스전 중에도 쉰다 (L4D의 보스 이벤트처럼 물결과 겹치지 않게)
  if (sim.doors.every((d) => d.open) && !bossAwake(sim)) stepDirector(sim, lights);
  updateTorches(sim);
  pruneNoise(sim);
  sim.world.step();
  sim.tick++;
}

function latchDuringHitstop(sim: Sim, input: InputFrame) {
  const p = sim.player;
  const pressed = input.buttons & ~p.prevButtons;
  p.prevButtons = input.buttons;
  // 콤보 입력은 히트스톱 중에 들어오는 경우가 많다 → 예약으로 받는다
  if ((pressed & BTN_LIGHT) !== 0 && p.action === 'attack' && p.attack?.id.startsWith('light')) p.comboQueued = true;
  else if ((pressed & BTN_DODGE) !== 0) p.buffer = { kind: 'dodge', ticks: INPUT_BUFFER_TICKS };
  // 동료 호출은 맞는 순간(히트스톱)에 가장 많이 눌린다 → 버리지 않고 바로 부른다
  if ((pressed & BTN_CALL) !== 0) callCompanion(sim, sim.classId);
}

const scratch = new DataView(new ArrayBuffer(8));
const bytes = new Uint8Array(scratch.buffer);

function mix(h: number, ...vals: number[]): number {
  for (const v of vals) {
    scratch.setFloat64(0, v);
    h = fnv1a(bytes, h);
  }
  return h;
}

/** 전체 물리 상태(스냅샷) + 시뮬레이션 전용 상태의 해시. 두 실행이 같은지 비교할 때 쓴다. */
export function hashSim(sim: Sim): number {
  const p = sim.player;
  let h = fnv1a(sim.world.takeSnapshot());
  h = mix(h, sim.tick, sim.hitstop, sim.tokens, sim.noise.length, sim.torches.length);
  h = mix(h, p.vx, p.vy, p.vz, p.facing, p.grounded ? 1 : 0, p.crouching ? 1 : 0, p.airTicks, p.landedTick);
  h = mix(h, p.hp, p.stamina, ['free', 'attack', 'dodge', 'parry', 'stagger', 'dead'].indexOf(p.action), p.actionTick, p.combo, p.heavyCharge, p.lockTarget, p.heldTorch, p.spareTorches, p.senseReadyAt);
  for (const e of sim.enemies) {
    h = mix(h, e.id, e.hp, e.awareness, e.facing, e.vx, e.vz, e.aiTick, e.swingTick, e.hasToken ? 1 : 0, e.cooldownUntil);
    if (e.kind === 'troll') h = mix(h, ['', 'slam', 'sweep'].indexOf(e.move), e.aimX, e.aimZ);
    else if (e.kind !== 'goblin') h = mix(h, ['', 'slam', 'sweep', 'shoot', 'combo', 'charge'].indexOf(e.move), e.aimX, e.aimZ, e.step, e.used);
  }
  for (const p of sim.pillars) h = mix(h, p.body ? 1 : 0);
  h = mix(h, p.companion, p.level, p.xp, p.points, p.maxHp, ...p.skills);
  if (p.inventory.length || p.gold || p.mithril || sim.loot.length || sim.nextItemId || p.equipped.some(Boolean)) {
    h = mix(h, p.gold, p.mithril, p.darkness, sim.loot.length, sim.nextLootId, sim.nextItemId, ...p.inventory.map((i) => i.id), ...p.equipped.map((i) => (i ? i.id * 8 + i.upgrade : -1)));
    for (const l of sim.loot) h = mix(h, l.id, l.x, l.z, l.ttl);
  }
  if (sim.arrows.length || sim.nextArrowId) {
    h = mix(h, sim.arrows.length, sim.nextArrowId);
    for (const a of sim.arrows) h = mix(h, a.id, a.x, a.y, a.z, a.ttl);
  }
  if (sim.lamps.length) h = mix(h, ...sim.lamps.map((l) => (l.lit ? 1 : 0)), sim.exited ? 1 : 0);
  for (const c of sim.collapses) {
    h = mix(h, c.hp, ['standing', 'falling', 'down'].indexOf(c.state), c.tick);
    for (const b of c.chunks) {
      const t = b.translation();
      h = mix(h, t.x, t.y, t.z);
    }
  }
  if (sim.horde && (sim.horde.agents.length || sim.horde.nextId)) {
    h = mix(h, sim.horde.agents.length, sim.horde.nextId);
    for (const a of sim.horde.agents) h = mix(h, a.id, a.x, a.y, a.z, a.vx, a.vz, a.facing);
  }
  for (const t of sim.torches) h = mix(h, t.id, t.x, t.y, t.z, t.burn);
  const d = sim.director;
  // 문·화로가 없는 레벨(시험 방)은 해시에 섞지 않는다 → 기존 골든 해시 유지
  if (sim.doors.length + sim.braziers.length > 0) h = mix(h, sim.checkpoint, ...sim.doors.map((x) => (x.open ? 1 : 0)), ...sim.braziers.map((x) => (x.lit ? 1 : 0)));
  h = mix(h, ['relax', 'buildup', 'warn', 'peak', 'fade'].indexOf(d.phase), d.phaseTick, d.phaseLen, d.intensity, d.bpm, sim.nextEnemyId, sim.enemies.length);
  return h;
}

export function disposeSim(sim: Sim): void {
  sim.world.removeCharacterController(sim.player.controller);
  sim.world.removeCharacterController(sim.enemyController);
  sim.world.free();
}
