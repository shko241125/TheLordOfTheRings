import type { EnemySpawn, Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 1 — 서문과 거대 계단 (계획서 7장 구역 표 1번 + M2 수직 슬라이스).
 * 동선: 서문 밖(두린의 문) → 입구 홀(화로 0) → 거대 계단(4m 오름) → 기둥 홀(척후 고블린, 화로 1·2) → 트롤 굴.
 * 좌표: −Z가 안쪽(북). 방의 벽·바닥·천장은 전부 방 경계 안에 만든다 → 렌더가 방 단위로 숨겨도 이웃 방에 구멍이 없다.
 */

const T = 0.5; // 벽 두께

type Side = 'n' | 's' | 'e' | 'w';
/** 벽 구멍: side 벽에서 가로 중심 c, 폭 w, 세로 절대 높이 y0..y1 */
type Opening = { side: Side; c: number; w: number; y0: number; y1: number };

/** 방 하나의 바닥·천장·네 벽 (구멍 제외). ceiling=false면 하늘이 뚫린 바깥 */
function room(min: Vec3, max: Vec3, openings: Opening[] = [], ceiling = true): Solid[] {
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
function greatStairs(zStart: number, zLanding: number, halfW: number): Solid[] {
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

const pillar = (x: number, z: number, y0: number, h: number, r = 0.9): Solid => ({ kind: 'cylinder', pos: [x, y0 + h / 2, z], radius: r, halfHeight: h / 2, surface: 'stone' });
/** 화로 받침 (돌 원기둥 0.9m) — 그릇·불은 렌더가 위에 얹는다 */
const pedestal = ([x, y, z]: Vec3): Solid => ({ kind: 'cylinder', pos: [x, y + 0.45, z], radius: 0.45, halfHeight: 0.45, surface: 'stone' });

// --- 방 경계 ---
const OUTSIDE: Room = { name: '서문 밖', min: [-12, 0, 40], max: [12, 20, 56] };
const HALL: Room = { name: '입구 홀', min: [-10, 0, 24], max: [10, 8, 40] };
const STAIRS: Room = { name: '거대 계단', min: [-3, 0, 4], max: [3, 9, 24] };
const PILLARS: Room = { name: '기둥 홀', min: [-16, 4, -26], max: [16, 14, 4] };
const TROLL: Room = { name: '트롤 굴', min: [-12, 4, -50], max: [12, 16, -26] };
// 기둥 홀 양옆의 고블린 굴 (폭 3m, 안쪽 2m) — 물결이 나오는 곳. 입구마다 금 간 기둥이 있다
const WEST: Room = { name: '서쪽 굴', min: [-30, 4, -13.5], max: [-16, 8, -10.5] };
const EAST: Room = { name: '동쪽 굴', min: [16, 4, -13.5], max: [30, 8, -10.5] };

const DOOR_W = 4;
const DOOR_H = 5;

const BRAZIERS: Vec3[] = [
  [-5, 0, 32], // 0 입구 홀
  [6, 4, 0], // 1 기둥 홀 남쪽 (계단을 오르자마자)
  [-6, 4, -22], // 2 트롤 굴 앞
];

const portals: Portal[] = [
  { a: 0, b: 1, min: [-DOOR_W / 2, 0, 39.5], max: [DOOR_W / 2, DOOR_H, 40.5] },
  { a: 1, b: 2, min: [-2.5, 0, 23.5], max: [2.5, 5, 24.5] },
  { a: 2, b: 3, min: [-2.5, 4, 3.5], max: [2.5, 8, 4.5] },
  { a: 3, b: 4, min: [-2, 4, -26.5], max: [2, 8, -25.5] },
  { a: 3, b: 5, min: [-16.5, 4, -13.5], max: [-15, 7, -10.5] },
  { a: 3, b: 6, min: [15, 4, -13.5], max: [16.5, 7, -10.5] },
];

const solids: Solid[] = [
  ...room(OUTSIDE.min, OUTSIDE.max, [{ side: 'n', c: 0, w: DOOR_W, y0: 0, y1: DOOR_H }], false),
  ...room(HALL.min, HALL.max, [
    { side: 's', c: 0, w: DOOR_W, y0: 0, y1: DOOR_H },
    { side: 'n', c: 0, w: 5, y0: 0, y1: 5 },
  ]),
  ...room(STAIRS.min, STAIRS.max, [
    { side: 's', c: 0, w: 5, y0: 0, y1: 5 },
    { side: 'n', c: 0, w: 5, y0: 4, y1: 8 },
  ]),
  ...greatStairs(20, 4, 2.5),
  ...room(PILLARS.min, PILLARS.max, [
    { side: 's', c: 0, w: 5, y0: 4, y1: 8 },
    { side: 'n', c: 0, w: 4, y0: 4, y1: 8 },
    { side: 'w', c: -12, w: 3, y0: 4, y1: 7 },
    { side: 'e', c: -12, w: 3, y0: 4, y1: 7 },
  ]),
  ...room(WEST.min, WEST.max, [{ side: 'e', c: -12, w: 3, y0: 4, y1: 7 }]),
  ...room(EAST.min, EAST.max, [{ side: 'w', c: -12, w: 3, y0: 4, y1: 7 }]),
  ...[-12, -6, 6, 12].flatMap((x) => [pillar(x, -18, 4, 10), pillar(x, -6, 4, 10)]),
  ...room(TROLL.min, TROLL.max, [{ side: 's', c: 0, w: 4, y0: 4, y1: 8 }]),
  ...BRAZIERS.map(pedestal),
];
// 트롤 굴 기둥 4개: 트롤의 내려찍기에 부서진다 (숨을 곳이자 한정된 자원)
const breakable = [-6, 6].flatMap((x) => [-34, -43].map((z) => solids.push(pillar(x, z, 4, 12, 1)) - 1));

const enemies: EnemySpawn[] = [
  // 계단 위 층계참: 첫 전투 (1:1)
  { pos: [0, 5, 7], patrol: [[0, 5, 7], [0, 5, 5]] },
  // 기둥 홀 척후 5
  { pos: [-9, 5, -12], patrol: [[-9, 5, -12], [-9, 5, -22], [-3, 5, -22]] },
  { pos: [9, 5, -12], patrol: [[9, 5, -12], [9, 5, -22], [3, 5, -22]] },
  { pos: [-13, 5, -2], patrol: [[-13, 5, -2], [-13, 5, -12]] },
  { pos: [13, 5, -2], patrol: [[13, 5, -2], [13, 5, -12]] },
  { pos: [0, 5, -14], patrol: [[0, 5, -14], [0, 5, -8]] },
];

export const ZONE1: Level = {
  solids,
  torches: [
    // 입구 홀 (벽 안쪽 면 ±9.5 → 0.6m 안)
    [-8.9, 2.6, 28], [-8.9, 2.6, 36], [8.9, 2.6, 28], [8.9, 2.6, 36],
    // 계단: 중간·층계참
    [-1.9, 4.4, 16], [1.9, 6.6, 7],
    // 기둥 홀: 옆벽 4, 북·남벽 4
    [-14.9, 6.6, -18], [-14.9, 6.6, -6], [14.9, 6.6, -18], [14.9, 6.6, -6],
    [-8, 6.6, -24.9], [8, 6.6, -24.9], [-8, 6.6, 2.9], [8, 6.6, 2.9],
    // 트롤 굴 (트롤은 빛에 끌린다 — 계획서 6장)
    [-10.9, 6.6, -34], [-10.9, 6.6, -44], [10.9, 6.6, -34], [10.9, 6.6, -44],
  ],
  spawn: [0, 1.2, 50],
  enemies,
  // 디렉터 물결 자리: 두 고블린 굴 안쪽 끝(먼저 고른다 — 금 간 기둥 옆), 기둥 홀 남쪽 구석, 트롤 굴 안쪽
  spawnPoints: [
    [-27, 5, -12], [27, 5, -12], [-13, 5, 1], [13, 5, 1], [-8, 5, -48], [8, 5, -48],
  ],
  rooms: [OUTSIDE, HALL, STAIRS, PILLARS, TROLL, WEST, EAST],
  // 금 간 기둥: 굴 입구 앞에서 북쪽(−Z)으로 쓰러져 입구를 막는다. 굴 안쪽을 봉쇄 — 주 동선(x = 0)과 무관
  collapses: [
    { pos: [-14.7, 4, -8.2], radius: 0.7, height: 8, dir: [0, -1], hp: 50, seals: [-30, 3, -13.5, -16.2, 9, -10.5] },
    { pos: [14.7, 4, -8.2], radius: 0.7, height: 8, dir: [0, -1], hp: 50, seals: [16.2, 3, -13.5, 30, 9, -10.5] },
  ],
  portals,
  // 두린의 문: 서문 밖 북벽과 입구 홀 남벽의 구멍(두께 1m)을 막는다
  doors: [{ pos: [0, DOOR_H / 2, 40], half: [DOOR_W / 2, DOOR_H / 2, 0.5] }],
  braziers: BRAZIERS,
  // 동굴 트롤: 굴 안쪽에서 잠들어 있다
  bosses: [{ kind: 'troll', pos: [0, 6, -45] }],
  // 절정마다 40마리 물결 (계획서: PC 200 / 모바일 60 — 구역 1은 튜토리얼 강도)
  horde: { size: 40 },
  breakable,
};
