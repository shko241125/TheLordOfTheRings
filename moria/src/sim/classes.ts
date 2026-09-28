/**
 * 클래스별 체격·이동 수치 (시뮬레이션 데이터 — 리플레이에 영향을 주므로 바꾸면 결정성 기준값 재생성).
 * 속도 근거: 사람 보행 ≈1.4 m/s, 조깅 ≈3~4, 질주 ≈6+. 액션 게임은 조깅을 기본 이동으로 쓰고 조금 빠르게 잡는다.
 * 캐릭터 애니메이션의 무미끄럼 속도(UAL 마네킹 1.8m 기준 걷기 0.94, 조깅 5.6, 질주 5.9 m/s — 실측)는
 * 렌더 쪽이 재생 배속으로 맞춘다. 시뮬레이션은 애니메이션을 모른다.
 */
export type ClassId = 'human' | 'dwarf' | 'elf';

export type ClassStats = {
  /** 캡슐 반높이(원통부) · 반지름 (m). 전체 키 = 2·(half + radius) */
  capsuleHalf: number;
  capsuleRadius: number;
  /** m/s. 아날로그 스틱 반 기울기 = 걷기, 끝까지 = 조깅, 질주 버튼 = 질주 */
  walkSpeed: number;
  jogSpeed: number;
  sprintSpeed: number;
  crouchSpeed: number;
  /** m/s² — 지상 가속 / 입력 없을 때 감속 / 공중 제어 */
  accel: number;
  decel: number;
  airAccel: number;
  /** 몸 회전 속도 (정수 각도/틱, 1회전 = 4096). 정지~조깅 / 질주 */
  turnRate: number;
  sprintTurnRate: number;
  /** 돌의 감각 음파 반경 (m) — 드워프는 돌을 더 잘 읽는다 */
  senseRadius: number;
};

// 720°/s = 4096·2/60 ≈ 137 /tick, 400°/s ≈ 76 /tick
export const CLASS_STATS: Record<ClassId, ClassStats> = {
  human: { capsuleHalf: 0.56, capsuleRadius: 0.34, walkSpeed: 1.5, jogSpeed: 4.2, sprintSpeed: 6.2, crouchSpeed: 1.3, accel: 22, decel: 28, airAccel: 4, turnRate: 137, sprintTurnRate: 76, senseRadius: 20 },
  // 드워프: 작고 단단하다 — 느리지만 가속이 빠르다
  dwarf: { capsuleHalf: 0.38, capsuleRadius: 0.32, walkSpeed: 1.3, jogSpeed: 3.8, sprintSpeed: 5.6, crouchSpeed: 1.2, accel: 26, decel: 32, airAccel: 4, turnRate: 137, sprintTurnRate: 80, senseRadius: 30 },
  // 엘프: 가볍고 빠르다
  elf: { capsuleHalf: 0.62, capsuleRadius: 0.32, walkSpeed: 1.6, jogSpeed: 4.5, sprintSpeed: 6.8, crouchSpeed: 1.4, accel: 24, decel: 30, airAccel: 5, turnRate: 150, sprintTurnRate: 84, senseRadius: 20 },
};
