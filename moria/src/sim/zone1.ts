import { greatStairs, pedestal, pillar, room } from './build';
import type { EnemySpawn, Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 1 — 서문과 거대 계단 (계획서 7장 구역 표 1번 + M2 수직 슬라이스).
 * 동선: 서문 밖(두린의 문) → 입구 홀(화로 0) → 거대 계단(4m 오름) → 기둥 홀(척후 고블린, 화로 1·2) → 트롤 굴.
 * 좌표: −Z가 안쪽(북). 방의 벽·바닥·천장은 전부 방 경계 안에 만든다 → 렌더가 방 단위로 숨겨도 이웃 방에 구멍이 없다.
 */

// --- 방 경계 ---
const OUTSIDE: Room = { name: '서문 밖', min: [-12, 0, 40], max: [12, 20, 56] };
const HALL: Room = { name: '입구 홀', min: [-10, 0, 24], max: [10, 8, 40] };
const STAIRS: Room = { name: '거대 계단', min: [-3, 0, 4], max: [3, 9, 24] };
const PILLARS: Room = { name: '기둥 홀', min: [-16, 4, -26], max: [16, 14, 4] };
const TROLL: Room = { name: '트롤 굴', min: [-12, 4, -50], max: [12, 16, -26] };
// 기둥 홀 양옆의 고블린 굴 (폭 3m, 안쪽 2m) — 물결이 나오는 곳. 입구마다 금 간 기둥이 있다
// 트롤 굴 북쪽 통로 → 구역 2 (21번째 홀). 트롤을 쓰러뜨려야 지나갈 수 있다
const NORTH: Room = { name: '북쪽 통로', min: [-3, 4, -66], max: [3, 10, -50] };
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
  { a: 4, b: 7, min: [-2, 4, -50.5], max: [2, 8, -49.5] },
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
  ...room(TROLL.min, TROLL.max, [
    { side: 's', c: 0, w: 4, y0: 4, y1: 8 },
    { side: 'n', c: 0, w: 4, y0: 4, y1: 8 },
  ]),
  ...room(NORTH.min, NORTH.max, [{ side: 's', c: 0, w: 4, y0: 4, y1: 8 }]),
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
  id: 'zone1',
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
  rooms: [OUTSIDE, HALL, STAIRS, PILLARS, TROLL, WEST, EAST, NORTH],
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
  // 구역 2에서 돌아오면 북쪽 통로에 남쪽(트롤 굴 쪽)을 보고 선다
  // 사이드: 책 조각 둘 (입구 홀 동쪽 구석의 드워프 해골 곁, 트롤 굴 북동 구석)
  pages: [{ id: 6, pos: [8.5, 0, 25.5] }, { id: 7, pos: [10.5, 4, -48.5] }],
  entries: { north: { pos: [0, 5.2, -60], facing: 2048 } },
  exits: [{ min: [-3, 3, -66], max: [3, 10, -63.5], to: 'zone2', entry: 'south', requires: ['bosses'], locked: '동굴 트롤이 길을 지키고 있다' }],
  // 절정마다 40마리 물결 (계획서: PC 200 / 모바일 60 — 구역 1은 튜토리얼 강도)
  horde: { size: 40 },
  breakable,
};
