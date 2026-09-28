import RAPIER from '@dimforge/rapier3d-compat';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three/webgpu';

const ARM_LENGTH = 3.6;
const SHOULDER = 0.45; // 오른쪽 어깨 너머 시점 (왼손 횃불이 화면 중앙을 가리지 않는다)
const PROBE_RADIUS = 0.22; // 구체 캐스트 반지름 — 가는 레이는 모서리에서 벽 속을 비춘다
const FOV_BASE = 62;
const FOV_SPRINT = 70;

/**
 * 3인칭 추적 카메라.
 *  - 추적점은 캐릭터를 스프링처럼 따라간다 (수평은 빠르게, 수직은 느리게 → 계단에서 화면이 덜컹이지 않는다)
 *  - 뒤쪽으로 구체를 쏴서(sphere cast) 벽에 걸리면 즉시 당기고, 풀릴 때는 천천히 돌아간다
 *  - 질주하면 시야각을 넓혀 속도감을 준다
 * 물리 월드는 쿼리만 하므로 시뮬레이션 결정성에 영향이 없다.
 */
export function createFollowCamera() {
  const camera = new PerspectiveCamera(FOV_BASE, window.innerWidth / window.innerHeight, 0.05, 120);
  const dir = new Vector3();
  const right = new Vector3();
  const pivot = new Vector3();
  const follow = new Vector3();
  let initialized = false;
  let arm = ARM_LENGTH;
  const ball = new RAPIER.Ball(PROBE_RADIUS);
  const rot = { x: 0, y: 0, z: 0, w: 1 };

  return {
    camera,
    /** 현재 팔 길이 (m) — 벽에 걸리면 짧아진다 */
    get arm() {
      return arm;
    },
    armMax: ARM_LENGTH,
    update(
      dt: number,
      target: Vector3,
      yaw: number,
      pitch: number,
      sprintAmount: number,
      world: RAPIER.World,
      exclude: RAPIER.Collider,
    ) {
      if (!initialized) {
        follow.copy(target);
        initialized = true;
      }
      // 프레임률과 무관한 지수 감쇠
      const kxz = 1 - Math.exp(-16 * dt);
      const ky = 1 - Math.exp(-7 * dt);
      follow.x += (target.x - follow.x) * kxz;
      follow.z += (target.z - follow.z) * kxz;
      follow.y += (target.y - follow.y) * ky;

      dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
      right.set(Math.cos(yaw), 0, -Math.sin(yaw));
      pivot.copy(follow).addScaledVector(right, SHOULDER);

      // 주의: 레이 결과는 timeOfImpact, 셰이프 캐스트 결과는 time_of_impact (Rapier 0.21 타입 정의 확인)
      const hit = world.castShape(
        { x: pivot.x, y: pivot.y, z: pivot.z }, rot,
        { x: -dir.x, y: -dir.y, z: -dir.z }, ball,
        0, ARM_LENGTH, true, undefined, undefined, exclude,
      );
      const want = hit ? Math.max(0.35, hit.time_of_impact) : ARM_LENGTH;
      arm = want < arm ? want : arm + (want - arm) * (1 - Math.exp(-3 * dt));

      camera.position.copy(pivot).addScaledVector(dir, -arm);
      camera.lookAt(pivot.x + dir.x, pivot.y + dir.y, pivot.z + dir.z);

      const fov = MathUtils.lerp(FOV_BASE, FOV_SPRINT, sprintAmount);
      if (Math.abs(fov - camera.fov) > 0.01) {
        camera.fov += (fov - camera.fov) * (1 - Math.exp(-5 * dt));
        camera.updateProjectionMatrix();
      }
    },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    },
  };
}
