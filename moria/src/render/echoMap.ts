/** 메아리 지도: 돌의 감각 파동이 닿은 방을 지도에 윤곽선으로만 그린다 ("본 곳이 아니라 들은 곳"). 표현 계층 전용 — sim·저장·리플레이와 무관 */

/** 파동 높이에서 위아래로 이만큼(m) 안에 걸친 방만 닿는다 */
export const ECHO_VERTICAL = 6;

/** 반지름 r 파동이 닿은 방 번호 (오름차순). 수평 = 방 x/z 사각형까지 거리 ≤ r, 수직 = 방 높이가 [y − 6, y + 6]과 겹침 */
export function roomsInEcho(
  rooms: readonly { min: readonly number[]; max: readonly number[] }[],
  x: number,
  y: number,
  z: number,
  r: number,
): number[] {
  const out: number[] = [];
  if (r <= 0) return out;
  rooms.forEach((room, i) => {
    if (room.min[1]! > y + ECHO_VERTICAL || room.max[1]! < y - ECHO_VERTICAL) return;
    const dx = Math.max(room.min[0]! - x, 0, x - room.max[0]!);
    const dz = Math.max(room.min[2]! - z, 0, z - room.max[2]!);
    if (dx * dx + dz * dz <= r * r) out.push(i);
  });
  return out;
}

/** 들은 방 집합: 구역에 있는 동안 늘기만 한다 (저장하지 않음) */
export function createEchoSet() {
  const set = new Set<number>();
  return {
    /** 새 번호가 하나라도 들어오면 true */
    add(indices: readonly number[]) {
      const before = set.size;
      for (const i of indices) set.add(i);
      return set.size > before;
    },
    has: (i: number) => set.has(i),
    get size() {
      return set.size;
    },
  };
}
