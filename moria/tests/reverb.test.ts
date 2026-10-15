import { expect, test } from 'vitest';
import { roomReverb } from '../src/audio/audio';
import { ZONES } from '../src/sim/zones';

test('잔향: 좁은 통로·계단은 마르고, 넓은 홀은 울린다', () => {
  const all = Object.values(ZONES).flatMap((z) => z.rooms ?? []);
  const by = (name: string) => roomReverb(all.find((r) => r.name === name)!);
  expect(by('거대 계단')).toBe(0);
  expect(by('북쪽 통로')).toBe(0);
  expect(by('서쪽 굴')).toBe(0);
  expect(by('기둥 홀')).toBe(1);
  expect(by('트롤 굴')).toBeGreaterThan(0.5);
  for (const r of all) expect(roomReverb(r)).toBeGreaterThanOrEqual(0);
});
