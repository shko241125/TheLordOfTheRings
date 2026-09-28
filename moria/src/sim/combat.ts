import { angleDiff, dAtan2Angle } from '../core/trig';
import type { AttackDef } from './types';

/**
 * 전투 수치 (계획서 9장: 입력 버퍼 150ms, 회피 무적 0.3초, 패링 창 0.2초, 히트스톱 60ms).
 * 틱 = 1/60초. 모든 판정은 시뮬레이션 틱으로 한다 — 애니메이션은 이 타이밍을 따라간다.
 */
export const INPUT_BUFFER_TICKS = 9; // 150ms
export const DODGE_TICKS = 24; // 0.4s
export const DODGE_IFRAME_FROM = 2;
export const DODGE_IFRAME_TO = 20; // 18틱 = 0.3s 무적
export const DODGE_SPEED = 8.5; // 시작 속도, 끝으로 갈수록 줄어든다
export const PARRY_TICKS = 30;
export const PARRY_WINDOW_FROM = 2;
export const PARRY_WINDOW_TO = 14; // 12틱 = 0.2s
export const PLAYER_STAGGER_TICKS = 18;
export const RIPOSTE_TICKS = 90;
export const RIPOSTE_MULT = 2.5;

export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 35 / 60; // /tick
export const STAMINA_REGEN_DELAY = 30;
export const COST_DODGE = 18;
export const COST_PARRY = 6;
export const SPRINT_COST = 12 / 60;

export const HEAVY_CHARGE_MIN = 10;
export const HEAVY_CHARGE_MAX = 45;

const deg = (d: number) => Math.round((d / 360) * 4096);

/** 약공격 4타: 점점 느리고 강하다. 마지막 타는 크게 휘둘러 범위가 넓다. */
export const LIGHT_COMBO: readonly AttackDef[] = [
  { id: 'light1', windup: 7, active: 4, recovery: 14, damage: 10, reach: 1.9, halfArc: deg(55), stamina: 12, lunge: 2.2, hitstop: 4 },
  { id: 'light2', windup: 7, active: 4, recovery: 14, damage: 10, reach: 1.9, halfArc: deg(55), stamina: 12, lunge: 2.2, hitstop: 4 },
  { id: 'light3', windup: 8, active: 4, recovery: 16, damage: 12, reach: 2.0, halfArc: deg(60), stamina: 13, lunge: 2.6, hitstop: 5 },
  { id: 'light4', windup: 11, active: 5, recovery: 24, damage: 16, reach: 2.2, halfArc: deg(75), stamina: 15, lunge: 3.2, hitstop: 7 },
];

export const HEAVY: AttackDef = { id: 'heavy', windup: 6, active: 5, recovery: 26, damage: 20, reach: 2.3, halfArc: deg(65), stamina: 22, lunge: 3.0, hitstop: 8 };

/** 고블린 공격: 예비 동작 0.5초 (반응 가능한 예고 — 계획서 "공정한 전투") */
export const GOBLIN_ATTACK: AttackDef = { id: 'goblin', windup: 30, active: 5, recovery: 28, damage: 12, reach: 1.45, halfArc: deg(50), stamina: 0, lunge: 1.6, hitstop: 5 };

/** 약공격 다음 단계를 예약할 수 있는 구간: 판정 시작부터 회복 끝 2틱 전까지 */
export const chainOpen = (a: AttackDef, t: number) => t >= a.windup && t < a.windup + a.active + a.recovery - 2;
/** 예약된 다음 공격이 실제로 나가는 시점: 판정 끝 + 4틱 (너무 빨리 끊으면 휘두르기가 보이지 않는다) */
export const chainFire = (a: AttackDef, t: number) => t >= a.windup + a.active + 4;
/** 회복 구간에서는 회피로 끊을 수 있다 (반응성) */
export const dodgeCancel = (a: AttackDef, t: number) => t >= a.windup + a.active + 2;
export const isActive = (a: AttackDef, t: number) => t >= a.windup && t < a.windup + a.active;
export const attackLength = (a: AttackDef) => a.windup + a.active + a.recovery;

/** 강공격 피해: 차지 비율에 따라 1.0 ~ 1.8배 */
export function heavyDamage(charge: number): number {
  const c = Math.min(Math.max(charge - HEAVY_CHARGE_MIN, 0), HEAVY_CHARGE_MAX - HEAVY_CHARGE_MIN) / (HEAVY_CHARGE_MAX - HEAVY_CHARGE_MIN);
  return Math.round(HEAVY.damage * (1 + 0.8 * c));
}

/**
 * 부채꼴 판정: 공격자 (ax, az, facing) 앞의 반경 reach(+대상 반지름), 반각 halfArc 안에 대상 중심이 있는가.
 * 높이 차가 1.2m 넘으면 빗나간다 (계단 위아래).
 */
export function inArc(
  ax: number, ay: number, az: number, facing: number,
  tx: number, ty: number, tz: number, targetRadius: number,
  reach: number, halfArc: number,
): boolean {
  const dx = tx - ax;
  const dz = tz - az;
  if (Math.abs(ty - ay) > 1.2) return false;
  const d2 = dx * dx + dz * dz;
  const r = reach + targetRadius;
  if (d2 > r * r) return false;
  if (d2 < 0.25) return true; // 거의 겹쳐 있으면 방향과 무관하게 맞는다
  const dir = dAtan2Angle(-dx, -dz); // 앞 = (−sin, −cos) 규약
  return Math.abs(angleDiff(facing, dir)) <= halfArc;
}
