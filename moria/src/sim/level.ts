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

export type EnemySpawn = { pos: Vec3; patrol: readonly Vec3[] };

export type Level = {
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
  doors?: readonly { pos: Vec3; half: Vec3 }[];
  /** 화로 위치 (바닥 높이). 받침은 solids에 따로 있다 */
  braziers?: readonly Vec3[];
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
