import RAPIER from '@dimforge/rapier3d-compat';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BOOK_EXT, BOOK_MAGIC, bookFileName, checkBookReplay, inflatedSizeWithin, MAX_BOOK_BYTES, unwrapBook, wrapBook } from '../src/replay/bookfile';
import { decodeReplay, encodeReplay, type ReplayHeader } from '../src/replay/codec';
import { createRecorder } from '../src/replay/recorder';
import { TEST_ROOM } from '../src/sim/level';
import { scriptedInputs } from '../src/sim/scripted';
import { createSim, disposeSim, stepSim } from '../src/sim/sim';

/** O 책 파일: 마자르불의 책을 파일로 내보내고 가져오기 (머리 8바이트 + 리플레이 바이트) */
const MAGIC = [0x4d, 0x4f, 0x52, 0x49, 0x41, 0x42, 0x4b, 0x01]; // "MORIABK" + 0x01

/** 결정적인 임의 바이트 (첫 바이트를 'M'이 아니게 해서 우연히 머리처럼 보이지 않게) */
function bytes(n: number, seed = 1): Uint8Array {
  const a = new Uint8Array(n);
  let s = seed;
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    a[i] = s >>> 24;
  }
  if (n > 0) a[0] = 0x00;
  return a;
}

function withHeader(total: number, version = 0x01): Uint8Array {
  const a = new Uint8Array(total);
  a.set(MAGIC.slice(0, Math.min(8, total)));
  if (total >= 8) a[7] = version;
  return a;
}

/** 짧은 실제 기록으로 만든 encodeReplay 출력 (여러 테스트가 나눠 쓴다) */
let real: Promise<{ raw: Uint8Array; header: ReplayHeader; inputCount: number }> | undefined;
function realReplay() {
  real ??= (async () => {
    const sim = createSim(TEST_ROOM, 5);
    const rec = createRecorder(sim);
    for (const f of scriptedInputs(5, 600)) {
      rec.record(sim, f);
      stepSim(sim, f);
      sim.events.length = 0;
    }
    const clip = rec.clip(sim.tick);
    const header: ReplayHeader = { v: 2, simVersion: __SIM_VERSION__, zone: 'test', seed: 5, classId: 'human', fromTick: clip.fromTick, showTick: clip.showTick, deathTick: sim.tick, line: '책 시험' };
    const raw = await encodeReplay({ header, snapshot: clip.snapshot, inputs: clip.inputs });
    disposeSim(sim);
    return { raw, header, inputCount: clip.inputs.length };
  })();
  return real;
}

async function pump(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const through = (b: Uint8Array, t: TransformStream<BufferSource, Uint8Array>) => pump(new Blob([b as BlobPart]).stream().pipeThrough(t));

/** 코덱이 쓰는 압축 형식을 공개 동작만으로 알아낸다: 실제 출력이 풀리는 형식, 그리고 풀린 크기 */
async function codecFormat(raw: Uint8Array): Promise<{ format: CompressionFormat; inflated: number }> {
  for (const format of ['deflate-raw', 'deflate', 'gzip'] as CompressionFormat[]) {
    try {
      const out = await through(raw, new DecompressionStream(format));
      return { format, inflated: out.length };
    } catch {
      /* 다음 형식 */
    }
  }
  throw new Error('encodeReplay 출력이 어느 압축 형식으로도 풀리지 않는다');
}

// Node 타입 없이(tsconfig는 vite/client만) process.env에 닿는다
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
let savedTz: string | undefined;
beforeAll(async () => {
  await RAPIER.init();
  // 지역 시간 ≠ UTC 인 시간대로 고정: UTC 필드를 쓰면 OT4가 잡는다
  savedTz = env.TZ;
  env.TZ = 'Asia/Seoul';
});
afterAll(() => {
  if (savedTz === undefined) delete env.TZ;
  else env.TZ = savedTz;
});

describe('책 파일', () => {
  it('OT1 상수와 wrapBook/unwrapBook 왕복: 머리 8바이트, 길이 +8, 입력은 그대로', () => {
    expect(BOOK_MAGIC).toBeInstanceOf(Uint8Array);
    expect(Array.from(BOOK_MAGIC)).toEqual(MAGIC);
    expect(BOOK_EXT).toBe('.moriabook');
    expect(MAX_BOOK_BYTES).toBe(4 * 1024 * 1024);

    for (const n of [0, 1, 7, 8, 1000]) {
      const x = bytes(n, n + 3);
      const copy = Uint8Array.from(x);
      const w = wrapBook(x);
      expect(w).toBeInstanceOf(Uint8Array);
      expect(w.length).toBe(n + 8);
      expect(Array.from(w.subarray(0, 8))).toEqual(MAGIC);
      expect(Array.from(w.subarray(8))).toEqual(Array.from(x));
      expect(w).not.toBe(x);
      expect(Array.from(x)).toEqual(Array.from(copy)); // 입력 안 건드림
      // 새 배열: 결과를 고쳐도 입력은 그대로
      if (n > 0) {
        w[8] ^= 0xff;
        expect(x[0]).toBe(copy[0]);
      }

      const fresh = wrapBook(x);
      const freshCopy = Uint8Array.from(fresh);
      const r = unwrapBook(fresh);
      expect(r.ok).toBe(true);
      if (!r.ok) throw new Error('unreachable');
      expect(r.replay).toBeInstanceOf(Uint8Array);
      expect(r.replay.length).toBe(n);
      expect(Array.from(r.replay)).toEqual(Array.from(x));
      expect(Array.from(fresh)).toEqual(Array.from(freshCopy)); // unwrap도 입력 안 건드림
    }
  });

  it('OT2 거절: 빈 파일, 4MiB 초과(딱 4MiB는 통과), 머리보다 짧음, 머리 불일치, 모르는 판 번호', () => {
    expect(unwrapBook(new Uint8Array(0))).toEqual({ ok: false, error: 'empty' });

    // 크기 경계: 올바른 머리라도 MAX+1은 too-big, 딱 MAX는 ok
    expect(unwrapBook(withHeader(MAX_BOOK_BYTES + 1))).toEqual({ ok: false, error: 'too-big' });
    const atMax = withHeader(MAX_BOOK_BYTES);
    atMax[MAX_BOOK_BYTES - 1] = 0x5a;
    const okMax = unwrapBook(atMax);
    expect(okMax.ok).toBe(true);
    if (!okMax.ok) throw new Error('unreachable');
    expect(okMax.replay.length).toBe(MAX_BOOK_BYTES - 8);
    expect(okMax.replay[MAX_BOOK_BYTES - 9]).toBe(0x5a);

    // 머리보다 짧음 → magic (머리 앞부분이 맞아도)
    expect(unwrapBook(new Uint8Array([1, 2, 3, 4, 5]))).toEqual({ ok: false, error: 'magic' });
    for (let n = 1; n < 8; n++) {
      expect(unwrapBook(withHeader(n))).toEqual({ ok: false, error: 'magic' });
    }

    // 머리 7바이트 중 어느 하나라도 틀리면 magic
    for (let i = 0; i < 7; i++) {
      const bad = withHeader(20);
      bad[i] ^= 0x20; // 'M'→'m' 등
      expect(unwrapBook(bad)).toEqual({ ok: false, error: 'magic' });
    }
    expect(unwrapBook(bytes(64))).toEqual({ ok: false, error: 'magic' });

    // 머리는 맞고 판 번호가 다르면 version
    for (const v of [0x02, 0x00, 0xff]) {
      expect(unwrapBook(withHeader(20, v))).toEqual({ ok: false, error: 'version' });
    }
  });

  it('OT3 실제 리플레이가 책으로 감쌌다 풀어도 그대로 해독된다', async () => {
    const { raw, header, inputCount } = await realReplay();

    const book = wrapBook(raw);
    expect(book.length).toBe(raw.length + 8);
    const r = unwrapBook(book);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(Array.from(r.replay)).toEqual(Array.from(raw));
    const back = await decodeReplay(r.replay);
    expect(back.header).toEqual(header);
    expect(back.inputs.length).toBe(inputCount);
  }, 120_000);

  it('OT4 bookFileName: 지역 시간, 0 채움, 위험한 구역 글자는 -', () => {
    expect(bookFileName('zone1', new Date(2026, 0, 5, 7, 3))).toBe('moria-book-zone1-20260105-0703.moriabook');
    expect(bookFileName('zone1', new Date(2026, 11, 31, 23, 59))).toBe('moria-book-zone1-20261231-2359.moriabook');
    // 지역 자정 직후: UTC로는 전날(전해)이 된다
    expect(bookFileName('zone2', new Date(2027, 0, 1, 0, 5))).toBe('moria-book-zone2-20270101-0005.moriabook');
    expect(bookFileName('zone3', new Date(2026, 8, 9, 9, 9))).toBe('moria-book-zone3-20260909-0909.moriabook');

    const at = new Date(2026, 0, 5, 7, 3);
    expect(bookFileName('Zone1', at)).toBe('moria-book-zone1-20260105-0703.moriabook');
    expect(bookFileName('a_b-c9', at)).toBe('moria-book-a_b-c9-20260105-0703.moriabook');
    expect(bookFileName('Zone 1/../x.y', at)).toBe('moria-book-zone-1----x-y-20260105-0703.moriabook');
    expect(bookFileName('모리아', at)).toBe('moria-book-----20260105-0703.moriabook');
    // 서로게이트 쌍(UTF-16 두 단위) → '-' 두 개
    expect(bookFileName('a\u{1F525}b', at)).toBe('moria-book-a--b-20260105-0703.moriabook');
  });

  it('OT2b 검사 순서: 머리가 틀려도 MAX+1이면 too-big, 둘 다 틀리면 magic', () => {
    const big = new Uint8Array(MAX_BOOK_BYTES + 1); // 0으로 찬 = 틀린 머리
    expect(unwrapBook(big)).toEqual({ ok: false, error: 'too-big' });
    const both = withHeader(20, 0x02);
    both[0] = 0x00;
    expect(unwrapBook(both)).toEqual({ ok: false, error: 'magic' });
  });

  it('OT5 inflatedSizeWithin: 넉넉하면 true, 예산 초과·손상된 흐름·압축 폭탄은 false', async () => {
    const { raw } = await realReplay();
    const { format, inflated } = await codecFormat(raw);
    expect(await inflatedSizeWithin(raw, 64 * 1024 * 1024)).toBe(true);
    expect(await inflatedSizeWithin(raw, inflated)).toBe(true); // 딱 맞는 예산은 통과
    expect(await inflatedSizeWithin(raw, inflated - 1)).toBe(false);
    expect(await inflatedSizeWithin(raw, 16)).toBe(false);
    expect(await inflatedSizeWithin(bytes(4096, 9), 64 * 1024 * 1024)).toBe(false);
    // 잘린 흐름도 손상
    expect(await inflatedSizeWithin(raw.subarray(0, Math.floor(raw.length / 2)), 64 * 1024 * 1024)).toBe(false);

    // 압축 폭탄: 8MiB 0을 같은 형식으로 압축하면 몇 KB
    const bombSize = 8 * 1024 * 1024;
    const bomb = await through(new Uint8Array(bombSize), new CompressionStream(format));
    expect(bomb.length).toBeLessThan(64 * 1024);
    expect(await inflatedSizeWithin(bomb, 1024 * 1024)).toBe(false);
    expect(await inflatedSizeWithin(bomb, bombSize)).toBe(true);
  }, 120_000);

  it('OT6 checkBookReplay: 올바르면 true, 규칙 하나만 어겨도 문자열', () => {
    const known = { zones: ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'], classes: ['human', 'dwarf', 'elf'] };
    const base: ReplayHeader = { v: 2, simVersion: 'x', zone: 'zone1', seed: 1, classId: 'dwarf', fromTick: 600, showTick: 700, deathTick: 900, line: '쓰러졌다' };
    const inputs = (n: number) => new Array<unknown>(n).fill(0);
    const check = (h: Partial<Record<keyof ReplayHeader, unknown>>, n = 300) => checkBookReplay({ header: { ...base, ...h } as unknown as ReplayHeader, inputs: inputs(n) }, known);
    const bad = (h: Partial<Record<keyof ReplayHeader, unknown>>, n = 300) => {
      const r = check(h, n);
      expect(r, JSON.stringify(h) + ' n=' + n).not.toBe(true);
      expect(typeof r).toBe('string');
    };

    expect(check({})).toBe(true);
    expect(check({ v: 1 })).toBe(true);
    expect(check({ zone: 'test' })).toBe(true);
    expect(check({ zone: 'zone5', classId: 'elf' })).toBe(true);
    expect(check({ fromTick: 0, showTick: 0, deathTick: 0 }, 0)).toBe(true); // 0 ≤ 같음 허용
    expect(check({}, 100)).toBe(true); // inputs.length == showTick − fromTick

    bad({ v: 3 });
    bad({ v: 0 });
    bad({ zone: 'zone9' });
    bad({ zone: 'Zone1' });
    bad({ classId: 'wizard' });
    bad({ line: 5 });
    bad({ line: undefined });
    bad({ fromTick: -1 });
    bad({ showTick: 599 }); // showTick < fromTick
    bad({ deathTick: 699 }); // deathTick < showTick
    bad({ fromTick: 600.5 });
    bad({ showTick: 700.5 });
    bad({ deathTick: 900.5 });
    bad({ fromTick: Number.NaN });
    bad({ deathTick: Number.POSITIVE_INFINITY });
    bad({ fromTick: '600' });
    bad({}, 99); // 입력이 구간보다 짧음

    // 구간 한도 7200틱 (2분): 딱 7200은 통과, 7201은 거절
    expect(check({ fromTick: 0, showTick: 7200, deathTick: 7300 }, 7200)).toBe(true);
    bad({ fromTick: 0, showTick: 7201, deathTick: 7300 }, 7201);
  });
});
