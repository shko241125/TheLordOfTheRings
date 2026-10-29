import { describe, expect, it } from 'vitest';
import { createEchoSet, ECHO_VERTICAL, roomsInEcho } from '../src/render/echoMap';
import { ZONE1 } from '../src/sim/zone1';

/** N 메아리 지도: 돌의 감각 파동이 닿은 방을 지도에 윤곽선으로만 그린다 — 닿음 판정과 누적 집합 (표현 계층 전용) */

type Box = { min: readonly number[]; max: readonly number[] };
const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });

describe('NT1 파동 중심이 방 안', () => {
  const rooms = [box([-5, 0, -5], [5, 4, 5])];

  it('상수가 명세와 같다', () => {
    expect(ECHO_VERTICAL).toBe(6);
  });

  it('중심이 방 안이면 아주 작은 반지름으로도 닿는다', () => {
    expect(roomsInEcho(rooms, 0, 1, 0, 0.001)).toEqual([0]);
    expect(roomsInEcho(rooms, 4.9, 1, -4.9, 1e-6)).toEqual([0]);
  });

  it('반지름 0이나 음수는 아무 곳에도 닿지 않는다', () => {
    expect(roomsInEcho(rooms, 0, 1, 0, 0)).toEqual([]);
    expect(roomsInEcho(rooms, 0, 1, 0, -3)).toEqual([]);
  });
});

describe('NT2 수평 가장자리', () => {
  it('가장 가까운 변이 정확히 r이면 닿고, r - 0.01이면 닿지 않는다', () => {
    const east = [box([10, 0, -5], [20, 4, 5])];
    expect(roomsInEcho(east, 0, 1, 0, 10)).toEqual([0]);
    expect(roomsInEcho(east, 0, 1, 0, 9.99)).toEqual([]);
    const north = [box([-5, 0, -20], [5, 4, -7])];
    expect(roomsInEcho(north, 0, 1, 0, 7)).toEqual([0]);
    expect(roomsInEcho(north, 0, 1, 0, 6.99)).toEqual([]);
  });

  it('모서리 거리는 유클리드 거리다 (3, 4) → 5', () => {
    const corner = [box([3, 0, 4], [10, 4, 10])];
    expect(roomsInEcho(corner, 0, 1, 0, 5)).toEqual([0]);
    expect(roomsInEcho(corner, 0, 1, 0, 4.99)).toEqual([]);
    const negCorner = [box([-10, 0, -10], [-3, 4, -4])];
    expect(roomsInEcho(negCorner, 0, 1, 0, 5)).toEqual([0]);
    expect(roomsInEcho(negCorner, 0, 1, 0, 4.99)).toEqual([]);
  });
});

describe('NT3 수직 범위', () => {
  it('6 m보다 완전히 위나 아래인 방은 수평으로 안에 있어도 닿지 않는다', () => {
    const above = [box([-5, 6.01, -5], [5, 10, 5])];
    const below = [box([-5, -10, -5], [5, -6.01, 5])];
    expect(roomsInEcho(above, 0, 0, 0, 100)).toEqual([]);
    expect(roomsInEcho(below, 0, 0, 0, 100)).toEqual([]);
  });

  it('정확히 6 m에서 맞닿으면 닿는다', () => {
    const above = [box([-5, 6, -5], [5, 10, 5])];
    const below = [box([-5, -10, -5], [5, -6, 5])];
    expect(roomsInEcho(above, 0, 0, 0, 1)).toEqual([0]);
    expect(roomsInEcho(below, 0, 0, 0, 1)).toEqual([0]);
  });

  it('높은 방이 파동 높이를 감싸면 닿는다', () => {
    expect(roomsInEcho([box([-5, -50, -5], [5, 50, 5])], 0, 0, 0, 1)).toEqual([0]);
  });
});

describe('NT4 순서와 실제 레벨', () => {
  it('여러 방 중 닿은 방의 번호를 오름차순으로 돌려준다', () => {
    const rooms = [
      box([50, 0, 50], [60, 4, 60]), // 멀다
      box([-3, 0, -3], [3, 4, 3]), // 중심
      box([0, 20, 0], [5, 24, 5]), // 너무 높다
      box([4, 0, -1], [8, 4, 1]), // 4 m 옆
      box([-9, 0, -1], [-6, 4, 1]), // 6 m 옆
    ];
    expect(roomsInEcho(rooms, 0, 1, 0, 6)).toEqual([1, 3, 4]);
    expect(roomsInEcho(rooms, 0, 1, 0, 4)).toEqual([1, 3]);
  });

  const rooms = ZONE1.rooms!;
  const r0 = rooms[0];
  const cx = (r0.min[0] + r0.max[0]) / 2;
  const cz = (r0.min[2] + r0.max[2]) / 2;
  const overlapping = (y: number) =>
    rooms
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.min[1] <= y + ECHO_VERTICAL && r.max[1] >= y - ECHO_VERTICAL)
      .map(({ i }) => i);

  it('ZONE1의 방 0 안에서 작은 반지름이면 방 0에 닿는다', () => {
    const y = r0.min[1] + 1;
    expect(roomsInEcho(rooms, cx, y, cz, 0.1)).toContain(0);
  });

  it('ZONE1에서 반지름 1000이면 수직 범위가 겹치는 모든 방에 닿는다', () => {
    expect(rooms.length).toBeGreaterThan(1);
    for (const y of [r0.min[1] + 1, r0.min[1] - 3, r0.max[1] - 1]) {
      const got = roomsInEcho(rooms, cx, y, cz, 1000);
      expect(got).toEqual(overlapping(y));
      expect(got).toEqual([...got].sort((a, b) => a - b));
    }
  });
});

describe('NT5 메아리 집합', () => {
  it('새 번호가 있을 때만 add가 true이고 has/size는 합집합을 따른다', () => {
    const s = createEchoSet();
    expect(s.size).toBe(0);
    expect(s.has(0)).toBe(false);
    expect(s.add([])).toBe(false);
    expect(s.size).toBe(0);
    expect(s.add([2, 5])).toBe(true);
    expect(s.size).toBe(2);
    expect(s.has(2)).toBe(true);
    expect(s.has(5)).toBe(true);
    expect(s.has(3)).toBe(false);
    expect(s.add([2, 5])).toBe(false);
    expect(s.add([5])).toBe(false);
    expect(s.add([5, 3])).toBe(true);
    expect(s.size).toBe(3);
    expect(s.has(3)).toBe(true);
    expect(s.add([])).toBe(false);
    expect(s.size).toBe(3);
  });

  it('집합은 서로 독립이다', () => {
    const a = createEchoSet();
    const b = createEchoSet();
    a.add([1]);
    expect(b.has(1)).toBe(false);
    expect(b.size).toBe(0);
  });
});
