import type RAPIER from '@dimforge/rapier3d-compat';
import { DT } from '../core/loop';
import { G_CHAR, G_LEVEL, groups, type Mover } from './types';

const GRAVITY = 20;
const TERMINAL_FALL = 30;
/**
 * 접지 중 수직 속도. 0이어야 한다: 아래로 누르면(−1 m/s) 캡슐이 컨트롤러 offset 안으로 파고들어
 * Rapier KCC가 그 틱의 수평 이동을 막는다 (최소 재현: 370틱 중 9회 멈칫 → 0이면 0회).
 * 내리막에서 뜨지 않게 하는 일은 enableSnapToGround가 한다.
 */
const GROUND_STICK = 0;
/** 캐릭터 이동이 부딪히는 것: 레벨 + 다른 캐릭터 (횃불 공은 통과) */
export const MOVE_FILTER = groups(0xffff, G_LEVEL | G_CHAR);

export function makeController(world: RAPIER.World): RAPIER.KinematicCharacterController {
  const c = world.createCharacterController(0.02);
  c.enableAutostep(0.35, 0.2, false);
  c.enableSnapToGround(0.3);
  c.setMaxSlopeClimbAngle(0.7853981633974483); // 45°
  c.setMinSlopeSlideAngle(0.8726646259971648); // 50°
  c.setSlideEnabled(true);
  return c;
}

/**
 * Rapier KCC로 이동 → 벽에 막힌 만큼 속도를 실제 이동량으로 보정 → 체공 틱 갱신.
 * 반환: 이번 틱에 착지했으면 직전 체공 틱 수, 아니면 0.
 */
export function moveMover(m: Mover, controller: RAPIER.KinematicCharacterController): number {
  m.vy = m.grounded ? GROUND_STICK : Math.max(m.vy - GRAVITY * DT, -TERMINAL_FALL);
  controller.computeColliderMovement(m.collider, { x: m.vx * DT, y: m.vy * DT, z: m.vz * DT }, undefined, MOVE_FILTER);
  const d = controller.computedMovement();
  const wasGrounded = m.grounded;
  m.grounded = controller.computedGrounded();
  const t = m.body.translation();
  m.body.setNextKinematicTranslation({ x: t.x + d.x, y: t.y + d.y, z: t.z + d.z });
  // 벽에 막힌 만큼 속도를 줄인다 (벽에 대고 제자리 달리기 애니메이션 방지)
  m.vx = d.x / DT;
  m.vz = d.z / DT;
  let landedAir = 0;
  if (m.grounded) {
    if (!wasGrounded && m.airTicks > 0) landedAir = m.airTicks;
    m.airTicks = 0;
  } else m.airTicks++;
  return landedAir;
}
