import { angleDiff, dAtan2Angle } from '../core/trig';
import type { AttackDef, Enemy, Sim } from './types';

/**
 * 우루크 (계획서 9장 적 표: 엘리트 — 방패 들고 전진, 가드 브레이크 시 빈틈. 대응: 강공격).
 * 몸놀림은 고블린 상태 머신(공격 토큰·공전)을 그대로 쓰고, 다른 것은 셋:
 *   방패: 앞 ±70°에서 온 약공격은 20%만 들어가고 휘청이지 않는다. 옆·뒤는 그대로.
 *   가드 브레이크: 앞에서 강공격이나 반격(패링 뒤)을 맞으면 방패가 깨져 1초 휘청이고, 1.5초 동안 막지 못한다.
 *   공격: 고블린보다 느리고(0.6초 예고) 세다.
 * 방패가 깨진 동안의 끝 틱은 e.used에 둔다 (스냅샷·해시에 이미 담기는 칸).
 */
export const URUK_HP = 80;
export const URUK_CAPSULE = { half: 0.55, radius: 0.38 }; // 키 1.86m
const deg = (d: number) => Math.round((d / 360) * 4096);
export const URUK_ATTACK: AttackDef = { id: 'uruk', windup: 36, active: 6, recovery: 30, damage: 18, reach: 1.7, halfArc: deg(55), stamina: 0, lunge: 2.0, hitstop: 6 };
export const URUK_CHASE = 3.8;
export const GUARD_ARC = deg(70);
export const GUARD_MULT = 0.2;
const BROKEN_TICKS = 90;
const BREAK_STAGGER = 60;
const HIT_STAGGER = 14;

export const guardBroken = (sim: Sim, e: Enemy) => sim.tick < e.used;

/**
 * 플레이어 공격의 피해 배율 (방패). 앞에서 온 강공격·반격이면 방패를 깬다.
 * 이어지는 damageEnemy가 쓸 휘청임 길이를 e.staggerLen에 남긴다: 0 = 막음(휘청이지 않음), 60 = 방패가 깨짐, 14 = 보통
 */
export function urukGuard(sim: Sim, e: Enemy, px: number, pz: number, breaks: boolean): number {
  e.staggerLen = HIT_STAGGER;
  if (guardBroken(sim, e)) return 1;
  const t = e.body.translation();
  if (Math.abs(angleDiff(e.facing, dAtan2Angle(-(px - t.x), -(pz - t.z)))) > GUARD_ARC) return 1;
  if (breaks) {
    e.used = sim.tick + BROKEN_TICKS;
    e.staggerLen = BREAK_STAGGER;
    sim.events.push({ type: 'guardBreak', tick: sim.tick, enemy: e.id });
    return 1;
  }
  e.staggerLen = 0;
  sim.events.push({ type: 'block', tick: sim.tick, enemy: e.id });
  return GUARD_MULT;
}
