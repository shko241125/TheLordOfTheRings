/**
 * 시드 난수 (mulberry32). 32비트 정수 연산(Math.imul, 시프트)만 쓰므로
 * 모든 JS 엔진에서 같은 수열이 나온다. 게임 로직에서 Math.random 대신 이것을 쓴다.
 */
export type Rng = {
  /** [0, 1) 균등 분포 */
  next(): number;
  /** [0, n) 정수 */
  int(n: number): number;
  /** 내부 상태 (스냅샷·리플레이용). 수열에는 영향이 없다 */
  state(): number;
  setState(s: number): void;
};

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    state: () => s,
    setState: (v) => {
      s = v >>> 0;
    },
  };
}

/** FNV-1a 32비트. 시스템별 난수 스트림 시드 파생과 상태 해시에 쓴다. */
export function fnv1a(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const encoder = new TextEncoder();

/** 같은 월드 시드에서 시스템마다 독립된 스트림을 만든다 (예: 'ai', 'loot'). */
export function streamSeed(worldSeed: number, stream: string): number {
  const h = fnv1a(encoder.encode(stream));
  return (h ^ Math.imul(worldSeed >>> 0, 0x9e3779b1)) >>> 0;
}
