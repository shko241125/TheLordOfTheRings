import { expect, test } from 'vitest';
import { BOSS_VOICES, musicLayers, pitchJitter, roomReverb } from '../src/audio/audio';
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

test('음악 3레이어: 디렉터가 조일수록 현악·북은 커지고 드론은 물러나며, 북이 없으면 현악도 없다', () => {
  const order = (['relax', 'buildup', 'warn', 'peak'] as const).map((p) => musicLayers(p, 90));
  for (let i = 1; i < order.length; i++) {
    expect(order[i]!.strings).toBeGreaterThan(order[i - 1]!.strings);
    expect(order[i]!.near).toBeGreaterThan(order[i - 1]!.near);
    expect(order[i]!.drone).toBeLessThanOrEqual(order[i - 1]!.drone);
  }
  expect(musicLayers('relax', 90).strings).toBe(0);
  expect(musicLayers('peak', 0).strings).toBe(0);
  expect(musicLayers('fade', 90).strings).toBeLessThan(musicLayers('buildup', 90).strings);
});

test('보스전: 북이 없어도 현악이 깔리고 금관이 들어오며 드론은 물러난다, 보스가 없으면 금관은 0', () => {
  for (const phase of ['relax', 'buildup', 'warn', 'peak', 'fade'] as const) {
    expect(musicLayers(phase, 90).brass).toBe(0);
    const b = musicLayers(phase, 0, 'troll');
    expect(b.brass).toBeGreaterThan(0);
    expect(b.strings).toBeGreaterThan(0);
    expect(b.drone).toBeLessThan(musicLayers(phase, 0).drone + 1e-9);
  }
  expect(musicLayers('peak', 90, 'troll').strings).toBe(musicLayers('peak', 90).strings); // 절정의 현악은 그대로
});

test('전투 소리는 음높이가 ±5% 안에서 흔들리고, 신호음·멜로디는 그대로다', () => {
  expect(pitchJitter('hit', 0)).toBeCloseTo(0.95);
  expect(pitchJitter('hit', 1)).toBeCloseTo(1.05);
  expect(pitchJitter('swing', 0.5)).toBe(1);
  for (const t of ['levelUp', 'pickup', 'parry', 'door', 'companion'] as const) expect(pitchJitter(t, 0)).toBe(1);
});

test('보스마다 금관 목소리가 다르다: 발로그가 가장 낮고 느리고 크다, 대장은 트롤보다 높고 빠르다', () => {
  const { troll, captain, balrog } = BOSS_VOICES;
  expect(balrog.root).toBeLessThan(troll.root);
  expect(balrog.swell).toBeLessThan(troll.swell);
  expect(musicLayers('relax', 0, 'balrog').brass).toBeGreaterThan(musicLayers('relax', 0, 'troll').brass);
  expect(captain.root).toBeGreaterThan(troll.root);
  expect(captain.swell).toBeGreaterThan(troll.swell);
  // 필터 흔들 폭(cutoff/2)이 cutoff보다 작아야 차단 주파수가 0 아래로 내려가지 않는다
  for (const v of Object.values(BOSS_VOICES)) expect(v.cutoff - v.cutoff / 2).toBeGreaterThan(v.root * 1.5);
});
