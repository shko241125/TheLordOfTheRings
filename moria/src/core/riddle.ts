/**
 * 두린의 문 수수께끼 판정 (계획서 6장 I). 입력 → NFKC 정규화·소문자·공백 제거 → 정답 목록과 편집 거리 비교.
 * 허용 거리는 답 길이에 비례한다 = floor(길이/4). 계획서의 '모두 ≤ 2'는 두 글자 답('친구')이면 아무 두 글자나,
 * 여섯 글자 답이면 'hello'(→ mellon 거리 2)까지 통과시켰다 (테스트로 확인). 여섯 글자는 오타 1개, 두 글자는 정확히.
 */
/** 비문이 '벗이여'라고 부르므로 '벗'도 정답 */
export const ANSWERS = ['mellon', 'friend', '친구', '벗', '멜론'] as const;

export function normalizeAnswer(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/[\s.,!?'"“”‘’~-]/g, '');
}

/** 레벤슈타인 거리 (코드 포인트 단위 — 한글 음절 하나가 한 글자) */
export function editDistance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length]!;
}

export function checkAnswer(input: string): boolean {
  const s = normalizeAnswer(input);
  if (!s) return false;
  return ANSWERS.some((a) => editDistance(s, a) <= Math.floor([...a].length / 4));
}
