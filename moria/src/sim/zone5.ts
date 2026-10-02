import { pedestal, room } from './build';
import type { Level, Portal, Room, Solid, Vec3 } from './level';

/**
 * 구역 5 — 크하잣둠의 다리 (계획서 7장 구역 표 5번: 불길 추격 + 다리 위 결전, 발로그).
 * 동선: 남쪽 통로(화로) → 두 번째 홀(들어서면 뒤에서 불의 벽 — 1페이즈 추격) → 다리 서쪽 단(발로그가 불 속에서 나온다)
 *       → 폭 2.4m, 난간 없는 다리(아래는 불의 심연) → 동쪽 단 → 동문 (끝).
 * 사이드 퀘스트 없음 (계획서: 클라이맥스 몰입). 적은 발로그 하나.
 */
const SOUTH: Room = { name: '남쪽 통로', min: [-3, 0, 0], max: [3, 8, 12] };
const HALL: Room = { name: '두 번째 홀', min: [-6, 0, -70], max: [6, 12, 0] };
const CHASM: Room = { name: '크하잣둠의 다리', min: [-16, -34, -122], max: [16, 20, -70] };
const EAST: Room = { name: '동문 가는 길', min: [-2, 0, -134], max: [2, 6, -122] };

const BRAZIERS: Vec3[] = [[1.4, 0, 5]];

const solids: Solid[] = [
  ...room(SOUTH.min, SOUTH.max, [{ side: 'n', c: 0, w: 4, y0: 0, y1: 5 }]),
  ...room(HALL.min, HALL.max, [
    { side: 's', c: 0, w: 4, y0: 0, y1: 5 },
    { side: 'n', c: 0, w: 8, y0: 0, y1: 9 },
  ]),
  ...room(CHASM.min, CHASM.max, [
    { side: 's', c: 0, w: 8, y0: 0, y1: 9 },
    { side: 'n', c: 0, w: 3, y0: 0, y1: 5 },
  ]),
  ...room(EAST.min, EAST.max, [{ side: 's', c: 0, w: 3, y0: 0, y1: 5 }]),
  // 서쪽 단 (발로그가 선다): z −78..−70, 윗면 0
  { kind: 'box', pos: [0, -1, -74], half: [7, 1, 4], surface: 'stone' },
  // 다리: 폭 2.4m, z −112..−78
  { kind: 'box', pos: [0, -0.5, -95], half: [1.2, 0.5, 17], surface: 'stone' },
  // 동쪽 단: z −122..−112
  { kind: 'box', pos: [0, -1, -117], half: [6, 1, 5], surface: 'stone' },
  ...BRAZIERS.map(pedestal),
];

const portals: Portal[] = [
  { a: 0, b: 1, min: [-2, 0, -0.5], max: [2, 5, 0.5] },
  { a: 1, b: 2, min: [-4, 0, -70.5], max: [4, 9, -69.5] },
  { a: 2, b: 3, min: [-1.5, 0, -122.5], max: [1.5, 5, -121.5] },
];

export const ZONE5: Level = {
  id: 'zone5',
  solids,
  torches: [
    [-1.9, 2.6, 9], [1.9, 2.6, 2],
    [-5.4, 2.6, -12], [5.4, 2.6, -28], [-5.4, 2.6, -44], [5.4, 2.6, -60],
    // 다리 양끝 단의 화톳불 기둥
    [-6, 1.6, -71], [6, 1.6, -71], [-5, 1.6, -120], [5, 1.6, -120],
  ],
  spawn: [0, 1.2, 9],
  enemies: [],
  rooms: [SOUTH, HALL, CHASM, EAST],
  portals,
  braziers: BRAZIERS,
  // 발로그: 추격이 끝날 때까지 보이지 않는 곳에 잠들어 있다가(아래 심연 밑) 서쪽 단에 나타난다
  bosses: [{ kind: 'balrog', pos: [0, -80, -40], name: '두린의 재앙' }],
  chase: { triggerZ: -4, startZ: 6, speed: 5.0, safeZ: -80, stopZ: -69, bossAt: [0, 3.25, -73.5], halfWidth: 8 },
  // 다리 아래 불의 심연: 떨어지면 끝
  lava: [{ min: [-16, -36, -122], max: [16, -26, -70] }],
  pages: [{ id: 5, pos: [5, 0, -2] }],
  entries: { south: { pos: [0, 1.2, 9], facing: 0 } },
  exits: [
    { min: [-3, -1, 10.5], max: [3, 6, 12], to: 'zone4', entry: 'north' },
    { min: [-2, -1, -134], max: [2, 6, -131], to: 'end', entry: 'end', requires: ['bosses'], locked: '발로그가 아직 다리 위에 있다' },
  ],
};
