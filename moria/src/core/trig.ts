/**
 * 결정적 삼각함수 표.
 *
 * Math.sin/cos는 ECMAScript 명세상 "구현 근사"라 엔진마다 결과가 다를 수 있다
 * (Rapier 결정성 문서도 같은 경고를 한다). 그래서 시뮬레이션의 각도는 정수(1회전 = 4096)로 다루고,
 * 표는 +, *, / 만 쓰는 테일러 급수로 채운다. IEEE 754 기본 연산은 모든 엔진에서 결과가 같다.
 */
export const ANGLE_STEPS = 4096;
const MASK = ANGLE_STEPS - 1;
const QUARTER = ANGLE_STEPS / 4;
const HALF = ANGLE_STEPS / 2;

// |x| <= π/4 에서만 쓴다. 이 구간이면 12항으로 double 정밀도에 충분하고,
// π/2 근처까지 급수를 늘리면 sin(π/2)가 1.0000000000000002가 되는 오차가 생긴다 (테스트로 확인).
function taylorSin(x: number): number {
  let term = x;
  let sum = x;
  const x2 = x * x;
  for (let k = 1; k <= 12; k++) {
    term = (-term * x2) / ((2 * k) * (2 * k + 1));
    sum += term;
  }
  return sum;
}

function taylorCos(x: number): number {
  let term = 1;
  let sum = 1;
  const x2 = x * x;
  for (let k = 1; k <= 12; k++) {
    term = (-term * x2) / ((2 * k - 1) * (2 * k));
    sum += term;
  }
  return sum;
}

const SIN = new Float64Array(ANGLE_STEPS);
{
  const step = (Math.PI * 2) / ANGLE_STEPS;
  const EIGHTH = QUARTER / 2;
  for (let i = 0; i <= QUARTER; i++) {
    // 0~45°는 sin 급수, 45~90°는 sin(x) = cos(90° − x). 인덱스로 계산해 90°는 정확히 cos(0) = 1.
    const v = i <= EIGHTH ? taylorSin(i * step) : taylorCos((QUARTER - i) * step);
    const neg = v === 0 ? 0 : -v; // -0 이 해시에 섞이지 않게
    SIN[i] = v;
    SIN[HALF - i] = v;
    SIN[(HALF + i) & MASK] = neg;
    SIN[(ANGLE_STEPS - i) & MASK] = neg;
  }
}

/** a: 정수 각도 (1회전 = 4096). 음수도 허용. */
export const dsin = (a: number): number => SIN[a & MASK]!;
export const dcos = (a: number): number => SIN[(a + QUARTER) & MASK]!;

/** |u| <= tan(π/8) ≈ 0.4142 에서의 atan 급수. 13항이면 오차 < 1e-12 rad. */
function atanSmall(u: number): number {
  const u2 = u * u;
  let term = u;
  let sum = u;
  for (let k = 1; k <= 13; k++) {
    term *= -u2;
    sum += term / (2 * k + 1);
  }
  return sum;
}

const TAN_PI_8 = 0.41421356237309503; // √2 − 1

/**
 * 결정적 atan2 → 정수 각도 (0..4095). Math.atan2 역시 명세상 "구현 근사"라 쓰지 않는다.
 * 팔분면으로 줄인 뒤 atan(z) = π/4 + atan((z−1)/(z+1)) 로 |u| ≤ tan(π/8)까지 좁혀 급수로 계산한다.
 * (y, x) = (0, 0)이면 0을 돌려준다.
 */
export function dAtan2Angle(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const swap = ay > ax;
  const z = swap ? ax / ay : ay / ax; // 0..1
  let a = z > TAN_PI_8 ? Math.PI / 4 + atanSmall((z - 1) / (z + 1)) : atanSmall(z);
  if (swap) a = Math.PI / 2 - a;
  if (x < 0) a = Math.PI - a;
  if (y < 0) a = -a;
  return Math.round((a / (Math.PI * 2)) * ANGLE_STEPS) & MASK;
}

/** 두 정수 각도의 부호 있는 차이 (to − from), −2048..2047 */
export const angleDiff = (from: number, to: number): number => ((to - from + HALF) & MASK) - HALF;

/** 정수 각도 → 라디안 (렌더 전용) */
export const angleToRad = (a: number): number => (a / ANGLE_STEPS) * Math.PI * 2;

/** 렌더 쪽 라디안 → 시뮬레이션 정수 각도. 렌더 쪽에서만 호출한다. */
export const radToAngle = (rad: number): number =>
  Math.round((rad / (Math.PI * 2)) * ANGLE_STEPS) & MASK;
