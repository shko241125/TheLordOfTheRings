/**
 * 레벨 기하 데이터. 물리(Rapier)와 렌더(three)가 같은 목록을 읽어 "보이는 벽 = 부딪히는 벽"을 보장한다.
 * 배열 순서가 곧 Rapier 바디 생성 순서이므로(결정성 규칙 4) 순서를 바꾸면 리플레이 호환이 깨진다.
 */
export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type SurfaceKind = 'floor' | 'wall' | 'stone' | 'ceiling';

export type Solid =
  | { kind: 'box'; pos: Vec3; half: Vec3; rot?: Quat; surface: SurfaceKind }
  | { kind: 'cylinder'; pos: Vec3; radius: number; halfHeight: number; surface: SurfaceKind };

export type EnemySpawn = { pos: Vec3; patrol: readonly Vec3[]; /** 기본 고블린 */ kind?: 'goblin' | 'archer' };

export type ZoneId = 'zone1' | 'zone2';

export type Level = {
  /** 구역 id (저장·리플레이·구역 이동이 가리킨다). 시험 방은 없음 */
  id?: ZoneId;
  solids: readonly Solid[];
  torches: readonly Vec3[];
  spawn: Vec3;
  /** 배열 순서 = 적 id = 처리 순서 (결정성) */
  enemies?: readonly EnemySpawn[];
  /** 북소리 디렉터의 물결 스폰 후보 (어두운 구석·굴 입구). 실제 스폰은 규칙 3개를 통과한 곳만 */
  spawnPoints?: readonly Vec3[];
  /** 포털 컬링용 방 (렌더 전용). 각 방의 벽·바닥은 방 경계 안에 있어 방 하나를 숨겨도 이웃 방에 구멍이 나지 않는다 */
  rooms?: readonly Room[];
  portals?: readonly Portal[];
  /** 레벨 바디 다음 순서로 만든다 (결정성 규칙 4). 내비메시에는 넣지 않는다 — 열린 상태 기준 */
  doors?: readonly { pos: Vec3; half: Vec3; /** 렌더 모양: 두린의 문(이실딘) / 쇠문 */ style?: 'durin' | 'gate' }[];
  /** 화로 위치 (바닥 높이). 받침은 solids에 따로 있다 */
  braziers?: readonly Vec3[];
  /** 보스. 일반 적 다음 id를 받는다 */
  bosses?: readonly { kind: 'troll' | 'captain'; pos: Vec3 }[];
  /**
   * 무너지는 기둥: 밑동 중심·반지름·높이·넘어지는 방향(x, z)·체력.
   * seals = 굳은 뒤 봉쇄하는 영역 [minX, minY, minZ, maxX, maxY, maxZ] (굴 안쪽 — 주 동선에는 두지 않는다)
   */
  collapses?: readonly { pos: Vec3; radius: number; height: number; dir: readonly [number, number]; hp: number; seals?: readonly [number, number, number, number, number, number] }[];
  /** 고블린 물결: 디렉터 절정마다 이만큼이 흐름장 무리로 쏟아진다 (없으면 물결 없음) */
  horde?: { size: number };
  /**
   * 구역 출구: 플레이어가 상자 안에 들어오면(조건을 채웠을 때) 다른 구역의 입구로 간다. to = 'end'면 지금 만들어진 끝.
   * requires: 'bosses' = 이 구역 보스를 모두 쓰러뜨림, 'lamps' = 등불을 모두 밝힘
   */
  exits?: readonly { min: Vec3; max: Vec3; to: ZoneId | 'end'; entry: string; requires?: readonly ('bosses' | 'lamps')[]; locked?: string }[];
  /** 다른 구역에서 들어올 때 서는 자리와 바라보는 방향 (정수 각도) */
  entries?: Readonly<Record<string, { pos: Vec3; facing: number }>>;
  /** 퀘스트 등불 (바닥 높이). 모두 밝히면 lampDoors의 문이 열린다 */
  lamps?: readonly Vec3[];
  lampDoors?: readonly number[];
  /** 부서지는 원기둥 (solids 번호). 렌더는 이것들을 합치지 않고 따로 그린다 */
  breakable?: readonly number[];
};

export type Room = { name: string; min: Vec3; max: Vec3 };
/** 두 방을 잇는 통로 구멍 (AABB) */
export type Portal = { a: number; b: number; min: Vec3; max: Vec3 };

const ROOM = 20; // 방 반폭 (m)
const WALL_H = 8;

// Rx(+20°) = (sin 10°, 0, 0, cos 10°). Math.sin 대신 리터럴로 고정한다.
const RAMP_ROT: Quat = [0.17364817766693033, 0, 0, 0.984807753012208];

function stairs(): Solid[] {
  const out: Solid[] = [];
  const rise = 0.2;
  const depth = 0.45;
  for (let i = 0; i < 12; i++) {
    const top = rise * (i + 1);
    out.push({ kind: 'box', pos: [10, top / 2, 4 - i * depth - depth / 2], half: [1.5, top / 2, depth / 2], surface: 'stone' });
  }
  return out;
}

function wallTorches(): Vec3[] {
  const out: Vec3[] = [];
  const inset = ROOM - 0.6;
  for (let i = 0; i < 5; i++) {
    const t = -16 + i * 8;
    out.push([t, 2.6, -inset], [t, 2.6, inset], [-inset, 2.6, t], [inset, 2.6, t]);
  }
  return out;
}

export const TEST_ROOM: Level = {
  solids: [
    { kind: 'box', pos: [0, -0.5, 0], half: [ROOM, 0.5, ROOM], surface: 'floor' },
    { kind: 'box', pos: [0, WALL_H + 0.5, 0], half: [ROOM, 0.5, ROOM], surface: 'ceiling' },
    { kind: 'box', pos: [0, WALL_H / 2, -ROOM - 0.5], half: [ROOM + 1, WALL_H / 2, 0.5], surface: 'wall' },
    { kind: 'box', pos: [0, WALL_H / 2, ROOM + 0.5], half: [ROOM + 1, WALL_H / 2, 0.5], surface: 'wall' },
    { kind: 'box', pos: [-ROOM - 0.5, WALL_H / 2, 0], half: [0.5, WALL_H / 2, ROOM], surface: 'wall' },
    { kind: 'box', pos: [ROOM + 0.5, WALL_H / 2, 0], half: [0.5, WALL_H / 2, ROOM], surface: 'wall' },
    // 20° 경사로 + 윗단. 경사로 윗면 끝 = 1.09 + 4·sin20° + 0.15·cos20° ≈ 2.60 = 윗단 높이 (턱 없음)
    { kind: 'box', pos: [-10, 1.09, 0], half: [1.5, 0.15, 4], rot: RAMP_ROT, surface: 'stone' },
    { kind: 'box', pos: [-10, 1.3, -6], half: [1.5, 1.3, 2.2], surface: 'stone' },
    // 계단 12단 (단 높이 0.2m) + 윗단
    ...stairs(),
    { kind: 'box', pos: [10, 1.2, -3.2], half: [1.5, 1.2, 1.4], surface: 'stone' },
    // 기둥 (21번째 홀의 축소판)
    { kind: 'cylinder', pos: [-4, WALL_H / 2, -12], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
    { kind: 'cylinder', pos: [4, WALL_H / 2, -12], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
    { kind: 'cylinder', pos: [-4, WALL_H / 2, 10], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
    { kind: 'cylinder', pos: [4, WALL_H / 2, 10], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
    { kind: 'cylinder', pos: [0, WALL_H / 2, -4], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
    { kind: 'cylinder', pos: [0, WALL_H / 2, 4], radius: 0.9, halfHeight: WALL_H / 2, surface: 'stone' },
  ],
  torches: wallTorches(),
  spawn: [0, 1.2, 15],
  // 고블린 6마리 (M1 완료 기준). 대부분 북쪽(−Z) 기둥 홀을 순찰하고, 두 마리는 옆 통로를 돈다.
  enemies: [
    { pos: [-9, 1, -10], patrol: [[-9, 1, -10], [-9, 1, -16], [-14, 1, -16]] },
    { pos: [-7, 1, -17], patrol: [[-7, 1, -17], [-1, 1, -17]] },
    { pos: [9, 1, -9], patrol: [[9, 1, -9], [15, 1, -9], [15, 1, -15]] },
    { pos: [6, 1, -16], patrol: [[6, 1, -16], [1, 1, -14]] },
    { pos: [-14, 1, 4], patrol: [[-14, 1, 4], [-14, 1, 12]] },
    { pos: [15, 1, 12], patrol: [[15, 1, 12], [15, 1, 17], [8, 1, 17]] },
  ],
  // 벽 횃불(8m 간격, 반경 7m) 사이의 어두운 지점 — 반지름 12m 원 위 8곳
  spawnPoints: [
    [12, 1, 12], [-12, 1, 12], [12, 1, -12], [-12, 1, -12],
    [0, 1, 12], [0, 1, -12], [12, 1, 0], [-12, 1, 0],
  ],
};
