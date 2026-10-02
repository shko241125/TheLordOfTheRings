import { pedestal, pillar, room } from './build';
import type { EnemySpawn, Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 2 — 21번째 홀 (계획서 7장 구역 표 2번: 거대 기둥 홀, 등불 네트워크 점등).
 * 동선: 동쪽 층계(구역 1 북쪽 통로에서 이어짐, 화로) → 21번째 홀(기둥 16개, 등불 3개) → 북문(등불 셋을 밝히면 열린다) → 동문 가는 길 → 구역 3 마자르불의 방.
 * 등불은 넓은 빛(반경 16m)이다 — 밝힐수록 무리가 설 어둠이 줄어든다. 대신 밝힌 곳은 빛의 도박 보너스도 없다.
 * M3-C2에서 고블린 궁수와 고블린 대장(보스)이 더해진다.
 */
const STAIR: Room = { name: '동쪽 층계', min: [-3, 0, 0], max: [3, 8, 18] };
const HALL: Room = { name: '21번째 홀', min: [-24, 0, -60], max: [24, 18, 0] };
const NORTH: Room = { name: '동문 가는 길', min: [-4, 0, -78], max: [4, 8, -60] };

const LAMPS: Vec3[] = [
  [-19, 0, -30],
  [19, 0, -30],
  [0, 0, -54],
];
const BRAZIERS: Vec3[] = [[1.4, 0, 7]];

const GATE_W = 6;
const solids: Solid[] = [
  ...room(STAIR.min, STAIR.max, [{ side: 'n', c: 0, w: 5, y0: 0, y1: 5 }]),
  ...room(HALL.min, HALL.max, [
    { side: 's', c: 0, w: 5, y0: 0, y1: 5 },
    { side: 'n', c: 0, w: GATE_W, y0: 0, y1: 6 },
  ]),
  ...room(NORTH.min, NORTH.max, [{ side: 's', c: 0, w: GATE_W, y0: 0, y1: 6 }]),
  // 기둥 16개 (4 × 4) — 가운데 길(x = 0)은 비워 둔다
  ...[-16, -8, 8, 16].flatMap((x) => [-10, -22, -34, -46].map((z) => pillar(x, z, 0, 18, 1.4))),
  ...BRAZIERS.map(pedestal),
  // 등불 받침 (크고 높다)
  ...LAMPS.map(([x, y, z]): Solid => ({ kind: 'cylinder', pos: [x, y + 0.6, z], radius: 0.8, halfHeight: 0.6, surface: 'stone' })),
];

const portals: Portal[] = [
  { a: 0, b: 1, min: [-2.5, 0, -0.5], max: [2.5, 5, 0.5] },
  { a: 1, b: 2, min: [-GATE_W / 2, 0, -60.5], max: [GATE_W / 2, 6, -59.5] },
];

const enemies: EnemySpawn[] = [
  // 기둥 사이를 도는 무리 8
  { pos: [-12, 1, -8], patrol: [[-12, 1, -8], [-12, 1, -28], [-4, 1, -28]] },
  { pos: [12, 1, -8], patrol: [[12, 1, -8], [12, 1, -28], [4, 1, -28]] },
  { pos: [-20, 1, -16], patrol: [[-20, 1, -16], [-20, 1, -40]] },
  { pos: [20, 1, -16], patrol: [[20, 1, -16], [20, 1, -40]] },
  { pos: [-4, 1, -40], patrol: [[-4, 1, -40], [-12, 1, -52]] },
  { pos: [4, 1, -40], patrol: [[4, 1, -40], [12, 1, -52]] },
  { pos: [-10, 1, -52], patrol: [[-10, 1, -52], [-4, 1, -56]] },
  { pos: [10, 1, -52], patrol: [[10, 1, -52], [4, 1, -56]] },
  // 궁수 넷: 홀 양쪽 벽을 따라 — 기둥이 엄폐물이다
  { kind: 'archer', pos: [-22, 1, -18], patrol: [[-22, 1, -18], [-22, 1, -26]] },
  { kind: 'archer', pos: [22, 1, -18], patrol: [[22, 1, -18], [22, 1, -26]] },
  { kind: 'archer', pos: [-22, 1, -42], patrol: [[-22, 1, -42], [-22, 1, -50]] },
  { kind: 'archer', pos: [22, 1, -42], patrol: [[22, 1, -42], [22, 1, -50]] },
];

export const ZONE2: Level = {
  id: 'zone2',
  solids,
  // 횃불은 입구 쪽에만 — 홀 안쪽은 등불을 밝혀야 밝아진다
  torches: [
    [-1.9, 2.6, 12], [1.9, 2.6, 3],
    [-8, 2.6, -1.1], [8, 2.6, -1.1],
  ],
  spawn: [0, 1.2, 14],
  enemies,
  spawnPoints: [[-21, 1, -3], [21, 1, -3], [-21, 1, -57], [21, 1, -57], [-12, 1, -40], [12, 1, -40]],
  rooms: [STAIR, HALL, NORTH],
  portals,
  // 북문: 등불 셋을 밝히면 열린다 (비문이 아니다)
  doors: [{ pos: [0, 3, -60], half: [GATE_W / 2, 3, 0.5], style: 'gate' }],
  lampDoors: [0],
  lamps: LAMPS,
  braziers: BRAZIERS,
  horde: { size: 60 },
  // 고블린 대장: 북문 앞을 지킨다
  bosses: [{ kind: 'captain', pos: [0, 1.4, -55] }],
  // 상인 노리: 동쪽 층계 화로 곁 (계획서 8장 — 등불마다 상인)
  npcs: [{ kind: 'merchant', name: '상인 노리', pos: [-1.8, 0, 9], facing: 3072 }],
  // 사이드: 책 조각 둘 (홀 북서 구석, 동문 가는 길)
  pages: [{ id: 8, pos: [-22.5, 0, -58.5] }, { id: 9, pos: [2.5, 0, -72] }],
  entries: { south: { pos: [0, 1.2, 14], facing: 0 }, north: { pos: [0, 1.2, -70], facing: 2048 } },
  exits: [
    // 남쪽 끝 → 구역 1 트롤 굴 북쪽 통로
    { min: [-3, -1, 16.5], max: [3, 6, 18], to: 'zone1', entry: 'north' },
    // 북쪽 끝 → 구역 3 마자르불의 방
    { min: [-4, -1, -78], max: [4, 6, -75], to: 'zone3', entry: 'south', requires: ['lamps', 'bosses'], locked: '아직 갈 수 없다 — 등불 셋을 밝히고 고블린 대장을 쓰러뜨려라' },
  ],
};
