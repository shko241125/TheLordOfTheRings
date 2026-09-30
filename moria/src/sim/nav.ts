import { DEFAULT_QUERY_FILTER, findPath, type NavMesh, type QueryFilter } from 'navcat';
import { generateSoloNavMesh } from 'navcat/blocks';
import { dcos, dsin } from '../core/trig';
import type { Level } from './level';

/**
 * 내비메시 (navcat). 레벨 도형을 삼각형으로 풀어 한 번 굽고, 적은 findPath로 경로를 받는다.
 *
 * 결정성 메모 (navcat 0.4.1 소스 확인):
 *  - findPath / findNearestPoly / findStraightPath 는 삼각함수를 쓰지 않는다 → 시뮬레이션에서 사용 가능
 *  - crowd(blocks)의 속도 샘플링은 Math.sin/cos를 쓴다 → 엔진마다 결과가 달라질 수 있어 사용하지 않는다.
 *    군중 회피는 sim/enemy.ts의 결정적 조향으로 대신한다.
 *  - 생성 단계의 경사 임계값(Math.cos(45°))은 이 레벨 경사(0°, 20°, 90°)와 멀어 결과에 영향이 없다.
 */

/** 적(고블린) 기준 크기. 플레이어보다 작다. */
const AGENT_RADIUS = 0.35;
const AGENT_HEIGHT = 1.4;
const AGENT_CLIMB = 0.35;
const CELL = 0.12;
const CELL_H = 0.1;

function levelTriangles(level: Level) {
  const pos: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number) => pos.push(x, y, z) / 3 - 1;
  for (const s of level.solids) {
    if (s.kind === 'box') {
      const [hx, hy, hz] = s.half;
      const q = s.rot ?? [0, 0, 0, 1];
      // 쿼터니언 회전 (기본 연산만)
      const rot = (x: number, y: number, z: number): [number, number, number] => {
        const [qx, qy, qz, qw] = q;
        const ix = qw * x + qy * z - qz * y;
        const iy = qw * y + qz * x - qx * z;
        const iz = qw * z + qx * y - qy * x;
        const iw = -qx * x - qy * y - qz * z;
        return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
      };
      const v: number[] = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        const [x, y, z] = rot(sx * hx, sy * hy, sz * hz);
        v.push(push(s.pos[0] + x, s.pos[1] + y, s.pos[2] + z));
      }
      // 꼭짓점 번호: (sx,sy,sz) → 4·(sx>0) + 2·(sy>0) + (sz>0). 면은 바깥에서 봤을 때 반시계
      const faces = [
        [2, 3, 7, 6], // +Y (윗면: 걸을 수 있는 면)
        [0, 4, 5, 1], // −Y
        [4, 6, 7, 5], // +X
        [0, 1, 3, 2], // −X
        [1, 5, 7, 3], // +Z
        [0, 2, 6, 4], // −Z
      ];
      for (const [a, b, c, d] of faces) idx.push(v[a!]!, v[b!]!, v[c!]!, v[a!]!, v[c!]!, v[d!]!);
    } else {
      // 원기둥 → 16각기둥. 꼭짓점 각도는 결정적 삼각표로.
      const n = 16;
      const top: number[] = [];
      const bot: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = (i * 4096) / n;
        const x = s.pos[0] + dcos(a) * s.radius;
        const z = s.pos[2] + dsin(a) * s.radius;
        top.push(push(x, s.pos[1] + s.halfHeight, z));
        bot.push(push(x, s.pos[1] - s.halfHeight, z));
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(bot[i]!, top[i]!, top[j]!, bot[i]!, top[j]!, bot[j]!);
        if (i > 0 && i < n - 1) idx.push(top[0]!, top[j]!, top[i]!);
      }
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

export function buildNavMesh(level: Level): NavMesh {
  const input = levelTriangles(level);
  const r = generateSoloNavMesh(input, {
    cellSize: CELL,
    cellHeight: CELL_H,
    walkableRadiusWorld: AGENT_RADIUS,
    walkableRadiusVoxels: Math.ceil(AGENT_RADIUS / CELL),
    walkableClimbWorld: AGENT_CLIMB,
    walkableClimbVoxels: Math.ceil(AGENT_CLIMB / CELL_H),
    walkableHeightWorld: AGENT_HEIGHT,
    walkableHeightVoxels: Math.ceil(AGENT_HEIGHT / CELL_H),
    walkableSlopeAngleDegrees: 45,
    borderSize: 0,
    minRegionArea: 8,
    mergeRegionArea: 20,
    maxSimplificationError: 1.3,
    maxEdgeLength: 12,
    maxVerticesPerPoly: 5,
    detailSampleDistance: CELL * 6,
    detailSampleMaxError: CELL_H,
  });
  return r.navMesh;
}

const HALF_EXTENTS: [number, number, number] = [1, 2, 1];

/** 경로 꼭짓점 목록 (시작점 제외). 실패하면 빈 배열. */
export function pathTo(
  nav: NavMesh, from: readonly [number, number, number], to: readonly [number, number, number], filter: QueryFilter = DEFAULT_QUERY_FILTER,
): [number, number, number][] {
  const r = findPath(nav, [from[0], from[1], from[2]], [to[0], to[1], to[2]], HALF_EXTENTS, filter);
  if (!r.success) return [];
  return r.path.slice(1).map((p) => [p.position[0], p.position[1], p.position[2]]);
}
