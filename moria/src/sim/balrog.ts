import { DT } from '../core/loop';
import { dAtan2Angle, dcos, dsin } from '../core/trig';
import { ORB_SPEED } from './archer';
import { setAI, turnTo } from './enemy';
import { XP, addXp } from './growth';
import { hitPlayer, startAction } from './player';
import { groups, type Enemy, type Sim } from './types';

/**
 * 발로그전 (계획서 9장 발로그 보스전 3페이즈 — 구역 5 크하잣둠의 다리).
 *   1. 불길 추격: 두 번째 홀에 들어서면 뒤에서 불의 벽이 다가온다. 다리 앞까지 달린다 (stepChase).
 *   2. 다리 위 결전: 발로그는 다리 서쪽 끝 단에 버티고 선다.
 *      내리찍기 — 불칼이 1.2초 예고(바닥의 붉은 띠) 뒤 앞으로 14m를 가른다(45, 패링 불가). 내리찍은 뒤 1.8초 칼이 다리에 박혀
 *                가슴의 균열이 열린다 = 이때만 제대로 들어간다(평소에는 25%).
 *      날개 바람 — 한쪽 날개가 들리고 0.8초 뒤 옆으로 민다. 난간 없는 다리라 웅크려(C) 버티지 않으면 밀려 떨어진다.
 *      불덩이 — 멀리 있으면 셋을 던진다 (화살처럼 피한다).
 *   3. 그림자와 불꽃(체력 40%): 채찍(맞으면 끌려온다), 불의 고리(퍼져 나오는 불 — 회피 무적으로 뚫는다)가 더해진다.
 *   체력 10%: 이길 수 없는 존재 — 간달프가 다리를 부수고 발로그는 심연으로 떨어진다 (계획서: 승리 = 버티기 + 연출).
 * 발로그는 움직이지 않는다 (몸이 다리보다 넓다). 결정성: 난수는 sim.rng, 각도는 정수 표, 진행은 틱.
 */
export const BALROG_HP = 1400;
export const BALROG_CAPSULE = { half: 2.0, radius: 1.2 }; // 키 6.4m
export const ARMOR = 0.25;
export const SLAM_WINDUP = 72;
const SLAM_LOCK = 48;
export const SLAM_LEN = 14;
export const SLAM_HALF = 1.5;
const SLAM_DAMAGE = 45;
export const EXPOSED_TICKS = 110;
export const WIND_WINDUP = 50;
const WIND_TICKS = 45;
export const WIND_PUSH = 4.2;
const WIND_BRACED = 1.0;
const ORB_AT = [40, 52, 64];
export const WHIP_WINDUP = 40;
const WHIP_LEN = 18;
const WHIP_HALF = 1.0;
const WHIP_DAMAGE = 15;
const WHIP_PULL = 7;
const WHIP_PULL_TICKS = 30;
export const WAVE_WINDUP = 60;
export const WAVE_SPEED = 10;
const WAVE_MAX = 22;
const WAVE_DAMAGE = 25;
export const FALL_TICKS = 180;
const TURN = 40;
const FIRE_DPS_TICK = 3;
/** used 비트 */
export const PHASE3 = 1;
export const ENDING = 2;

/** 플레이어 공격 피해 배율: 칼이 박혀 있는 동안(휘청임)만 온전히, 끝 장면에서는 0 */
export const balrogArmor = (e: Enemy) => ((e.used & ENDING) !== 0 ? 0 : e.ai === 'stagger' ? 1 : ARMOR);

/** 플레이어가 선분(o → o + dir·len, 반폭 half) 안에 있는가 */
function onLine(sim: Sim, ox: number, oz: number, dx: number, dz: number, len: number, half: number): boolean {
  const pt = sim.player.body.translation();
  const rx = pt.x - ox, rz = pt.z - oz;
  const along = rx * dx + rz * dz;
  const across = Math.abs(rx * dz - rz * dx);
  return along >= 0 && along <= len && across <= half + sim.player.stats.capsuleRadius;
}

/** 맞은 뒤 (damageEnemy가 부른다): 페이즈 전환·끝 장면. 체력은 10% 아래로 내려가지 않는다 (쓰러뜨리는 것이 아니다) */
export function balrogDamaged(sim: Sim, e: Enemy) {
  if (!(e.used & PHASE3) && e.hp <= BALROG_HP * 0.4) {
    e.used |= PHASE3;
    sim.events.push({ type: 'balrog', tick: sim.tick, stage: 'phase3' });
  }
  if (!(e.used & ENDING) && e.hp <= BALROG_HP * 0.1) {
    e.used |= ENDING;
    setAI(e, 'attack');
    e.move = '';
    e.swingTick = -1;
    sim.events.push({ type: 'balrog', tick: sim.tick, stage: 'break' });
  }
}
export const balrogFloor = () => Math.round(BALROG_HP * 0.1);

function start(sim: Sim, e: Enemy, move: Enemy['move']) {
  setAI(e, 'attack');
  e.move = move;
  e.swingTick = 0;
  e.step = 0;
  e.hitSet.clear();
  const pt = sim.player.body.translation();
  e.aimX = pt.x;
  e.aimZ = pt.z;
  if (move === 'wind') e.step = sim.rng.int(2) === 0 ? 1 : -1; // 어느 쪽 날개 (발로그 기준 오른쪽 +1)
  sim.events.push({ type: 'swing', tick: sim.tick, actor: e.id, attack: move === 'wind' ? (e.step > 0 ? 'windR' : 'windL') : move });
}

function finish(sim: Sim, e: Enemy) {
  setAI(e, 'engage');
  e.move = '';
  e.swingTick = -1;
  e.cooldownUntil = sim.tick + 40 + sim.rng.int(40);
}

export function stepBalrog(sim: Sim, e: Enemy) {
  if (e.ai === 'patrol' || e.ai === 'dead') return; // 추격이 끝나기 전에는 나타나지 않는다
  const p = sim.player;
  const me = e.body.translation();
  const pt = p.body.translation();
  const dx = pt.x - me.x, dz = pt.z - me.z;
  const d = Math.sqrt(dx * dx + dz * dz);

  if (e.used & ENDING) {
    // 간달프가 다리를 부순다 → 떨어진다
    if (e.aiTick >= FALL_TICKS) {
      e.hp = 0;
      setAI(e, 'dead');
      e.collider.setCollisionGroups(groups(0, 0));
      sim.events.push({ type: 'balrog', tick: sim.tick, stage: 'fall' });
      sim.events.push({ type: 'death', tick: sim.tick, enemy: e.id });
      addXp(sim, XP.balrog);
    }
    return;
  }
  if (p.action === 'dead') {
    if (e.ai === 'attack') finish(sim, e);
    return;
  }

  switch (e.ai) {
    case 'engage':
    case 'chase':
    case 'suspicious': {
      turnTo(e, dAtan2Angle(-dx, -dz), TURN);
      if (sim.tick < e.cooldownUntil) break;
      const p3 = (e.used & PHASE3) !== 0;
      if (d > 10) start(sim, e, p3 && sim.rng.int(2) === 0 ? 'whip' : 'orb');
      else {
        const opts: Enemy['move'][] = p3 ? ['slam', 'slam', 'wind', 'wave', 'whip'] : ['slam', 'slam', 'wind'];
        start(sim, e, opts[sim.rng.int(opts.length)]!);
      }
      break;
    }
    case 'stagger':
      // 칼이 다리에 박혀 가슴이 열려 있다
      if (e.aiTick >= e.staggerLen) finish(sim, e);
      break;
    case 'attack': {
      const t = ++e.swingTick;
      const fx = -dsin(e.facing), fz = -dcos(e.facing);
      switch (e.move) {
        case 'slam': {
          if (t < SLAM_LOCK) {
            e.aimX = pt.x;
            e.aimZ = pt.z;
            turnTo(e, dAtan2Angle(-dx, -dz), TURN);
          }
          if (t === SLAM_WINDUP) {
            const ax = e.aimX - me.x, az = e.aimZ - me.z;
            const al = Math.sqrt(ax * ax + az * az) || 1;
            if (onLine(sim, me.x, me.z, ax / al, az / al, SLAM_LEN, SLAM_HALF)) {
              hitPlayer(sim, SLAM_DAMAGE, me.x, me.z, e.facing, { unparryable: true, knockback: 4, source: 'balrog' });
            }
            sim.events.push({ type: 'slam', tick: sim.tick, enemy: e.id, x: me.x + (ax / al) * 6, y: pt.y, z: me.z + (az / al) * 6 });
            setAI(e, 'stagger');
            e.staggerLen = EXPOSED_TICKS;
            sim.events.push({ type: 'balrog', tick: sim.tick, stage: 'exposed' });
          }
          break;
        }
        case 'wind': {
          if (t >= WIND_WINDUP && t < WIND_WINDUP + WIND_TICKS && d < 24) {
            // 발로그 기준 오른쪽(+1)/왼쪽(−1)으로 민다. 웅크리면 버틴다
            const k = e.step * (p.crouching ? WIND_BRACED : WIND_PUSH);
            p.pushX += dcos(e.facing) * k;
            p.pushZ += -dsin(e.facing) * k;
          }
          if (t >= WIND_WINDUP + WIND_TICKS) finish(sim, e);
          break;
        }
        case 'orb': {
          turnTo(e, dAtan2Angle(-dx, -dz), TURN);
          const k = ORB_AT.indexOf(t);
          if (k >= 0) {
            const ox = me.x + fx * 1.6, oy = me.y + 1.5, oz = me.z + fz * 1.6;
            // 셋이 조금씩 벌어진다 (가운데·오른쪽·왼쪽)
            const side = (k === 1 ? 1 : k === 2 ? -1 : 0) * 0.9;
            const tx = pt.x + dcos(e.facing) * side, tz = pt.z - dsin(e.facing) * side;
            const vx = tx - ox, vy = pt.y + 0.3 - oy, vz = tz - oz;
            const l = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
            sim.arrows.push({ id: sim.nextArrowId++, x: ox, y: oy, z: oz, vx: (vx / l) * ORB_SPEED, vy: (vy / l) * ORB_SPEED, vz: (vz / l) * ORB_SPEED, ttl: 150, fire: true });
          }
          if (t >= 80) finish(sim, e);
          break;
        }
        case 'whip': {
          if (t < 30) {
            e.aimX = pt.x;
            e.aimZ = pt.z;
            turnTo(e, dAtan2Angle(-dx, -dz), TURN);
          }
          if (t === WHIP_WINDUP) {
            const ax = e.aimX - me.x, az = e.aimZ - me.z;
            const al = Math.sqrt(ax * ax + az * az) || 1;
            if (onLine(sim, me.x, me.z, ax / al, az / al, WHIP_LEN, WHIP_HALF)) {
              if (hitPlayer(sim, WHIP_DAMAGE, me.x, me.z, e.facing, { unparryable: true, knockback: 0, source: 'balrog' }) === 'hit') e.step = 1;
            }
          }
          // 맞았으면 끌려온다 (발로그 2.5m 앞까지)
          if (e.step === 1 && t > WHIP_WINDUP && t <= WHIP_WINDUP + WHIP_PULL_TICKS && d > 2.5) {
            p.pushX += (-dx / d) * WHIP_PULL;
            p.pushZ += (-dz / d) * WHIP_PULL;
          }
          if (t >= WHIP_WINDUP + WHIP_PULL_TICKS + 5) finish(sim, e);
          break;
        }
        case 'wave': {
          if (t >= WAVE_WINDUP) {
            const r = (t - WAVE_WINDUP) * DT * WAVE_SPEED;
            if (!e.hitSet.has(0) && Math.abs(d - r) < 0.8) {
              hitPlayer(sim, WAVE_DAMAGE, me.x, me.z, e.facing, { unparryable: true, knockback: 3, source: 'balrog' });
              e.hitSet.add(0); // 맞았든 회피로 뚫었든 고리는 지나갔다
            }
            if (r >= WAVE_MAX) finish(sim, e);
          }
          break;
        }
        default:
          finish(sim, e);
      }
      break;
    }
  }
}

/** 불길 추격 (1페이즈): 불의 벽이 다가온다. 다리 앞(safeZ)에 닿으면 발로그가 불 속에서 나온다 */
export function stepChase(sim: Sim) {
  const c = sim.level.chase;
  if (!c) return;
  const st = sim.chase;
  const p = sim.player;
  const pt = p.body.translation();
  const boss = sim.enemies.find((e) => e.id === sim.bosses[0]);
  if (st.state === 'idle') {
    if (!boss || boss.ai === 'dead') {
      st.state = 'done';
      return;
    }
    if (pt.z < c.triggerZ && p.action !== 'dead') {
      st.state = 'run';
      sim.events.push({ type: 'chase', tick: sim.tick, stage: 'start' });
    }
    return;
  }
  if (st.state !== 'run') return;
  st.z = Math.max(c.stopZ, st.z - c.speed * DT);
  // 벽에 닿으면 탄다 (몇 틱이면 쓰러진다)
  if (p.action !== 'dead' && pt.z > st.z - 0.4 && Math.abs(pt.x) < c.halfWidth) {
    p.hp = Math.max(0, p.hp - FIRE_DPS_TICK);
    if (sim.tick % 15 === 0 || p.hp === 0) sim.events.push({ type: 'playerHit', tick: sim.tick, damage: FIRE_DPS_TICK, source: 'fire' });
    if (p.hp === 0) startAction(p, 'dead');
  }
  if (pt.z < c.safeZ && p.action !== 'dead') {
    st.state = 'done';
    sim.events.push({ type: 'chase', tick: sim.tick, stage: 'end' });
    if (boss && boss.ai === 'patrol') {
      boss.body.setTranslation({ x: c.bossAt[0], y: c.bossAt[1], z: c.bossAt[2] }, true);
      boss.facing = 0;
      setAI(boss, 'engage');
      boss.cooldownUntil = sim.tick + 90;
      sim.events.push({ type: 'balrog', tick: sim.tick, stage: 'wake' });
    }
  }
}
