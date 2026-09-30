import RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { angleDiff, dAtan2Angle, dcos, dsin } from '../core/trig';
import { GOBLIN_ATTACK, RIPOSTE_TICKS, attackLength, inArc, isActive } from './combat';
import { moveMover } from './move';
import { pathTo } from './nav';
import { emitNoise, lightAt, noiseAt } from './perception';
import { hitPlayer } from './player';
import { COMPANION_FULL, KILL_CHARGE } from './companion';
import { TROLL_CAPSULE, TROLL_HP, stepTroll, trollDamaged } from './troll';
import { G_CHAR, G_LEVEL, groups, type Enemy, type EnemyKind, type Sim, type SimLight, type V3 } from './types';

/**
 * 고블린 AI (계획서 9장 적 AI + 6장 감지 필드·공격 토큰).
 *   patrol → suspicious → chase → engage(공전) ⇄ attack(토큰 보유) → stagger → dead
 * 감지: 인지도 += 빛(lightAt) × 시야각 × 거리 × 시선(레이) + 소음. 1에 닿으면 경계.
 * 공격 토큰: 동시에 최대 2마리만 공격한다 — 나머지는 공전하며 위협만 한다 (무리가 한 번에 덤비지 않는다).
 */
export const MAX_TOKENS = 2;
export const GOBLIN_HP = 30;
export const GOBLIN_CAPSULE = { half: 0.4, radius: 0.3 }; // 키 1.4m
const PATROL_SPEED = 1.6;
const SUSPICIOUS_SPEED = 1.2;
const CHASE_SPEED = 4.4; // 플레이어 조깅(4.2)보다 약간 빠르고 질주(6.2)보다 느리다 → 질주하면 따돌린다
const ORBIT_SPEED = 2.4;
const APPROACH_SPEED = 3.4;
const ACCEL = 16;
const TURN = 110; // 정수 각도/틱 ≈ 580°/s
const SIGHT = 18;
const ENGAGE_R = 3.4;
const ALERT_SHARE_R = 8;
const HIT_STAGGER = 14;
const PARRIED_STAGGER = 50;
const LOSE_TICKS = 360;

export function createEnemy(sim: Sim, id: number, pos: V3, patrol: readonly V3[], kind: EnemyKind = 'goblin'): Enemy {
  const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos[0], pos[1], pos[2]));
  const cap = kind === 'troll' ? TROLL_CAPSULE : GOBLIN_CAPSULE;
  const collider = sim.world.createCollider(
    RAPIER.ColliderDesc.capsule(cap.half, cap.radius).setCollisionGroups(groups(G_CHAR, 0xffff)),
    body,
  );
  return {
    id, kind, body, collider,
    vx: 0, vz: 0, vy: 0, facing: 0, grounded: false, airTicks: 0,
    hp: kind === 'troll' ? TROLL_HP : GOBLIN_HP, ai: 'patrol', aiTick: 0, awareness: 0,
    patrol, patrolIdx: 0, path: [], pathIdx: 0, repathAt: 0,
    hasToken: false, cooldownUntil: 0, hitSet: new Set(),
    orbitSign: id % 2 === 0 ? 1 : -1,
    lastSeen: [pos[0], pos[1], pos[2]],
    swingTick: -1,
    staggerLen: HIT_STAGGER,
    move: '', aimX: pos[0], aimZ: pos[2], home: [pos[0], pos[1], pos[2]], fromHorde: false,
  };
}

export function setAI(e: Enemy, ai: Enemy['ai']) {
  e.ai = ai;
  e.aiTick = 0;
}

function releaseToken(sim: Sim, e: Enemy) {
  if (e.hasToken) {
    e.hasToken = false;
    sim.tokens--;
  }
  e.swingTick = -1;
}

/** 시선: 적 눈높이 → 플레이어 가슴. 레벨 도형만 막는다. */
export function lineOfSight(sim: Sim, ex: number, ey: number, ez: number, px: number, py: number, pz: number): boolean {
  const dx = px - ex, dy = py - ey, dz = pz - ez;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 0.01) return true;
  const ray = new RAPIER.Ray({ x: ex, y: ey, z: ez }, { x: dx / d, y: dy / d, z: dz / d });
  const hit = sim.world.castRay(ray, d, true, undefined, groups(0xffff, G_LEVEL));
  return !hit || hit.timeOfImpact >= d - 0.05;
}

/** 이번 틱 인지도 증가량 */
export function perceive(sim: Sim, e: Enemy, lights: readonly SimLight[]): number {
  const p = sim.player;
  if (p.action === 'dead') return 0;
  const me = e.body.translation();
  const pt = p.body.translation();
  const dx = pt.x - me.x, dz = pt.z - me.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const chestY = pt.y + 0.3;
  let gain = 0;
  if (d < 2.2) gain += 0.2; // 코앞의 기척
  if (d < SIGHT) {
    let vis = lightAt(pt.x, chestY, pt.z, lights);
    if (p.crouching) vis *= 0.6;
    const off = Math.abs(angleDiff(e.facing, dAtan2Angle(-dx, -dz)));
    const fov = off < 683 ? 1 : off < 1252 ? 0.5 : 0.15; // 60° / 110°
    const distF = Math.min(1, (SIGHT - d) / 14);
    const base = vis * fov * distF;
    if (base > 0.02 && lineOfSight(sim, me.x, me.y + 0.4, me.z, pt.x, chestY, pt.z)) {
      gain += base * 0.06;
      e.lastSeen = [pt.x, pt.y, pt.z];
    }
  }
  const n = noiseAt(me.x, me.y, me.z, sim.noise, sim.tick);
  if (n > 0) {
    gain += n * 0.1;
    // 소리가 난 쪽을 대충 기억한다 (플레이어 위치로 근사)
    if (e.ai === 'patrol' || e.ai === 'suspicious') e.lastSeen = [pt.x, pt.y, pt.z];
  }
  return gain;
}

export function steerTo(e: Enemy, tx: number, tz: number, speed: number, faceMove: boolean) {
  const t = e.body.translation();
  const dx = tx - t.x, dz = tz - t.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const wantX = d > 0.05 ? (dx / d) * speed : 0;
  const wantZ = d > 0.05 ? (dz / d) * speed : 0;
  accelTo(e, wantX, wantZ);
  if (faceMove && d > 0.05) turnTo(e, dAtan2Angle(-dx, -dz), TURN);
}

export function accelTo(e: Enemy, wantX: number, wantZ: number) {
  const dvx = wantX - e.vx, dvz = wantZ - e.vz;
  const dv = Math.sqrt(dvx * dvx + dvz * dvz);
  const max = ACCEL * DT;
  if (dv <= max) {
    e.vx = wantX;
    e.vz = wantZ;
  } else {
    e.vx += (dvx / dv) * max;
    e.vz += (dvz / dv) * max;
  }
}

export function turnTo(e: Enemy, want: number, rate: number) {
  const d = angleDiff(e.facing, want);
  e.facing = (e.facing + (d > rate ? rate : d < -rate ? -rate : d)) & 4095;
}

function facePlayer(sim: Sim, e: Enemy, rate: number) {
  const me = e.body.translation();
  const pt = sim.player.body.translation();
  turnTo(e, dAtan2Angle(-(pt.x - me.x), -(pt.z - me.z)), rate);
}

/** 경로를 따라간다 (주기적으로 다시 찾는다 — 적마다 틱을 엇갈려 한 틱에 몰리지 않게) */
export function followPath(sim: Sim, e: Enemy, goal: V3, speed: number) {
  const me = e.body.translation();
  if (sim.tick >= e.repathAt || e.path.length === 0) {
    e.path = pathTo(sim.nav, [me.x, me.y, me.z], goal, sim.navBlock.filter);
    e.pathIdx = 0;
    e.repathAt = sim.tick + 20 + (e.id % 7);
  }
  while (e.pathIdx < e.path.length) {
    const c = e.path[e.pathIdx]!;
    if ((c[0] - me.x) ** 2 + (c[2] - me.z) ** 2 > 0.36) break;
    e.pathIdx++;
  }
  const c = e.path[e.pathIdx] ?? goal;
  steerTo(e, c[0], c[2], speed, true);
}

/** 겹침 방지: 가까운 다른 고블린에게서 살짝 밀려난다 (navcat crowd 대신 결정적 분리) */
function separate(sim: Sim, e: Enemy) {
  const me = e.body.translation();
  for (const o of sim.enemies) {
    if (o === e || o.ai === 'dead') continue;
    const t = o.body.translation();
    const dx = me.x - t.x, dz = me.z - t.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 0.0001 && d2 < 1.44) {
      const d = Math.sqrt(d2);
      const push = (1.2 - d) * 2.5;
      e.vx += (dx / d) * push;
      e.vz += (dz / d) * push;
    }
  }
}

function alert(sim: Sim, e: Enemy) {
  if (e.ai === 'chase' || e.ai === 'engage' || e.ai === 'attack') return;
  setAI(e, 'chase');
  e.awareness = 1;
  sim.events.push({ type: 'alert', tick: sim.tick, enemy: e.id });
  // 무리 전파: 가까운 동료도 경계한다
  const me = e.body.translation();
  for (const o of sim.enemies) {
    if (o === e || o.ai === 'dead' || o.ai === 'chase' || o.ai === 'engage' || o.ai === 'attack') continue;
    const t = o.body.translation();
    if ((t.x - me.x) ** 2 + (t.z - me.z) ** 2 < ALERT_SHARE_R * ALERT_SHARE_R) {
      setAI(o, 'chase');
      o.awareness = 1;
      sim.events.push({ type: 'alert', tick: sim.tick, enemy: o.id });
    }
  }
}

export function damageEnemy(sim: Sim, e: Enemy, damage: number) {
  e.hp = Math.max(0, e.hp - damage);
  releaseToken(sim, e);
  if (e.hp === 0) {
    setAI(e, 'dead');
    e.vx = e.vz = 0;
    // 시체는 길을 막지 않는다
    e.collider.setCollisionGroups(groups(0, 0));
    sim.events.push({ type: 'death', tick: sim.tick, enemy: e.id });
    sim.player.companion = Math.min(COMPANION_FULL, sim.player.companion + KILL_CHARGE);
    // 디렉터 긴장도: 코앞(5m)에서 쓰러뜨리면 +0.05 — 치열한 근접전일수록 긴장이 쌓인다
    const me = e.body.translation();
    const pt = sim.player.body.translation();
    if ((me.x - pt.x) ** 2 + (me.z - pt.z) ** 2 < 25) sim.director.intensity = Math.min(1, sim.director.intensity + 0.05);
    return;
  }
  if (e.kind === 'troll') {
    trollDamaged(sim, e); // 트롤은 보통 공격에 휘청이지 않는다
    return;
  }
  alert(sim, e);
  setAI(e, 'stagger');
  e.staggerLen = HIT_STAGGER;
}

export function stepEnemies(sim: Sim, lights: readonly SimLight[]) {
  const p = sim.player;
  const pt = p.body.translation();
  const playerBright = lightAt(pt.x, pt.y + 0.3, pt.z, lights) > 0.75;

  for (const e of sim.enemies) {
    e.aiTick++;
    if (e.ai === 'dead') continue;
    if (e.kind === 'troll') {
      stepTroll(sim, e, lights);
      continue;
    }
    const me = e.body.translation();
    const dx = pt.x - me.x, dz = pt.z - me.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    // --- 인지 ---
    if (e.ai === 'patrol' || e.ai === 'suspicious') {
      e.awareness = Math.max(0, Math.min(1.2, e.awareness + perceive(sim, e, lights) - 0.004));
      if (e.awareness >= 1) alert(sim, e);
      else if (e.ai === 'patrol' && e.awareness > 0.35) setAI(e, 'suspicious');
      else if (e.ai === 'suspicious' && e.awareness < 0.1) setAI(e, 'patrol');
    }

    switch (e.ai) {
      case 'patrol': {
        const wp = e.patrol[e.patrolIdx]!;
        if ((wp[0] - me.x) ** 2 + (wp[2] - me.z) ** 2 < 0.25) e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
        followPath(sim, e, e.patrol[e.patrolIdx]!, PATROL_SPEED);
        break;
      }
      case 'suspicious':
        // 기척이 난 쪽으로 조심스럽게 다가간다
        followPath(sim, e, e.lastSeen, SUSPICIOUS_SPEED);
        break;
      case 'chase': {
        if (p.action === 'dead') {
          setAI(e, 'patrol');
          e.awareness = 0;
          break;
        }
        followPath(sim, e, [pt.x, pt.y, pt.z], CHASE_SPEED);
        if (dist < ENGAGE_R + 1.5) setAI(e, 'engage');
        // 오래 못 보면 포기
        if (e.aiTick > LOSE_TICKS && dist > SIGHT) {
          setAI(e, 'suspicious');
          e.awareness = 0.5;
        }
        break;
      }
      case 'engage': {
        if (p.action === 'dead') {
          setAI(e, 'patrol');
          e.awareness = 0;
          break;
        }
        if (dist > ENGAGE_R + 3) {
          setAI(e, 'chase');
          break;
        }
        // 공전: 플레이어를 중심으로 반경 R을 유지하며 옆으로 돈다. 횃불빛이 밝으면 더 멀리 (빛을 꺼린다)
        const r = ENGAGE_R + (playerBright ? 1 : 0);
        const around = dAtan2Angle(me.x - pt.x, me.z - pt.z) + e.orbitSign * 200;
        steerTo(e, pt.x + dsin(around) * r, pt.z + dcos(around) * r, ORBIT_SPEED, false);
        facePlayer(sim, e, TURN);
        // 공격권 요청 (id 순서로 처리되므로 결정적)
        const hesitate = playerBright ? 30 : 0;
        if (!e.hasToken && sim.tokens < MAX_TOKENS && sim.tick >= e.cooldownUntil && e.aiTick > 20 + hesitate) {
          e.hasToken = true;
          sim.tokens++;
          setAI(e, 'attack');
          e.swingTick = -1;
        }
        break;
      }
      case 'attack': {
        const a = GOBLIN_ATTACK;
        if (e.swingTick < 0) {
          // 접근: 사거리 안까지
          steerTo(e, pt.x, pt.z, APPROACH_SPEED, false);
          facePlayer(sim, e, TURN);
          if (dist <= a.reach - 0.15) {
            e.swingTick = 0;
            e.hitSet.clear();
            sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: a.id });
          } else if (e.aiTick > 150 || p.action === 'dead') {
            releaseToken(sim, e);
            e.cooldownUntil = sim.tick + 60;
            setAI(e, 'engage');
          }
          break;
        }
        e.swingTick++;
        const t = e.swingTick;
        // 예비 동작의 앞 2/3까지는 플레이어를 따라 돈다 → 마지막 1/3에 피하면 빗나간다
        if (t < (a.windup * 2) / 3) facePlayer(sim, e, TURN / 2);
        if (t < a.windup + a.active) {
          e.vx = -dsin(e.facing) * (t >= a.windup - 6 ? a.lunge : 0);
          e.vz = -dcos(e.facing) * (t >= a.windup - 6 ? a.lunge : 0);
        } else accelTo(e, 0, 0);
        if (isActive(a, t) && !e.hitSet.has(0)) {
          if (inArc(me.x, me.y, me.z, e.facing, pt.x, pt.y, pt.z, p.stats.capsuleRadius, a.reach, a.halfArc)) {
            e.hitSet.add(0);
            const r = hitPlayer(sim, a.damage, me.x, me.z, e.facing);
            if (r === 'parry') {
              releaseToken(sim, e);
              setAI(e, 'stagger');
              e.staggerLen = PARRIED_STAGGER; // 패링당하면 오래 휘청인다 → 반격 기회
              p.riposteUntil = sim.tick + RIPOSTE_TICKS;
              sim.hitstop = Math.max(sim.hitstop, 8);
              sim.events.push({ type: 'parry', tick: sim.tick, enemy: e.id });
              break;
            }
            if (r === 'hit') {
              sim.hitstop = Math.max(sim.hitstop, a.hitstop);
              emitNoise(sim, pt.x, pt.y, pt.z, 0.8, 10, 20);
            }
          }
        }
        if (t >= attackLength(a)) {
          releaseToken(sim, e);
          e.cooldownUntil = sim.tick + 60 + sim.rng.int(60);
          setAI(e, 'engage');
        }
        break;
      }
      case 'stagger':
        accelTo(e, 0, 0);
        if (e.aiTick >= e.staggerLen) setAI(e, dist < ENGAGE_R + 1.5 ? 'engage' : 'chase');
        break;
    }

    if (e.ai !== 'attack' || e.swingTick < 0) separate(sim, e);
    moveMover(e, sim.enemyController);
  }
}
