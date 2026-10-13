import { describe, expect, it } from 'vitest';
import lore from '../data/lore.json';
import html from '../index.html?raw';
import { loreSwap } from '../scripts/lore';

/** 고유명사 분리 (계획서 17장): 이름표가 실제 이름을 빠짐없이 가리키고, 바꾸기가 긴 이름부터 한 번만 일어난다 */
describe('lore', () => {
  it('긴 이름 먼저, 바뀐 결과는 다시 안 바꾼다, 같은 값은 그대로', () => {
    const swap = loreSwap({ 두린: 'A', '두린의 재앙': '불꽃 악마', A: 'B', 발로그: '발로그' });
    expect(swap('두린의 재앙이 두린의 다리에, A와 발로그')).toBe('불꽃 악마이 A의 다리에, B와 발로그');
    expect(loreSwap({ 모리아: '모리아' })('모리아')).toBe('모리아');
  });

  it('lore.json의 이름은 모두 게임 코드에 있다 (오래된 항목이 남지 않게)', () => {
    // ?raw는 원본 그대로다 (lore 플러그인은 .ts로 끝나는 id만 바꾼다)
    const src = Object.values(import.meta.glob<string>('../src/**/*.ts', { query: '?raw', import: 'default', eager: true }));
    const all = src.join('\n') + html;
    expect(src.length).toBeGreaterThan(50);
    expect(Object.keys(lore.names).filter((n) => !all.includes(n))).toEqual([]);
  });
});
