import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { createRng, fnv1a, streamSeed } from '../core/rng';
import { CLASS_STATS, type ClassId } from './classes';
import { INPUT_BUFFER_TICKS, RIPOSTE_MULT, STAMINA_MAX, inArc, isActive } from './combat';
import { createDirector, stepDirector } from './director';
import { createEnemy, damageEnemy, stepEnemies } from './enemy';
import type { Level } from './level';
import { makeController } from './move';
import { buildNavMesh } from './nav';
import { allLights, emitNoise, lightAt, pruneNoise } from './perception';
import { stepPlayer } from './player';
import { giveStartingTorch, updateTorches } from './torch';
import { BTN_DODGE, BTN_LIGHT, G_CHAR, G_LEVEL, groups, type InputFrame, type Sim, type SimLight } from './types';

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

  // 레벨 바디: 배열 순서대로 생성 (결정성 규칙 4)
  for (const s of level.solids) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(s.pos[0], s.pos[1], s.pos[2]);
    if (s.kind === 'box' && s.rot) desc.setRotation({ x: s.rot[0], y: s.rot[1], z: s.rot[2], w: s.rot[3] });
    const body = world.createRigidBody(desc);
    const col =
      s.kind === 'box'
        ? RAPIER.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2])
        : RAPIER.ColliderDesc.cylinder(s.halfHeight, s.radius);
    world.createCollider(col.setCollisionGroups(groups(G_LEVEL, 0xffff)), body);
  }

  const [sx, sy, sz] = level.spawn;
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(sx, sy, sz));
  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(stats.capsuleHalf, stats.capsuleRadius).setCollisionGroups(groups(G_CHAR, 0xffff)),
    body,
  );

  const sim: Sim = {
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
      heldTorch: -1, spareTorches: 2, senseReadyAt: 0,
    },
    enemies: [],
    enemyController: makeController(world),
    nav: buildNavMesh(level),
    staticLights: level.torches.map(([x, y, z]) => ({ x, y, z, intensity: 0.9, range: 7 })),
    torches: [],
    nextTorchId: 0,
    noise: [],
    hitstop: 0,
    tokens: 0,
    events: [],
    director: createDirector(),
    spawnPoints: (level.spawnPoints ?? []).map((p) => [p[0], p[1], p[2]] as [number, number, number]),
    nextEnemyId: level.enemies?.length ?? 0,
  };
  (level.enemies ?? []).forEach((e, i) => sim.enemies.push(createEnemy(sim, i, [...e.pos], e.patrol.map((p) => [...p] as [number, number, number]))));
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
  return 1 + DARK_BONUS * (1 - lightAt(t.x, t.y + 0.3, t.z, lights));
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
    if (!inArc(me.x, me.y, me.z, p.facing, t.x, t.y, t.z, 0.3, a.reach, a.halfArc)) continue;
    p.hitSet.add(e.id);
    const riposte = sim.tick < p.riposteUntil;
    const dark = darkMultiplier(sim, lights);
    const dmg = Math.round(a.damage * (riposte ? RIPOSTE_MULT : 1) * dark);
    if (riposte) p.riposteUntil = -1;
    damageEnemy(sim, e, dmg);
    sim.hitstop = Math.max(sim.hitstop, riposte ? a.hitstop + 4 : a.hitstop);
    emitNoise(sim, t.x, t.y, t.z, 0.8, 10, 20);
    sim.events.push({ type: 'hit', tick: sim.tick, target: e.id, x: t.x, y: t.y + 0.4, z: t.z, heavy: a.id === 'heavy' || riposte, dark });
  }
}

export function stepSim(sim: Sim, input: InputFrame): void {
  if (sim.events.length > MAX_EVENTS) sim.events.splice(0, sim.events.length - MAX_EVENTS);
  if (sim.hitstop > 0) {
    // 히트스톱: 세상은 멈추지만 입력은 흘려보내지 않는다 (누른 순간을 버퍼에 담는다)
    sim.hitstop--;
    latchDuringHitstop(sim, input);
    sim.tick++;
    return;
  }
  const lights = allLights(sim);
  sim.director.cameraYaw = input.yaw;
  stepPlayer(sim, input);
  resolvePlayerAttack(sim, lights);
  stepEnemies(sim, lights);
  stepDirector(sim, lights);
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
  for (const e of sim.enemies) h = mix(h, e.id, e.hp, e.awareness, e.facing, e.vx, e.vz, e.aiTick, e.swingTick, e.hasToken ? 1 : 0, e.cooldownUntil);
  for (const t of sim.torches) h = mix(h, t.id, t.x, t.y, t.z, t.burn);
  const d = sim.director;
  h = mix(h, ['relax', 'buildup', 'warn', 'peak', 'fade'].indexOf(d.phase), d.phaseTick, d.phaseLen, d.intensity, d.bpm, sim.nextEnemyId, sim.enemies.length);
  return h;
}

export function disposeSim(sim: Sim): void {
  sim.world.removeCharacterController(sim.player.controller);
  sim.world.removeCharacterController(sim.enemyController);
  sim.world.free();
}
