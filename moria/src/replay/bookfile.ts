/**
 * 책 파일: 리플레이 바이트 앞에 8바이트 머리("MORIABK" + 판 번호 1)를 붙인 공유용 파일. DOM 없음.
 * 남이 만든 파일이므로 믿지 않는다: 크기 → 머리 → 압축 풀린 크기 → (해독 뒤) 머리말 내용 순으로 거른다.
 */
import type { ReplayHeader } from './codec';


export const BOOK_MAGIC = new Uint8Array([0x4d, 0x4f, 0x52, 0x49, 0x41, 0x42, 0x4b, 0x01]);
export const BOOK_EXT = '.moriabook';
export const MAX_BOOK_BYTES = 4 * 1024 * 1024;
/** 압축을 푼 리플레이의 상한 (압축 폭탄 막기) */
export const MAX_REPLAY_INFLATED = 64 * 1024 * 1024;
/** 보여 줄 구간(showTick − fromTick)의 상한: 60Hz로 2분 */
export const MAX_REPLAY_SPAN_TICKS = 7200;

export type BookError = 'empty' | 'too-big' | 'magic' | 'version';
export type UnwrapResult = { ok: true; replay: Uint8Array } | { ok: false; error: BookError };

export function wrapBook(replayBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(BOOK_MAGIC.length + replayBytes.length);
  out.set(BOOK_MAGIC);
  out.set(replayBytes, BOOK_MAGIC.length);
  return out;
}

/** 검사 순서: empty → too-big → magic(짧음 또는 앞 7바이트 불일치) → version. 판이 다른 시뮬 빌드는 여기서 거르지 않는다. */
export function unwrapBook(fileBytes: Uint8Array): UnwrapResult {
  if (fileBytes.length === 0) return { ok: false, error: 'empty' };
  if (fileBytes.length > MAX_BOOK_BYTES) return { ok: false, error: 'too-big' };
  if (fileBytes.length < BOOK_MAGIC.length) return { ok: false, error: 'magic' };
  for (let i = 0; i < 7; i++) if (fileBytes[i] !== BOOK_MAGIC[i]) return { ok: false, error: 'magic' };
  if (fileBytes[7] !== BOOK_MAGIC[7]) return { ok: false, error: 'version' };
  return { ok: true, replay: fileBytes.subarray(BOOK_MAGIC.length) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** moria-book-<zone>-<YYYYMMDD>-<HHMM>.moriabook (지역 시간). zone은 소문자로 바꾼 뒤 [a-z0-9_-] 밖의 글자를 '-'로. */
export function bookFileName(zone: string, at: Date): string {
  const z = zone.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const date = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `moria-book-${z}-${date}-${time}${BOOK_EXT}`;
}

/** codec.ts와 같은 'deflate-raw'를 흘려 풀며 크기만 센다. budget을 넘는 순간 멈추고 false. 깨진 스트림도 false. */
export async function inflatedSizeWithin(replay: Uint8Array, budget: number): Promise<boolean> {
  const reader = new Blob([replay as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      total += value.length;
      if (total > budget) {
        void reader.cancel().catch(() => {});
        return false;
      }
    }
  } catch {
    return false;
  }
}

/** 해독한 리플레이의 머리말이 말이 되는지 (순수). true 또는 오류 코드 */
export function checkBookReplay(
  r: { header: ReplayHeader; inputs: unknown[] },
  known: { zones: readonly string[]; classes: readonly string[] },
): true | string {
  const h = r.header;
  if (h.v !== 1 && h.v !== 2) return 'v';
  if (h.zone !== 'test' && !known.zones.includes(h.zone)) return 'zone';
  if (!known.classes.includes(h.classId)) return 'class';
  if (typeof h.line !== 'string') return 'line';
  const { fromTick: from, showTick: show, deathTick: death } = h;
  if (![from, show, death].every(Number.isInteger) || !(0 <= from && from <= show && show <= death)) return 'ticks';
  if (show - from > MAX_REPLAY_SPAN_TICKS) return 'span';
  if (!Array.isArray(r.inputs) || r.inputs.length < show - from) return 'inputs';
  return true;
}
