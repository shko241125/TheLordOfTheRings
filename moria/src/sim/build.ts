import type { Solid, Vec3 } from './level';

/**
 * 구역 도형 빌더 (구역 1에서 떼어 냄 — 구역마다 같은 규칙으로 방을 만든다).
 * 방의 벽·바닥·천장은 모두 방 경계 안에 만든다 → 렌더가 방 단위로 숨겨도 이웃 방에 구멍이 없다.
 */
const T = 0.5; // 벽 두께

export type Side = 'n' | 's' | 'e' | 'w';
/** 벽 구멍: side 벽에서 가로 중심 c, 폭 w, 세로 절대 높이 y0..y1 */
export type Opening = { side: Side; c: number; w: number; y0: number; y1: number };

/** 방 하나의 바닥·천장·네 벽 (구멍 제외). ceiling=false면 하늘이 뚫린 바깥 */
export function room(min: Vec3, max: Vec3, openings: Opening[] = [], ceiling = true): Solid[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const out: Solid[] = [
    { kind: 'box', pos: [(x0 + x1) / 2, y0 - 0.5, (z0 + z1) / 2], half: [(x1 - x0) / 2, 0.5, (z1 - z0) / 2], surface: 'floor' },
  ];
  if (ceiling) out.push({ kind: 'box', pos: [(x0 + x1) / 2, y1 + 0.5, (z0 + z1) / 2], half: [(x1 - x0) / 2, 0.5, (z1 - z0) / 2], surface: 'ceiling' });

  // 벽 하나 = 가로축(a) 구간 [a0, a1], 두께 방향 위치 fixed. 구멍마다 좌우로 자르고, 구멍 위·아래를 채운다
  const wall = (side: Side) => {
    const alongX = side === 'n' || side === 's';
    const a0 = alongX ? x0 : z0;
    const a1 = alongX ? x1 : z1;
    const fixed = side === 'n' ? z0 + T / 2 : side === 's' ? z1 - T / 2 : side === 'w' ? x0 + T / 2 : x1 - T / 2;
    const piece = (b0: number, b1: number, h0: number, h1: number) => {
      if (b1 - b0 <= 1e-6 || h1 - h0 <= 1e-6) return;
      const mid = (b0 + b1) / 2;
      const hy = (h1 - h0) / 2;
      out.push(
        alongX
          ? { kind: 'box', pos: [mid, h0 + hy, fixed], half: [(b1 - b0) / 2, hy, T / 2], surface: 'wall' }
          : { kind: 'box', pos: [fixed, h0 + hy, mid], half: [T / 2, hy, (b1 - b0) / 2], surface: 'wall' },
      );
    };
    const holes = openings.filter((o) => o.side === side).sort((p, q) => p.c - q.c);
    let cursor = a0;
    for (const o of holes) {
      piece(cursor, o.c - o.w / 2, y0, y1);
      piece(o.c - o.w / 2, o.c + o.w / 2, y0, o.y0); // 구멍 아래 (높이가 다른 방으로 이어질 때)
      piece(o.c - o.w / 2, o.c + o.w / 2, o.y1, y1); // 구멍 위 (상인방)
      cursor = o.c + o.w / 2;
    }
    piece(cursor, a1, y0, y1);
  };
  (['n', 's', 'e', 'w'] as const).forEach(wall);
  return out;
}

/** 거대 계단: 20단 × 0.2m = 4m, 단 깊이 0.45m. 남쪽(z0)에서 북쪽으로 오른다. 이어서 윗단(층계참) */
export function greatStairs(zStart: number, zLanding: number, halfW: number): Solid[] {
  const out: Solid[] = [];
  const rise = 0.2;
  const depth = 0.45;
  for (let i = 0; i < 20; i++) {
    const top = rise * (i + 1);
    out.push({ kind: 'box', pos: [0, top / 2, zStart - i * depth - depth / 2], half: [halfW, top / 2, depth / 2], surface: 'stone' });
  }
  const zEnd = zStart - 20 * depth;
  out.push({ kind: 'box', pos: [0, 2, (zEnd + zLanding) / 2], half: [halfW, 2, (zEnd - zLanding) / 2], surface: 'stone' });
  return out;
}

export const pillar = (x: number, z: number, y0: number, h: number, r = 0.9): Solid => ({ kind: 'cylinder', pos: [x, y0 + h / 2, z], radius: r, halfHeight: h / 2, surface: 'stone' });
/** 화로 받침 (돌 원기둥 0.9m) — 그릇·불은 렌더가 위에 얹는다 */
export const pedestal = ([x, y, z]: Vec3): Solid => ({ kind: 'cylinder', pos: [x, y + 0.45, z], radius: 0.45, halfHeight: 0.45, surface: 'stone' });

