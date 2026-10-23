import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addStain,
  createStainNotifier,
  LEAVE_R,
  loadStains,
  MAX_PER_ZONE,
  MAX_TOTAL,
  NEAR_R,
  nearestStain,
  STAIN_KEY,
  stainsIn,
  type Stain,
  type StainStore,
} from '../src/replay/stains';

/** L 나의 핏자국: 죽은 자리에 남는 지난날의 흔적 — 저장·한도·근접 알림 (표현 계층 전용, 시뮬레이션 무관) */

/** 메모리 속 가짜 저장소 (실제 localStorage는 쓰지 않는다) */
function memStore(init: Record<string, string> = {}): StainStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => void data.set(k, v),
  };
}

let clock = 1000;
/** 서로 다른 at(단조 증가)·위치를 가진 핏자국 */
function stain(zone: string, x = 0, z = 0, line = `죽음 ${clock}`): Stain {
  clock += 1;
  return { zone, x, y: 0.1, z, line, at: clock };
}

describe('LT1 기록과 불러오기', () => {
  it('상수가 명세와 같다', () => {
    expect(STAIN_KEY).toBe('moria.stains');
    expect(MAX_PER_ZONE).toBe(5);
    expect(MAX_TOTAL).toBe(30);
    expect(NEAR_R).toBe(2.5);
    expect(LEAVE_R).toBe(4);
  });

  it('새 저장소는 빈 목록을 불러온다', () => {
    expect(loadStains(memStore())).toEqual([]);
  });

  it('add 후 load 하면 같은 핏자국이 저장된 순서(오래된 것 먼저)로 돌아온다', () => {
    const store = memStore();
    const a = stain('zone1', 1, 2);
    const b = stain('zone2', -3, 4);
    expect(addStain(a, store)).toEqual([a]);
    expect(addStain(b, store)).toEqual([a, b]);
    expect(loadStains(store)).toEqual([a, b]);
    // STAIN_KEY 아래 JSON 배열로 저장된다
    expect([...store.data.keys()]).toEqual([STAIN_KEY]);
    expect(JSON.parse(store.data.get(STAIN_KEY)!)).toEqual([a, b]);
  });

  it('stainsIn 은 그 구역의 것만 순서대로 고른다', () => {
    const a = stain('zone1');
    const b = stain('zone2');
    const c = stain('zone1');
    expect(stainsIn([a, b, c], 'zone1')).toEqual([a, c]);
    expect(stainsIn([a, b, c], 'zone9')).toEqual([]);
  });
});

describe('LT2 한도: 구역당 5개, 전체 30개', () => {
  it('한 구역의 6번째는 그 구역의 가장 오래된 것을 밀어내고, 다른 구역은 그대로다', () => {
    const store = memStore();
    const other = stain('zone2', 9, 9);
    addStain(other, store); // 전체에서 가장 오래된 것은 다른 구역에 있다
    const z1 = Array.from({ length: 5 }, (_, i) => stain('zone1', i, 0));
    for (const s of z1) addStain(s, store);
    const sixth = stain('zone1', 5, 0);
    const out = addStain(sixth, store);
    expect(out).toEqual([other, ...z1.slice(1), sixth]);
    expect(loadStains(store)).toEqual(out);
    expect(stainsIn(out, 'zone1')).toHaveLength(5);
  });

  it('전체 31번째는 전역에서 가장 오래된 것을 밀어낸다', () => {
    const store = memStore();
    const all: Stain[] = [];
    for (let zi = 0; zi < 6; zi++) for (let i = 0; i < 5; i++) all.push(stain(`z${zi}`, i, zi));
    for (const s of all) addStain(s, store);
    expect(loadStains(store)).toEqual(all);
    const extra = stain('z6', 0, 6);
    const out = addStain(extra, store);
    expect(out).toHaveLength(30);
    expect(out).toEqual([...all.slice(1), extra]);
    expect(stainsIn(out, 'z0')).toEqual(all.slice(1, 5));
    expect(loadStains(store)).toEqual(out);
  });

  it('가득 찬(30개) 상태에서 한 구역의 6번째는 그 구역 것만 밀어낸다 (전역 최고참은 남는다)', () => {
    const store = memStore();
    const all: Stain[] = [];
    for (let zi = 0; zi < 6; zi++) for (let i = 0; i < 5; i++) all.push(stain(`z${zi}`, i, zi));
    for (const s of all) addStain(s, store);
    const sixth = stain('z5', 7, 7);
    const out = addStain(sixth, store);
    expect(out).toHaveLength(30);
    expect(out[0]).toEqual(all[0]); // z0의 가장 오래된 것은 남는다
    expect(stainsIn(out, 'z0')).toEqual(all.slice(0, 5));
    expect(stainsIn(out, 'z5')).toEqual([...all.slice(26, 30), sixth]);
  });
});

describe('LT3 망가진 저장소에도 죽지 않는다', () => {
  it('JSON이 아니거나 배열이 아니면 빈 목록', () => {
    expect(loadStains(memStore({ [STAIN_KEY]: '{not json' }))).toEqual([]);
    expect(loadStains(memStore({ [STAIN_KEY]: '{"zone":"zone1"}' }))).toEqual([]);
    expect(loadStains(memStore({ [STAIN_KEY]: 'null' }))).toEqual([]);
  });

  it('올바른 항목과 망가진 항목이 섞이면 올바른 것만 순서대로 남는다', () => {
    const a = stain('zone1', 1, 1);
    const b = stain('zone2', 2, 2);
    const raw =
      '[' +
      [
        JSON.stringify(a),
        'null',
        '42',
        '"text"',
        JSON.stringify({ ...a, zone: 7 }),
        JSON.stringify({ ...a, x: '1' }),
        JSON.stringify({ ...a, y: null }),
        JSON.stringify({ ...a, line: 5 }),
        JSON.stringify({ ...a, at: 'yesterday' }),
        JSON.stringify((({ z: _z, ...rest }) => rest)(a)),
        JSON.stringify(a).replace(`"x":${a.x}`, '"x":1e999'), // Infinity → 유한수가 아님
        JSON.stringify(b),
      ].join(',') +
      ']';
    const store = memStore({ [STAIN_KEY]: raw });
    expect(loadStains(store)).toEqual([a, b]);
    // 그 위에 더해도 망가진 것은 버려지고 올바른 것은 유지된다
    const c = stain('zone1', 3, 3);
    expect(addStain(c, store)).toEqual([a, b, c]);
  });

  it('getItem/setItem 이 던지는 저장소: load 는 [], add 는 던지지 않고 목록을 돌려준다', () => {
    const boom: StainStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(loadStains(boom)).toEqual([]);
    const s = stain('zone1');
    let out: Stain[] = [];
    expect(() => (out = addStain(s, boom))).not.toThrow();
    expect(out).toEqual([s]);
  });

  it('읽기는 되고 쓰기만 던지는 저장소: add 는 기존 + 새 핏자국을 돌려준다', () => {
    const a = stain('zone1', 1, 1);
    const ro: StainStore = {
      getItem: (k) => (k === STAIN_KEY ? JSON.stringify([a]) : null),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const s = stain('zone1', 2, 2);
    let out: Stain[] = [];
    expect(() => (out = addStain(s, ro))).not.toThrow();
    expect(out).toEqual([a, s]);
  });

  it('저장소가 null 이면 load 는 [], add 는 목록을 돌려준다', () => {
    expect(loadStains(null)).toEqual([]);
    const s = stain('zone1');
    expect(addStain(s, null)).toEqual([s]);
  });
});

describe('LT4 nearestStain', () => {
  it('범위 안에서 가장 가까운 것이 이긴다 (높이 y 는 무시)', () => {
    const far = stain('zone1', 2, 0);
    const near = { ...stain('zone1', 0, -1), y: 50 };
    const tooFar = stain('zone1', 10, 0);
    expect(nearestStain([far, tooFar, near], 'zone1', 0, 0)).toEqual(near);
    expect(nearestStain([near, far], 'zone1', 1.9, 0)).toEqual(far);
  });

  it('정확히 반지름이거나 넘으면 null (엄격히 작아야 한다)', () => {
    const at = stain('zone1', 1.5, 2); // 수평 거리 정확히 2.5 (3-4-5)
    expect(nearestStain([at], 'zone1', 0, 0)).toBeNull();
    expect(nearestStain([stain('zone1', 2.6, 0)], 'zone1', 0, 0)).toBeNull();
    expect(nearestStain([stain('zone1', 0, 2.49)], 'zone1', 0, 0)).not.toBeNull();
    // r 인자를 따른다
    expect(nearestStain([at], 'zone1', 0, 0, 2.51)).toEqual(at);
    expect(nearestStain([stain('zone1', 1, 0)], 'zone1', 0, 0, 1)).toBeNull();
  });

  it('다른 구역의 핏자국은 아무리 가까워도 무시한다', () => {
    const elsewhere = stain('zone2', 0, 0);
    const here = stain('zone1', 2, 0);
    expect(nearestStain([elsewhere, here], 'zone1', 0, 0)).toEqual(here);
    expect(nearestStain([elsewhere], 'zone1', 0, 0)).toBeNull();
  });
});

describe('LT5 접근 알림 (히스테리시스)', () => {
  it('들어올 때 한 번, 머무는 동안·떠남 반경(4m) 안을 오가는 동안은 다시 안 뜬다', () => {
    const a = stain('zone1', 0, 0);
    const list = [a];
    const n = createStainNotifier();
    expect(n.update(list, 'zone1', 10, 0)).toBeNull();
    expect(n.update(list, 'zone1', 2, 0)).toEqual(a); // 처음 들어옴
    expect(n.update(list, 'zone1', 2, 0)).toBeNull(); // 머묾
    expect(n.update(list, 'zone1', 1, 0)).toBeNull();
    expect(n.update(list, 'zone1', 3, 0)).toBeNull(); // 3m: 떠남 반경 안
    expect(n.update(list, 'zone1', 2, 0)).toBeNull(); // 다시 들어와도 안 뜸
    expect(n.update(list, 'zone1', 4, 0)).toBeNull(); // 정확히 4m 는 '4m 넘게'가 아니다
    expect(n.update(list, 'zone1', 2, 0)).toBeNull();
    expect(n.update(list, 'zone1', 4.1, 0)).toBeNull(); // 4m 넘게 떠남
    expect(n.update(list, 'zone1', 3, 0)).toBeNull(); // 아직 범위(2.5m) 밖
    expect(n.update(list, 'zone1', 0, 2)).toEqual(a); // 다시 들어오면 다시 뜬다
    expect(n.update(list, 'zone1', 0, 2)).toBeNull();
  });

  it('두 핏자국이 함께 범위 안이면 가까운 것 하나만 알린다', () => {
    const a = stain('zone1', 0, 0);
    const b = stain('zone1', 3, 0);
    const n = createStainNotifier();
    expect(n.update([a, b], 'zone1', 1.8, 0)).toEqual(b); // a 1.8m, b 1.2m
    expect(n.update([a, b], 'zone1', 1.8, 0)).toBeNull();
  });

  it('다른 구역의 핏자국은 알리지 않는다', () => {
    const n = createStainNotifier();
    expect(n.update([stain('zone2', 0, 0)], 'zone1', 0, 0)).toBeNull();
  });

  it('near/leave 인자를 따른다', () => {
    const a = stain('zone1', 0, 0);
    const n = createStainNotifier(1, 2);
    expect(n.update([a], 'zone1', 1.5, 0)).toBeNull();
    expect(n.update([a], 'zone1', 0.5, 0)).toEqual(a);
    expect(n.update([a], 'zone1', 2.5, 0)).toBeNull();
    expect(n.update([a], 'zone1', 0.5, 0)).toEqual(a);
  });
});

describe('LT6 문구 길이', () => {
  it('200자보다 긴 line 은 200자로 잘려 저장된다', () => {
    const store = memStore();
    const long = 'ᚱ'.repeat(150) + 'x'.repeat(100);
    const s = stain('zone1', 0, 0, long);
    const out = addStain(s, store);
    expect(out[0].line).toBe(long.slice(0, 200));
    expect(out[0].line).toHaveLength(200);
    expect(loadStains(store)[0].line).toBe(long.slice(0, 200));
    // 나머지 필드는 그대로
    expect({ ...out[0], line: long }).toEqual(s);
  });

  it('200자 이하는 그대로', () => {
    const exact = 'y'.repeat(200);
    const out = addStain(stain('zone1', 0, 0, exact), memStore());
    expect(out[0].line).toBe(exact);
  });
});

describe('rev 3 보강', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('저장소 인자를 생략하면 globalThis.localStorage 를 쓴다', () => {
    const store = memStore();
    vi.stubGlobal('localStorage', store);
    const a = stain('zone1', 1, 1);
    expect(addStain(a)).toEqual([a]);
    expect(JSON.parse(store.data.get(STAIN_KEY)!)).toEqual([a]);
    expect(loadStains()).toEqual([a]);
  });

  it('globalThis.localStorage 접근 자체가 던지면 저장소 없음처럼 동작한다', () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(loadStains()).toEqual([]);
      const s = stain('zone1');
      let out: Stain[] = [];
      expect(() => (out = addStain(s))).not.toThrow();
      expect(out).toEqual([s]);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'localStorage', saved);
      else delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it('알림은 값으로 핏자국을 식별한다: 매 프레임 새로 만든 배열이어도 한 번만 뜬다', () => {
    const base = [stain('zone1', 0, 0), stain('zone1', 20, 20)];
    const fresh = () => base.map((s) => ({ ...s }));
    const n = createStainNotifier();
    expect(n.update(fresh(), 'zone1', 1, 0)).toEqual(base[0]);
    for (let i = 0; i < 5; i++) expect(n.update(fresh(), 'zone1', 1 + i * 0.1, 0)).toBeNull();
  });

  it('히스테리시스는 핏자국마다: A 를 본 뒤 더 가까워진 B 는 A 가 4m 안이어도 뜨고, A 로 돌아가면 안 뜬다', () => {
    const a = stain('zone1', 0, 0);
    const b = stain('zone1', 3, 0);
    const list = [a, b];
    const n = createStainNotifier();
    expect(n.update(list, 'zone1', 0.5, 0)).toEqual(a); // a 0.5m, b 2.5m(범위 밖)
    expect(n.update(list, 'zone1', 2.2, 0)).toEqual(b); // a 2.2m(4m 안), b 0.8m
    expect(n.update(list, 'zone1', 0.5, 0)).toBeNull(); // a 는 내내 4m 안, b 도 2.5m
  });

  it('불러올 때도 line 을 200자로 자르고, 계약의 여섯 필드만 남긴다', () => {
    const long = 'z'.repeat(250);
    const raw = JSON.stringify([{ zone: 'zone1', x: 1, y: 2, z: 3, line: long, at: 5, extra: 'junk', hp: 9 }]);
    const out = loadStains(memStore({ [STAIN_KEY]: raw }));
    expect(out).toEqual([{ zone: 'zone1', x: 1, y: 2, z: 3, line: long.slice(0, 200), at: 5 }]);
    expect(Object.keys(out[0]).sort()).toEqual(['at', 'line', 'x', 'y', 'z', 'zone']);
  });
});
