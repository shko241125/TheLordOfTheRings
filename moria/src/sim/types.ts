import type RAPIER from '@dimforge/rapier3d-compat';
import type { NavMesh } from 'navcat';
import type { Rng } from '../core/rng';
import type { ClassStats } from './classes';

export type V3 = [number, number, number];

/** 한 틱의 입력. 모든 값이 정수라 리플레이 파일에 그대로 기록된다. */
export type InputFrame = {
  /** 누르고 있는 버튼 비트 (BTN_*) — 시뮬레이션이 직전 틱과 비교해 '누른 순간'을 찾는다 */
  buttons: number;
  /** -127..127, 오른쪽 + (키보드는 ±127, 스틱은 중간값) */
  moveX: number;
  /** -127..127, 앞 + */
  moveY: number;
  /** 카메라 요 (정수 각도, 1회전 = 4096) */
  yaw: number;
  /** UI 명령 (0/없음 = 없음, 1..N = 스킬 배우기, 255 = 스킬 초기화) — 리플레이에 기록된다 */
  cmd?: number;
};

// 유지형 버튼 (누르고 있는 동안 켜짐)
export const BTN_SPRINT = 1 << 0;
export const BTN_CROUCH = 1 << 1;
export const BTN_LIGHT = 1 << 2; // 약공격 (좌클릭)
export const BTN_HEAVY = 1 << 3; // 강공격 (우클릭, 누르는 동안 차지)
export const BTN_PARRY = 1 << 4; // Shift
// 한 틱짜리 펄스 (입력 계층이 탭/홀드를 판정해 한 틱만 켠다)
export const BTN_DODGE = 1 << 5; // Space 짧게
export const BTN_LOCK = 1 << 6; // 휠 클릭
export const BTN_TORCH = 1 << 7; // F 짧게: 내려놓기 / 줍기 / 예비 횃불 켜기
export const BTN_THROW = 1 << 8; // F 길게: 던지기
export const BTN_SENSE = 1 << 9; // V: 돌의 감각
export const BTN_INTERACT = 1 << 10; // E: 화로 밝히기·쉬기
/** 두린의 문 암호가 맞았다 (수수께끼 UI가 판정해 한 틱 켠다 — 입력으로 기록되므로 리플레이가 재현한다) */
export const BTN_WORD = 1 << 11;
export const BTN_CALL = 1 << 12; // Q: 동료 호출

export type ActionKind = 'free' | 'attack' | 'dodge' | 'parry' | 'stagger' | 'dead';

export type AttackDef = {
  id: string;
  /** 틱 수: 예비 동작 → 판정 → 회복 */
  windup: number;
  active: number;
  recovery: number;
  damage: number;
  /** 판정 거리 (몸 중심에서, m)와 부채꼴 반각 (정수 각도) */
  reach: number;
  halfArc: number;
  stamina: number;
  /** 예비 동작~판정 동안 앞으로 내딛는 속도 (m/s) */
  lunge: number;
  /** 명중 시 전체 정지 틱 (히트스톱) */
  hitstop: number;
};

export type Buffered = { kind: 'light' | 'heavy' | 'dodge' | 'parry'; ticks: number };

export type Mover = {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  vx: number;
  vz: number;
  vy: number;
  facing: number;
  grounded: boolean;
  airTicks: number;
};

export type PlayerState = Mover & {
  readonly controller: RAPIER.KinematicCharacterController;
  readonly stats: ClassStats;
  crouching: boolean;
  landedTick: number;
  landedAirTicks: number;
  hp: number;
  maxHp: number;
  stamina: number;
  /** 스태미나 회복이 다시 시작되는 틱 */
  staminaRegenAt: number;
  /** 스태미나가 바닥나면 30 이상 찰 때까지 질주 금지 */
  exhausted: boolean;
  action: ActionKind;
  /** 현재 행동을 시작한 뒤 지난 틱 */
  actionTick: number;
  attack: AttackDef | null;
  /** 0..3 약공격 콤보 단계 */
  combo: number;
  comboQueued: boolean;
  heavyCharge: number;
  charging: boolean;
  /** 이번 공격에 이미 맞은 적 id */
  hitSet: Set<number>;
  buffer: Buffered | null;
  prevButtons: number;
  lockTarget: number;
  /** 패링 성공 뒤 이 틱까지 다음 공격 피해 배수 */
  riposteUntil: number;
  dodgeDirX: number;
  dodgeDirZ: number;
  heldTorch: number;
  spareTorches: number;
  /** 돌의 감각을 다시 쓸 수 있는 틱 */
  senseReadyAt: number;
  /** 동료 호출 게이지 0..100 */
  companion: number;
  // --- 성장 (sim/growth.ts) ---
  level: number;
  xp: number;
  points: number;
  /** 배운 스킬 (종족 트리의 노드 번호) */
  skills: number[];
  /** 레벨·스킬·장비에서 나온 전투 배율 (파생값 — 바뀔 때마다 다시 계산) */
  mods: import('./growth').Mods;
  // --- 장비 (sim/gear.ts) ---
  inventory: import('./items').Item[];
  /** 장착 6칸 (무기, 보조, 머리, 몸통, 장신구, 장신구) */
  equipped: (import('./items').Item | null)[];
  gold: number;
  mithril: number;
  /** 최근 어둠에 머문 비율 0..1 (지수 이동 평균) — 전리품 등급 */
  darkness: number;
};

export type EnemyAI = 'patrol' | 'suspicious' | 'chase' | 'engage' | 'attack' | 'stagger' | 'dead';

export type EnemyKind = 'goblin' | 'troll' | 'archer' | 'captain';
/** 트롤 기술 ('' = 없음) */
export type TrollMove = '' | 'slam' | 'sweep' | 'shoot' | 'combo' | 'charge';

export type Enemy = Mover & {
  readonly id: number;
  readonly kind: EnemyKind;
  hp: number;
  ai: EnemyAI;
  aiTick: number;
  /** 0..1 이상이면 경계 → 추격 */
  awareness: number;
  patrol: readonly V3[];
  patrolIdx: number;
  path: V3[];
  pathIdx: number;
  repathAt: number;
  hasToken: boolean;
  cooldownUntil: number;
  hitSet: Set<number>;
  /** 공전 방향 (±1) — 무리가 한쪽으로 몰리지 않게 */
  orbitSign: number;
  lastSeen: V3;
  /** 공격 휘두르기 진행 틱 (−1 = 아직 접근 중) */
  swingTick: number;
  /** 이번 휘청임 길이 (맞음 14틱 / 패링당함 50틱) */
  staggerLen: number;
  // --- 트롤 전용 ---
  move: TrollMove;
  /** 내려찍기 지점 (예비 동작 앞 2/3 동안 따라오다 고정된다) */
  aimX: number;
  aimZ: number;
  /** 잠든 자리 (너무 멀리 끌려가면 돌아가 회복한다) */
  readonly home: V3;
  /** 무리(horde)에서 승격한 고블린 — 멀어지면 다시 무리로 강등될 수 있다 */
  fromHorde: boolean;
  /** 기술 안의 단계 (대장 3연타의 몇 번째) */
  step: number;
  /** 한 번만 쓰는 기술 표시 비트 (대장 휘파람) */
  used: number;
};

/** 부서지는 기둥 (트롤 내려찍기) */
export type Pillar = { readonly solid: number; readonly x: number; readonly z: number; readonly r: number; body: RAPIER.RigidBody | null };

/** 열리는 문 (두린의 문). 닫힌 동안만 물리 바디가 있다 */
export type Door = { readonly pos: V3; readonly half: V3; body: RAPIER.RigidBody | null; open: boolean };

/** 드워프 화로 = 체크포인트. 밝히면 빛이 되고, 그 앞에서 쉬면 체력·횃불이 차고 저장된다 */
export type Brazier = { readonly x: number; readonly y: number; readonly z: number; lit: boolean };

export type SimLight = { x: number; y: number; z: number; intensity: number; range: number };

export type NoiseEvent = { x: number; y: number; z: number; tick: number; ttl: number; radius: number; loudness: number };

export type TorchItem = {
  readonly id: number;
  state: 'held' | 'ground' | 'flying';
  body: RAPIER.RigidBody | null;
  x: number;
  y: number;
  z: number;
  /** 남은 연소 틱. −1 = 꺼지지 않음 (내려놓은 횃불) */
  burn: number;
  thrown: boolean;
};

/** 북소리 디렉터 단계 (계획서 6장 기둥 2 — Left 4 Dead AI Director의 긴장 곡선을 '들리게' 만든 것) */
export type DirectorPhase = 'relax' | 'buildup' | 'warn' | 'peak' | 'fade';

export type DirectorState = {
  phase: DirectorPhase;
  phaseTick: number;
  /** 이번 단계 길이 (휴식·고조에서 쓰는 틱 수) */
  phaseLen: number;
  /** 플레이어 긴장도 0..1 — 맞거나 가까이서 싸우면 오르고, 주변이 조용하면 초당 5%씩 준다 */
  intensity: number;
  /** 이번 절정 동안의 최고 긴장도 */
  peakMax: number;
  /** 마지막 입력의 카메라 요 (정수 각도) — '시야 밖' 판정용 */
  cameraYaw: number;
  /** 이번 물결로 나온 적 id */
  wave: number[];
  /** 북 템포 (0 = 조용) — 렌더가 그대로 소리로 낸다 */
  bpm: number;
};

/** 렌더가 소비하는 일회성 사건 (시뮬레이션은 읽지 않는다 → 결정성과 무관) */
export type SimEvent =
  | { type: 'hit'; tick: number; target: number; x: number; y: number; z: number; heavy: boolean; dark: number }
  | { type: 'playerHit'; tick: number; damage: number; source: 'goblin' | 'troll' | 'collapse' }
  | { type: 'parry'; tick: number; enemy: number }
  | { type: 'death'; tick: number; enemy: number }
  | { type: 'swing'; tick: number; actor: number; attack: string }
  | { type: 'alert'; tick: number; enemy: number }
  | { type: 'drums'; tick: number; phase: DirectorPhase }
  | { type: 'wave'; tick: number; count: number }
  | { type: 'sense'; tick: number; x: number; y: number; z: number; radius: number }
  | { type: 'door'; tick: number; door: number }
  | { type: 'slam'; tick: number; enemy: number; x: number; y: number; z: number }
  | { type: 'pillar'; tick: number; solid: number; x: number; z: number }
  | { type: 'crack'; tick: number; index: number; hp: number }
  | { type: 'levelUp'; tick: number; level: number }
  | { type: 'lamp'; tick: number; index: number; allLit: boolean }
  | { type: 'shoot'; tick: number; enemy: number }
  | { type: 'pickup'; tick: number; kind: 'item' | 'gold' | 'mithril' | 'full'; amount: number; name: string; grade: number }
  | { type: 'gear'; tick: number; what: 'equip' | 'unequip' | 'drop' | 'upgrade'; name: string }
  | { type: 'arrowStuck'; tick: number; x: number; y: number; z: number }
  | { type: 'whistle'; tick: number; enemy: number }
  | { type: 'exit'; tick: number; to: string; entry: string }
  | { type: 'exitLocked'; tick: number; reason: string }
  | { type: 'skill'; tick: number; index: number }
  | { type: 'collapse'; tick: number; index: number; stage: 'fall' | 'impact' | 'settled' }
  | { type: 'companion'; tick: number; who: string; line: string; x: number; y: number; z: number; facing: number; radius: number; halfArc: number; killed: number }
  | { type: 'rest'; tick: number; brazier: number; first: boolean };

export type Sim = {
  /** 이 시뮬레이션의 레벨 (바뀌지 않는 데이터 — 스냅샷에 담지 않는다) */
  readonly level: import('./level').Level;
  tick: number;
  readonly world: RAPIER.World;
  readonly rng: Rng;
  readonly player: PlayerState;
  readonly enemies: Enemy[];
  readonly enemyController: RAPIER.KinematicCharacterController;
  readonly nav: NavMesh;
  readonly staticLights: readonly SimLight[];
  readonly torches: TorchItem[];
  nextTorchId: number;
  noise: NoiseEvent[];
  /** 남은 전체 정지 틱 */
  hitstop: number;
  /** 공격권을 가진 적 수 (최대 MAX_TOKENS) */
  tokens: number;
  events: SimEvent[];
  director: DirectorState;
  /** 디렉터가 물결을 부를 수 있는 자리 (레벨 데이터) */
  readonly spawnPoints: readonly V3[];
  nextEnemyId: number;
  readonly doors: Door[];
  readonly braziers: Brazier[];
  /** 마지막으로 쉰 화로 (−1 = 없음) */
  checkpoint: number;
  readonly pillars: Pillar[];
  /** 보스 적 id (레벨의 bosses 순서) */
  readonly bosses: number[];
  /** 바닥의 전리품 */
  loot: import('./gear').LootDrop[];
  nextLootId: number;
  nextItemId: number;
  /** 날아가는 화살 (고블린 궁수) */
  arrows: import('./archer').Arrow[];
  nextArrowId: number;
  /** 퀘스트 등불 (구역 2 — 21번째 홀) */
  readonly lamps: { readonly x: number; readonly y: number; readonly z: number; lit: boolean }[];
  /** 구역 출구로 나갔다 (한 번만 사건을 낸다) */
  exited: boolean;
  /** 잠긴 출구 안에 있다 (들어설 때 한 번 알린다) */
  exitLockedShown: boolean;
  /** 고블린 물결 (레벨에 horde 설정이 있을 때만) */
  readonly horde: import('./horde').Horde | null;
  /** 무너지는 기둥 (레벨 collapses 순서) */
  readonly collapses: import('./collapse').Collapse[];
  /** 잔해가 막은 내비메시 폴리곤을 빼는 경로 필터 */
  readonly navBlock: import('./collapse').NavBlock;
  readonly classId: import('./classes').ClassId;
};

/** 충돌 그룹: (소속 << 16) | 필터 */
export const G_LEVEL = 0x0001;
export const G_CHAR = 0x0002;
export const G_TORCH = 0x0004;
export const groups = (member: number, filter: number) => ((member & 0xffff) << 16) | (filter & 0xffff);
