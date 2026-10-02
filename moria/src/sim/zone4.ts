import { pedestal, room } from './build';
import type { EnemySpawn, Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 4 — 대장간과 깊은 탄갱 (계획서 7장 구역 표 4번: 용암 강, 압력 발판 퍼즐, 드워프 모루 재가동, 우루크 대장).
 * 동선: 남쪽 통로(화로) → 두린의 대장간(가운데를 용암 강이 동서로 가른다, 돌다리 둘) → 모루와 발판 셋 → 북쪽 쇠문(모루가 타오르면 열린다) → 구역 5 크하잣둠의 다리.
 * 대장간 바닥은 높이 0의 돌 단 두 개와 다리이고, 그 사이 3m 아래가 용암이다 — 떨어지면 끝.
 * 발판 셋을 '한꺼번에' 눌러야 한다: 횃불 둘을 내려놓고 마지막 발판에 선다 (빛을 내려놓아야 길이 열린다).
 * 우루크 대장(고블린 대장의 돌진·휘파람)은 모루 앞을 지킨다 — 돌진을 용암 쪽으로 피하면 대장이 빠진다.
 */
const SOUTH: Room = { name: '남쪽 통로', min: [-3, 0, 0], max: [3, 8, 14] };
const FORGE: Room = { name: '두린의 대장간', min: [-18, -3, -40], max: [18, 14, 0] };
const NORTH: Room = { name: '깊은 탄갱 입구', min: [-3, 0, -58], max: [3, 8, -40] };

const GATE_W = 5;
const BRAZIERS: Vec3[] = [
  [1.4, 0, 5], // 0 남쪽 통로
  [-6, 0, -38], // 1 모루 뒤 (쇠문 앞)
];
const ANVIL: Vec3 = [0, 0, -29];
const PLATES: Vec3[] = [[-12, 0, -30], [12, 0, -30], [0, 0, -34]];
// 용암 강: z −22..−16, 바닥(−3) 위 2m까지 — 발이 −1 아래로 내려가면 끝
const LAVA_Z0 = -22;
const LAVA_Z1 = -16;

const solids: Solid[] = [
  ...room(SOUTH.min, SOUTH.max, [{ side: 'n', c: 0, w: 4, y0: 0, y1: 5 }]),
  ...room(FORGE.min, FORGE.max, [
    { side: 's', c: 0, w: 4, y0: 0, y1: 5 },
    { side: 'n', c: 0, w: GATE_W, y0: 0, y1: 6 },
  ]),
  ...room(NORTH.min, NORTH.max, [{ side: 's', c: 0, w: GATE_W, y0: 0, y1: 6 }]),
  // 돌 단: 남쪽(z −16..0)과 북쪽(z −40..−22), 윗면 높이 0
  { kind: 'box', pos: [0, -1.5, -8], half: [18, 1.5, 8], surface: 'stone' },
  { kind: 'box', pos: [0, -1.5, -31], half: [18, 1.5, 9], surface: 'stone' },
  // 돌다리 둘 (폭 3m)
  ...[-8, 8].map((x): Solid => ({ kind: 'box', pos: [x, -1.5, (LAVA_Z0 + LAVA_Z1) / 2], half: [1.5, 1.5, (LAVA_Z1 - LAVA_Z0) / 2], surface: 'stone' })),
  // 모루 (드워프 대장간의 큰 모루)
  { kind: 'box', pos: [ANVIL[0], 0.5, ANVIL[2]], half: [0.9, 0.5, 0.5], surface: 'stone' },
  ...BRAZIERS.map(pedestal),
];

const portals: Portal[] = [
  { a: 0, b: 1, min: [-2, 0, -0.5], max: [2, 5, 0.5] },
  { a: 1, b: 2, min: [-GATE_W / 2, 0, -40.5], max: [GATE_W / 2, 6, -39.5] },
];

const enemies: EnemySpawn[] = [
  // 남쪽 단: 다리 앞을 지키는 고블린 셋
  { pos: [-10, 1, -6], patrol: [[-10, 1, -6], [-8, 1, -13]] },
  { pos: [10, 1, -10], patrol: [[10, 1, -10], [8, 1, -13]] },
  { pos: [0, 1, -12], patrol: [[0, 1, -12], [0, 1, -4]] },
  // 북쪽 단: 용암 너머에서 쏘는 궁수 둘, 모루를 지키는 우루크 둘
  { kind: 'archer', pos: [-15, 1, -25], patrol: [[-15, 1, -25], [-15, 1, -32]] },
  { kind: 'archer', pos: [15, 1, -25], patrol: [[15, 1, -25], [15, 1, -32]] },
  { kind: 'uruk', pos: [-5, 1.2, -32], patrol: [[-5, 1.2, -32], [-9, 1.2, -36]] },
  { kind: 'uruk', pos: [5, 1.2, -32], patrol: [[5, 1.2, -32], [9, 1.2, -36]] },
];

export const ZONE4: Level = {
  id: 'zone4',
  solids,
  torches: [
    [-1.9, 2.6, 10], [1.9, 2.6, 2],
    [-17.4, 2.6, -6], [17.4, 2.6, -6], [-17.4, 2.6, -34], [17.4, 2.6, -34],
    [-1.9, 2.6, -50],
  ],
  spawn: [0, 1.2, 10],
  enemies,
  spawnPoints: [[-16, 1, -3], [16, 1, -3], [-16, 1, -38], [16, 1, -38]],
  rooms: [SOUTH, FORGE, NORTH],
  portals,
  doors: [{ pos: [0, 3, -40], half: [GATE_W / 2, 3, 0.5], style: 'gate' }],
  braziers: BRAZIERS,
  horde: { size: 50 },
  bosses: [{ kind: 'captain', pos: [0, 1.4, -37], name: '우루크 대장' }],
  lava: [{ min: [-18, -3.5, LAVA_Z0], max: [18, -1, LAVA_Z1] }],
  forge: { anvil: ANVIL, plates: PLATES, doors: [0] },
  pages: [
    { id: 3, pos: [-16, 0, -3] },
    { id: 4, pos: [16, 0, -37] },
  ],
  entries: { south: { pos: [0, 1.2, 10], facing: 0 }, north: { pos: [-0.8, 1.2, -50], facing: 2048 } },
  exits: [
    { min: [-3, -1, 12.5], max: [3, 6, 14], to: 'zone3', entry: 'north' },
    { min: [-3, -1, -58], max: [3, 6, -55], to: 'zone5', entry: 'south', requires: ['forge', 'bosses'], locked: '아직 갈 수 없다 — 모루를 다시 지피고 우루크 대장을 쓰러뜨려라' },
  ],
};
