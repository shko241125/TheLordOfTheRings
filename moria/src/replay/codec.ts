import type { ClassId } from '../sim/classes';
import type { SimSnapshot } from '../sim/snapshot';
import type { InputFrame } from '../sim/types';

/**
 * 리플레이 파일 (계획서 M4 5번). 한 파일 = 머리말 + 체크포인트 스냅샷 + 그 뒤 입력.
 *   입력: 틱당 6바이트 [buttons u16][moveX i8][moveY i8][yaw u16] → 직전 틱과 XOR(델타) → 거의 0이라 deflate가 잘 줄인다
 *   전체: [u32 길이 + 머리말 JSON][u32 + 월드 스냅샷][u32 + 상태 JSON][입력] → CompressionStream('deflate-raw')
 * 머리말의 simVersion(빌드의 src/sim·src/core 해시)이 다르면 재생하지 않는다 (옛 규칙으로는 같은 결말이 안 나온다).
 */
export type ReplayHeader = {
  v: 1;
  simVersion: string;
  zone: 'zone1' | 'test';
  seed: number;
  classId: ClassId;
  /** 체크포인트 스냅샷의 틱 (입력은 이 틱부터) */
  fromTick: number;
  /** 재생을 보여 주기 시작할 틱 (보통 쓰러지기 60초 전) */
  showTick: number;
  /** 쓰러진 틱 */
  deathTick: number;
  /** 마자르불의 책 한 줄 */
  line: string;
};
export type Replay = { header: ReplayHeader; snapshot: SimSnapshot; inputs: InputFrame[] };

const BYTES = 6;

export function packInputs(frames: readonly InputFrame[]): Uint8Array {
  const out = new Uint8Array(frames.length * BYTES);
  const dv = new DataView(out.buffer);
  frames.forEach((f, i) => {
    const o = i * BYTES;
    dv.setUint16(o, f.buttons & 0xffff, true);
    dv.setInt8(o + 2, f.moveX);
    dv.setInt8(o + 3, f.moveY);
    dv.setUint16(o + 4, f.yaw & 0xffff, true);
  });
  for (let i = out.length - 1; i >= BYTES; i--) out[i]! ^= out[i - BYTES]!; // 델타 (뒤에서부터 — 원본을 읽기 전에 덮지 않게)
  return out;
}

export function unpackInputs(bytes: Uint8Array): InputFrame[] {
  const b = bytes.slice();
  for (let i = BYTES; i < b.length; i++) b[i]! ^= b[i - BYTES]!;
  const dv = new DataView(b.buffer);
  const out: InputFrame[] = [];
  for (let o = 0; o + BYTES <= b.length; o += BYTES) {
    out.push({ buttons: dv.getUint16(o, true), moveX: dv.getInt8(o + 2), moveY: dv.getInt8(o + 3), yaw: dv.getUint16(o + 4, true) });
  }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

async function pipe(bytes: Uint8Array, t: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(t);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function encodeReplay(r: Replay): Promise<Uint8Array> {
  const parts = [enc.encode(JSON.stringify(r.header)), r.snapshot.world, enc.encode(r.snapshot.state), packInputs(r.inputs)];
  const size = parts.reduce((n, p, i) => n + p.length + (i < 3 ? 4 : 0), 0);
  const raw = new Uint8Array(size);
  const dv = new DataView(raw.buffer);
  let o = 0;
  parts.forEach((p, i) => {
    if (i < 3) {
      dv.setUint32(o, p.length, true);
      o += 4;
    }
    raw.set(p, o);
    o += p.length;
  });
  return pipe(raw, new CompressionStream('deflate-raw'));
}

export async function decodeReplay(bytes: Uint8Array): Promise<Replay> {
  const raw = await pipe(bytes, new DecompressionStream('deflate-raw'));
  const dv = new DataView(raw.buffer);
  let o = 0;
  const next = () => {
    const n = dv.getUint32(o, true);
    const p = raw.subarray(o + 4, o + 4 + n);
    o += 4 + n;
    return p;
  };
  const header = JSON.parse(dec.decode(next())) as ReplayHeader;
  const world = next().slice();
  const state = dec.decode(next());
  return { header, snapshot: { world, state }, inputs: unpackInputs(raw.subarray(o)) };
}
