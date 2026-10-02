import { pedestal, pillar, room } from './build';
import type { EnemySpawn, Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 3 — 마자르불의 방 (계획서 7장 구역 표 3번: 발린의 무덤, 방어전 웨이브, 우루크, 마자르불의 책 조각).
 * 동선: 남쪽 통로(21번째 홀 북문에서 이어짐, 화로) → 마자르불의 방(가운데 발린의 무덤, 양옆에 고블린 굴) → 북쪽 쇠문(방어전을 끝내면 열린다).
 * 무덤에서 E → 방어전 3물결이 양옆 굴에서 쏟아진다. 굴 입구마다 금 간 기둥 — 무너뜨리면 그쪽 굴이 막혀 한쪽만 지키면 된다.
 */
const SOUTH: Room = { name: '남쪽 통로', min: [-3, 0, 0], max: [3, 8, 16] };
const CHAMBER: Room = { name: '마자르불의 방', min: [-14, 0, -28], max: [14, 10, 0] };
const WEST: Room = { name: '서쪽 굴', min: [-26, 0, -15.5], max: [-14, 5, -12.5] };
const EAST: Room = { name: '동쪽 굴', min: [14, 0, -15.5], max: [26, 5, -12.5] };
const NORTH: Room = { name: '북쪽 쇠문 너머', min: [-3, 0, -46], max: [3, 8, -28] };

const GATE_W = 5;
const BRAZIERS: Vec3[] = [
  [1.4, 0, 6], // 0 남쪽 통로
  [1.4, 0, -38], // 1 쇠문 너머 (방어전 뒤)
];
const TOMB: Vec3 = [0, 0, -14];

const solids: Solid[] = [
  ...room(SOUTH.min, SOUTH.max, [{ side: 'n', c: 0, w: 4, y0: 0, y1: 5 }]),
  ...room(CHAMBER.min, CHAMBER.max, [
    { side: 's', c: 0, w: 4, y0: 0, y1: 5 },
    { side: 'n', c: 0, w: GATE_W, y0: 0, y1: 6 },
    { side: 'w', c: -14, w: 3, y0: 0, y1: 4 },
    { side: 'e', c: -14, w: 3, y0: 0, y1: 4 },
  ]),
  ...room(WEST.min, WEST.max, [{ side: 'e', c: -14, w: 3, y0: 0, y1: 4 }]),
  ...room(EAST.min, EAST.max, [{ side: 'w', c: -14, w: 3, y0: 0, y1: 4 }]),
  ...room(NORTH.min, NORTH.max, [{ side: 's', c: 0, w: GATE_W, y0: 0, y1: 6 }]),
  ...[-7, 7].flatMap((x) => [pillar(x, -6, 0, 10), pillar(x, -22, 0, 10)]),
  // 발린의 무덤: 흰 돌 관 (가로 2m × 세로 3.6m × 높이 1m)
  { kind: 'box', pos: [TOMB[0], 0.5, TOMB[2]], half: [1, 0.5, 1.8], surface: 'stone' },
  ...BRAZIERS.map(pedestal),
];

const portals: Portal[] = [
  { a: 0, b: 1, min: [-2, 0, -0.5], max: [2, 5, 0.5] },
  { a: 1, b: 2, min: [-14.5, 0, -15.5], max: [-13.5, 4, -12.5] },
  { a: 1, b: 3, min: [13.5, 0, -15.5], max: [14.5, 4, -12.5] },
  { a: 1, b: 4, min: [-GATE_W / 2, 0, -28.5], max: [GATE_W / 2, 6, -27.5] },
];

const enemies: EnemySpawn[] = [
  { pos: [-6, 1, -18], patrol: [[-6, 1, -18], [-10, 1, -10]] },
  { pos: [6, 1, -10], patrol: [[6, 1, -10], [10, 1, -18]] },
  // 무덤을 지키는 우루크 하나 — 방패를 처음 만나는 곳
  { kind: 'uruk', pos: [0, 1.2, -20], patrol: [[0, 1.2, -20], [-3, 1.2, -24], [3, 1.2, -24]] },
];

export const ZONE3: Level = {
  id: 'zone3',
  solids,
  torches: [
    [-1.9, 2.6, 12], [1.9, 2.6, 3],
    // 방은 어둡다: 네 구석의 횃불만
    [-12.9, 2.6, -4], [12.9, 2.6, -4], [-12.9, 2.6, -24], [12.9, 2.6, -24],
    [-1.9, 2.6, -36],
  ],
  spawn: [0, 1.2, 13],
  enemies,
  spawnPoints: [[-24, 1, -14], [24, 1, -14], [-11, 1, -25], [11, 1, -25]],
  rooms: [SOUTH, CHAMBER, WEST, EAST, NORTH],
  portals,
  // 북쪽 쇠문: 방어전을 끝내면 열린다
  doors: [{ pos: [0, 3, -28], half: [GATE_W / 2, 3, 0.5], style: 'gate' }],
  braziers: BRAZIERS,
  horde: { size: 40 },
  // 금 간 기둥: 굴 입구 앞(방 안)에서 북쪽으로 쓰러져 입구를 덮는다. 굴 안쪽을 봉쇄
  collapses: [
    { pos: [-12.7, 0, -10.2], radius: 0.7, height: 8, dir: [0, -1], hp: 50, seals: [-26, -1, -15.5, -14.2, 5, -12.5] },
    { pos: [12.7, 0, -10.2], radius: 0.7, height: 8, dir: [0, -1], hp: 50, seals: [14.2, -1, -15.5, 26, 5, -12.5] },
  ],
  defense: {
    at: TOMB,
    spawns: [[-24, 1, -14], [24, 1, -14]],
    waves: [
      { goblins: 5, archers: 0, uruks: 0, horde: 24 },
      { goblins: 3, archers: 2, uruks: 1, horde: 30 },
      { goblins: 2, archers: 2, uruks: 3, horde: 40 },
    ],
    doors: [0],
  },
  pages: [
    { id: 0, pos: [-11, 0, -25] },
    { id: 1, pos: [11, 0, -3] },
    { id: 2, pos: [-1.6, 0, -34] },
  ],
  entries: { south: { pos: [0, 1.2, 13], facing: 0 } },
  exits: [
    { min: [-3, -1, 14.5], max: [3, 6, 16], to: 'zone2', entry: 'north' },
    { min: [-3, -1, -46], max: [3, 6, -43], to: 'end', entry: 'end', requires: ['defense'], locked: '아직 갈 수 없다 — 마자르불의 방을 지켜 내라' },
  ],
};
