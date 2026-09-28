import { describe, expect, it } from 'vitest';
import { createFixedStep, MAX_STEPS_PER_FRAME } from '../src/core/loop';
import { createRng, streamSeed } from '../src/core/rng';
import { ANGLE_STEPS, dcos, dsin, radToAngle } from '../src/core/trig';

describe('rng', () => {
  it('같은 시드는 같은 수열, 다른 시드는 다른 수열', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const sa = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(sa);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it('mulberry32 기준값과 일치 (엔진이 바뀌어도 고정)', () => {
    const r = createRng(1);
    expect([r.next(), r.next(), r.next()]).toEqual([0.6270739405881613, 0.002735721180215478, 0.5274470399599522]);
  });

  it('스트림 시드는 이름마다 다르다', () => {
    expect(streamSeed(7, 'ai')).not.toBe(streamSeed(7, 'loot'));
    expect(streamSeed(7, 'ai')).toBe(streamSeed(7, 'ai'));
  });
});

describe('trig 표', () => {
  it('Math.sin과 1e-12 이내로 일치', () => {
    for (let a = 0; a < ANGLE_STEPS; a++) {
      const rad = (a / ANGLE_STEPS) * Math.PI * 2;
      expect(Math.abs(dsin(a) - Math.sin(rad))).toBeLessThan(1e-12);
      expect(Math.abs(dcos(a) - Math.cos(rad))).toBeLessThan(1e-12);
    }
  });

  it('정확한 사분점과 음수 각도 래핑', () => {
    expect(dsin(0)).toBe(0);
    expect(dsin(1024)).toBe(1);
    expect(dsin(2048)).toBe(0);
    expect(dsin(3072)).toBe(-1);
    expect(Object.is(dsin(2048), -0)).toBe(false);
    expect(dsin(-1024)).toBe(dsin(3072));
    expect(radToAngle(Math.PI / 2)).toBe(1024);
    expect(radToAngle(-Math.PI / 2)).toBe(3072);
  });
});

describe('고정 스텝 루프', () => {
  it('16.67ms마다 1틱, 누적 오차 없이 60틱/초', () => {
    const loop = createFixedStep();
    let total = 0;
    for (let i = 0; i < 600; i++) total += loop.advance(1000 / 60).steps;
    expect(total).toBeGreaterThanOrEqual(599);
    expect(total).toBeLessThanOrEqual(600);
  });

  it('144Hz 모니터에서는 틱이 없는 프레임이 생기고 alpha로 보간한다', () => {
    const loop = createFixedStep();
    const r = loop.advance(1000 / 144);
    expect(r.steps).toBe(0);
    expect(r.alpha).toBeGreaterThan(0);
    expect(r.alpha).toBeLessThan(1);
  });

  it('탭 복귀처럼 긴 공백은 최대 스텝에서 끊고 밀린 시간을 버린다', () => {
    const loop = createFixedStep();
    expect(loop.advance(5000).steps).toBe(MAX_STEPS_PER_FRAME);
    expect(loop.advance(1000 / 60).steps).toBe(1);
  });
});
