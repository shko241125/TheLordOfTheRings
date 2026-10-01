import { DT } from '../core/loop';
import { angleDiff, dAtan2Angle, dcos, dsin } from '../core/trig';
import type { ClassStats } from './classes';
import {
  COST_DODGE, COST_PARRY, DODGE_IFRAME_FROM, DODGE_IFRAME_TO, DODGE_SPEED, DODGE_TICKS, PARRY_WINDOW_FROM, PARRY_WINDOW_TO, HEAVY, HEAVY_CHARGE_MAX, HEAVY_CHARGE_MIN, INPUT_BUFFER_TICKS,
  LIGHT_COMBO, PARRY_TICKS, PLAYER_STAGGER_TICKS, SPRINT_COST, STAMINA_MAX, STAMINA_REGEN, STAMINA_REGEN_DELAY,
  attackLength, chainFire, chainOpen, dodgeCancel, heavyDamage,
} from './combat';
import { moveMover } from './move';
import { emitNoise } from './perception';
import { torchTap, torchThrow } from './torch';
import {
  BTN_CROUCH, BTN_DODGE, BTN_HEAVY, BTN_LIGHT, BTN_LOCK, BTN_PARRY, BTN_SENSE, BTN_SPRINT, BTN_THROW, BTN_TORCH,
  type Buffered, type InputFrame, type PlayerState, type Sim,
} from './types';

const PIVOT_SPEED_FACTOR = 0.2;
const AIR_TURN_FACTOR = 0.3;
const LOCK_RANGE = 16;
const ATTACK_TURN = 683; // 공격 시작 시 입력 방향으로 최대 60° 돌기

function targetSpeed(s: ClassStats, mag: number, buttons: number, exhausted: boolean): number {
  if (mag === 0) return 0;
  if ((buttons & BTN_CROUCH) !== 0) return s.crouchSpeed * mag;
  if ((buttons & BTN_SPRINT) !== 0 && !exhausted) return s.sprintSpeed;
  return mag <= 0.5 ? s.walkSpeed * (mag / 0.5) : s.walkSpeed + (s.jogSpeed - s.walkSpeed) * ((mag - 0.5) / 0.5);
}

/** 입력 방향 (월드) — 크기는 0..127 */
function inputDir(input: InputFrame): { x: number; z: number; mag: number } {
  let mx = input.moveX;
  let my = input.moveY;
  let len2 = mx * mx + my * my;
  if (len2 > 127 * 127) {
    // Math.sqrt는 명세상 정확히 반올림되는 연산이라 엔진 간 결과가 같다 (sin/cos/atan2와 다름)
    const k = 127 / Math.sqrt(len2);
    mx *= k;
    my *= k;
    len2 = 127 * 127;
  }
  const mag = len2 === 0 ? 0 : Math.sqrt(len2) / 127;
  const sn = dsin(input.yaw);
  const cs = dcos(input.yaw);
  return { x: mx * cs - my * sn, z: -mx * sn - my * cs, mag };
}

function spend(p: PlayerState, sim: Sim, cost: number) {
  p.stamina = Math.max(0, p.stamina - cost);
  p.staminaRegenAt = sim.tick + STAMINA_REGEN_DELAY;
  if (p.stamina === 0) p.exhausted = true;
}

function startAction(p: PlayerState, kind: PlayerState['action']) {
  p.action = kind;
  p.actionTick = 0;
  p.hitSet.clear();
}

function faceLockOrInput(sim: Sim, p: PlayerState, dir: { x: number; z: number; mag: number }, maxTurn: number) {
  const target = p.lockTarget >= 0 ? sim.enemies.find((e) => e.id === p.lockTarget && e.ai !== 'dead') : undefined;
  let want = -1;
  if (target) {
    const t = target.body.translation();
    const me = p.body.translation();
    want = dAtan2Angle(-(t.x - me.x), -(t.z - me.z));
    maxTurn = 2048; // 락온 대상에게는 바로 돌아선다
  } else if (dir.mag > 0) {
    want = dAtan2Angle(-dir.x, -dir.z);
  }
  if (want < 0) return;
  const d = angleDiff(p.facing, want);
  p.facing = (p.facing + (d > maxTurn ? maxTurn : d < -maxTurn ? -maxTurn : d)) & 4095;
}

function startLight(sim: Sim, p: PlayerState, dir: ReturnType<typeof inputDir>, index: number) {
  const a = LIGHT_COMBO[index]!;
  startAction(p, 'attack');
  p.attack = a;
  p.combo = index;
  p.comboQueued = false;
  spend(p, sim, a.stamina * p.mods.stamina);
  faceLockOrInput(sim, p, dir, ATTACK_TURN);
  const t = p.body.translation();
  emitNoise(sim, t.x, t.y, t.z, 0.5, 8, 20);
  sim.events.push({ type: 'swing', tick: sim.tick, actor: -1, attack: a.id });
}

function startHeavy(sim: Sim, p: PlayerState, dir: ReturnType<typeof inputDir>) {
  startAction(p, 'attack');
  p.attack = { ...HEAVY, damage: heavyDamage(p.heavyCharge) };
  p.charging = false;
  spend(p, sim, HEAVY.stamina * p.mods.stamina);
  faceLockOrInput(sim, p, dir, ATTACK_TURN);
  const t = p.body.translation();
  emitNoise(sim, t.x, t.y, t.z, 0.6, 9, 20);
  sim.events.push({ type: 'swing', tick: sim.tick, actor: -1, attack: 'heavy' });
}

function startDodge(sim: Sim, p: PlayerState, dir: ReturnType<typeof inputDir>) {
  startAction(p, 'dodge');
  p.attack = null;
  p.charging = false;
  spend(p, sim, COST_DODGE * p.mods.stamina);
  if (dir.mag > 0) {
    const inv = 1 / (dir.mag * 127);
    p.dodgeDirX = dir.x * inv;
    p.dodgeDirZ = dir.z * inv;
    p.facing = dAtan2Angle(-p.dodgeDirX, -p.dodgeDirZ); // 구르는 방향으로 몸을 돌린다
  } else {
    // 입력이 없으면 뒤로 물러선다 (백스텝)
    p.dodgeDirX = dsin(p.facing);
    p.dodgeDirZ = dcos(p.facing);
  }
  const t = p.body.translation();
  emitNoise(sim, t.x, t.y, t.z, 0.3, 5, 15);
}

function tryAct(sim: Sim, p: PlayerState, want: Buffered['kind'], dir: ReturnType<typeof inputDir>): boolean {
  const t = p.actionTick;
  const canAct = p.stamina > 0;
  if (p.action === 'free') {
    if (!canAct && want !== 'parry') return false;
    if (want === 'light') startLight(sim, p, dir, 0);
    else if (want === 'heavy') {
      startAction(p, 'attack');
      p.attack = null;
      p.charging = true;
      p.heavyCharge = 0;
    } else if (want === 'dodge') startDodge(sim, p, dir);
    else {
      startAction(p, 'parry');
      p.attack = null;
      spend(p, sim, COST_PARRY * p.mods.stamina);
    }
    return true;
  }
  if (p.action === 'attack' && p.attack) {
    if (want === 'light' && chainOpen(p.attack, t) && p.attack.id.startsWith('light')) {
      p.comboQueued = true;
      return true;
    }
    if (want === 'dodge' && canAct && dodgeCancel(p.attack, t)) {
      startDodge(sim, p, dir);
      return true;
    }
  }
  if (p.action === 'dodge' && t >= DODGE_TICKS - 4 && canAct) {
    // 구르기 끝물에 누른 공격은 바로 이어진다 (버퍼가 이 창까지 기다려 준다)
    if (want === 'light') {
      startLight(sim, p, dir, 0);
      return true;
    }
  }
  return false;
}

export function stepPlayer(sim: Sim, input: InputFrame) {
  const p = sim.player;
  const s = p.stats;
  const pressed = input.buttons & ~p.prevButtons;
  p.prevButtons = input.buttons;
  const dir = inputDir(input);
  p.actionTick++;

  if (p.action === 'dead') {
    p.vx = p.vz = 0;
    moveAndCollide(sim, p);
    return;
  }

  // --- 버튼 → 행동 요청 (누른 순간만). 지금 못 하면 150ms 버퍼에 담는다 ---
  const req: Buffered['kind'] | null =
    (pressed & BTN_DODGE) !== 0 ? 'dodge' :
    (pressed & BTN_PARRY) !== 0 ? 'parry' :
    (pressed & BTN_HEAVY) !== 0 ? 'heavy' :
    (pressed & BTN_LIGHT) !== 0 ? 'light' : null;
  if (req) {
    if (!tryAct(sim, p, req, dir)) p.buffer = { kind: req, ticks: INPUT_BUFFER_TICKS };
  } else if (p.buffer) {
    if (tryAct(sim, p, p.buffer.kind, dir) || --p.buffer.ticks <= 0) p.buffer = null;
  }

  if ((pressed & BTN_LOCK) !== 0) toggleLock(sim, p);
  if ((pressed & BTN_SENSE) !== 0 && p.action === 'free' && sim.tick >= p.senseReadyAt) stoneSense(sim, p);
  if ((pressed & BTN_TORCH) !== 0 && p.action === 'free') torchTap(sim);
  if ((pressed & BTN_THROW) !== 0 && (p.action === 'free' || p.action === 'attack')) torchThrow(sim);
  if (p.lockTarget >= 0 && !sim.enemies.some((e) => e.id === p.lockTarget && e.ai !== 'dead')) p.lockTarget = -1;

  p.crouching = (input.buttons & BTN_CROUCH) !== 0 && p.action === 'free';

  // --- 행동별 이동 ---
  switch (p.action) {
    case 'free':
      locomotion(p, s, input, dir);
      break;
    case 'attack': {
      if (p.charging) {
        // 강공격 차지: 버튼을 떼거나 최대치에 이르면 발동. 차지 중에는 천천히 돈다.
        p.heavyCharge++;
        faceLockOrInput(sim, p, dir, 30);
        brake(p, s.decel);
        if ((input.buttons & BTN_HEAVY) === 0 || p.heavyCharge >= HEAVY_CHARGE_MAX) {
          if (p.heavyCharge < HEAVY_CHARGE_MIN && (input.buttons & BTN_HEAVY) === 0) p.heavyCharge = HEAVY_CHARGE_MIN;
          startHeavy(sim, p, dir);
        }
        break;
      }
      const a = p.attack!;
      const t = p.actionTick;
      // 예비 동작~판정 동안 앞으로 내딛는다, 그 뒤엔 멈춘다
      if (t < a.windup + a.active) {
        p.vx = -dsin(p.facing) * a.lunge;
        p.vz = -dcos(p.facing) * a.lunge;
      } else brake(p, s.decel);
      if (p.comboQueued && chainFire(a, t) && p.stamina > 0 && p.combo < LIGHT_COMBO.length - 1) {
        startLight(sim, p, dir, p.combo + 1);
      } else if (t >= attackLength(a)) {
        startAction(p, 'free');
        p.attack = null;
        p.combo = 0;
      }
      break;
    }
    case 'dodge': {
      const t = p.actionTick;
      // 처음 빠르고 끝으로 갈수록 느려진다 (선형 감쇠)
      const k = DODGE_SPEED * (1 - t / DODGE_TICKS);
      p.vx = p.dodgeDirX * k;
      p.vz = p.dodgeDirZ * k;
      if (t >= DODGE_TICKS) startAction(p, 'free');
      break;
    }
    case 'parry':
      brake(p, s.decel);
      if (p.actionTick >= PARRY_TICKS) startAction(p, 'free');
      break;
    case 'stagger':
      brake(p, s.decel * 0.5);
      if (p.actionTick >= PLAYER_STAGGER_TICKS) startAction(p, 'free');
      break;
  }

  // --- 스태미나 ---
  if ((input.buttons & BTN_SPRINT) !== 0 && p.action === 'free' && !p.exhausted && dir.mag > 0) spend(p, sim, SPRINT_COST * p.mods.stamina);
  if (sim.tick >= p.staminaRegenAt && p.action !== 'attack' && p.action !== 'dodge') p.stamina = Math.min(STAMINA_MAX, p.stamina + STAMINA_REGEN);
  if (p.exhausted && p.stamina >= 30) p.exhausted = false;

  moveAndCollide(sim, p);

  // 발소리: 달릴수록 크게, 웅크리면 없음
  const speed2 = p.vx * p.vx + p.vz * p.vz;
  if (p.grounded && !p.crouching && speed2 > 4) {
    const sprint = speed2 > (s.jogSpeed + 0.5) ** 2;
    if (sim.tick % (sprint ? 14 : 20) === 0) {
      const t = p.body.translation();
      emitNoise(sim, t.x, t.y, t.z, sprint ? 0.6 : 0.35, sprint ? 10 : 6, 30);
    }
  }
}

function brake(p: PlayerState, decel: number) {
  const v = Math.sqrt(p.vx * p.vx + p.vz * p.vz);
  const dv = decel * DT;
  if (v <= dv) p.vx = p.vz = 0;
  else {
    p.vx -= (p.vx / v) * dv;
    p.vz -= (p.vz / v) * dv;
  }
}

function locomotion(p: PlayerState, s: ClassStats, input: InputFrame, dir: ReturnType<typeof inputDir>) {
  let speed = targetSpeed(s, dir.mag, input.buttons, p.exhausted);
  if (dir.mag > 0) {
    const target = dAtan2Angle(-dir.x, -dir.z);
    const diff = angleDiff(p.facing, target);
    let rate = (input.buttons & BTN_SPRINT) !== 0 ? s.sprintTurnRate : s.turnRate;
    if (!p.grounded) rate = Math.round(rate * AIR_TURN_FACTOR);
    const step = diff > rate ? rate : diff < -rate ? -rate : diff;
    p.facing = (p.facing + step) & 4095;
    const left = Math.abs(angleDiff(p.facing, target));
    if (left > 1024) speed *= PIVOT_SPEED_FACTOR;
    else speed *= 1 - (1 - 0.6) * (left / 1024);
  }
  const invLen = dir.mag > 0 ? 1 / (dir.mag * 127) : 0;
  const wantX = dir.x * invLen * speed;
  const wantZ = dir.z * invLen * speed;
  const a = p.grounded ? (speed > 0 ? s.accel : s.decel) : s.airAccel;
  const dvx = wantX - p.vx;
  const dvz = wantZ - p.vz;
  const dvLen = Math.sqrt(dvx * dvx + dvz * dvz);
  const maxDv = a * DT;
  if (dvLen <= maxDv) {
    p.vx = wantX;
    p.vz = wantZ;
  } else {
    p.vx += (dvx / dvLen) * maxDv;
    p.vz += (dvz / dvLen) * maxDv;
  }
}

/** 공용 이동(move.ts) + 착지 기록 (렌더의 착지 모션용) */
function moveAndCollide(sim: Sim, p: PlayerState) {
  const landed = moveMover(p, p.controller);
  if (landed > 0) {
    p.landedTick = sim.tick + 1;
    p.landedAirTicks = landed;
  }
}

/**
 * 돌의 감각 (계획서 D): 바닥을 두드려 음파를 퍼뜨린다. 렌더는 반경 안의 윤곽을 2초간 보여 주고,
 * 대가로 15m 안의 적이 그 소리를 듣는다 (난사하면 어둠의 이점이 사라지지 않게 쿨다운 8초).
 */
export const SENSE_COOLDOWN = 8 * 60;
function stoneSense(sim: Sim, p: PlayerState) {
  p.senseReadyAt = sim.tick + SENSE_COOLDOWN - p.mods.senseCd;
  const t = p.body.translation();
  emitNoise(sim, t.x, t.y, t.z, 0.5, 15, 180);
  sim.events.push({ type: 'sense', tick: sim.tick, x: t.x, y: t.y, z: t.z, radius: p.stats.senseRadius + p.mods.sense });
}

/** 락온: 앞쪽 가까운 살아 있는 적 (거리 + 각도 가중치). 다시 누르면 해제. */
function toggleLock(sim: Sim, p: PlayerState) {
  if (p.lockTarget >= 0) {
    p.lockTarget = -1;
    return;
  }
  const me = p.body.translation();
  let best = -1;
  let bestScore = Infinity;
  for (const e of sim.enemies) {
    if (e.ai === 'dead') continue;
    const t = e.body.translation();
    const dx = t.x - me.x, dz = t.z - me.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > LOCK_RANGE) continue;
    const off = Math.abs(angleDiff(p.facing, dAtan2Angle(-dx, -dz)));
    const score = d + off / 200; // 정면 90°(1024) ≈ 5m 페널티
    if (score < bestScore) {
      bestScore = score;
      best = e.id;
    }
  }
  p.lockTarget = best;
}

/** 플레이어가 맞았다: 무적·패링·피해 처리. 반환값 = 실제로 맞았는가 */
/** unparryable: 패링 창이어도 맞는다 (트롤 내려찍기 — 피해야만 한다). knockback: 밀려나는 속도 (m/s) */
export function hitPlayer(
  sim: Sim, damage: number, fromX: number, fromZ: number, attackerFacing: number,
  opts: { unparryable?: boolean; knockback?: number; source?: 'goblin' | 'troll' | 'collapse' } = {},
): 'iframe' | 'parry' | 'hit' {
  const p = sim.player;
  if (p.action === 'dodge' && p.actionTick >= DODGE_IFRAME_FROM && p.actionTick < DODGE_IFRAME_TO + p.mods.iframe) return 'iframe';
  if (!opts.unparryable && p.action === 'parry' && p.actionTick >= PARRY_WINDOW_FROM && p.actionTick < PARRY_WINDOW_TO + p.mods.parry) {
    // 정면 ±90°에서 온 공격만 패링된다
    const me = p.body.translation();
    const toAttacker = dAtan2Angle(-(fromX - me.x), -(fromZ - me.z));
    if (Math.abs(angleDiff(p.facing, toAttacker)) <= 1024) return 'parry';
  }
  if (p.action === 'dead') return 'iframe';
  p.hp = Math.max(0, p.hp - damage);
  sim.events.push({ type: 'playerHit', tick: sim.tick, damage, source: opts.source ?? 'goblin' });
  // 디렉터 긴장도: 맞은 피해 비율만큼 오른다 (L4D 방식)
  sim.director.intensity = Math.min(1, sim.director.intensity + damage / p.maxHp);
  if (p.hp === 0) {
    startAction(p, 'dead');
    return 'hit';
  }
  startAction(p, 'stagger');
  p.attack = null;
  p.charging = false;
  p.comboQueued = false;
  // 넉백: 공격자 바라보는 방향으로 밀린다
  const kb = opts.knockback ?? 3;
  p.vx = -dsin(attackerFacing) * kb;
  p.vz = -dcos(attackerFacing) * kb;
  return 'hit';
}
