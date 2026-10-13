import type { Plugin } from 'vite';
import lore from '../data/lore.json';

/** 이름표대로 한 번에 바꾼다. 긴 이름부터 맞춰서 '두린의 재앙'이 '두린'보다 먼저 잡히고, 바뀐 결과를 다시 바꾸지 않는다 */
export function loreSwap(names: Record<string, string>): (s: string) => string {
  const keys = Object.keys(names).filter((k) => names[k] !== k).sort((a, b) => b.length - a.length);
  if (!keys.length) return (s) => s;
  const re = new RegExp(keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
  return (s) => s.replace(re, (m) => names[m]!);
}

/**
 * 고유명사 분리 (계획서 17장 IP 대응): data/lore.json의 값을 바꾸면 게임 코드·index.html의 이름이 빌드 때 바뀐다.
 * 시뮬레이션 버전 해시는 원본 파일로 계산하므로 이름만 바꾼 빌드에서도 옛 리플레이가 재생된다.
 * ponytail: 글자 그대로 바꾸기라 조사 받침·이미 저장된 장비 이름은 그대로 — 이름을 실제로 바꿀 때 문장을 한 번 훑을 것
 */
export function lorePlugin(): Plugin {
  const swap = loreSwap(lore.names);
  return {
    name: 'lore',
    enforce: 'pre',
    transform: (code, id) => (/[\\/]src[\\/].*\.ts$/.test(id) ? { code: swap(code), map: null } : undefined),
    transformIndexHtml: swap,
  };
}
