import { describe, expect, it } from 'vitest';
import { checkAnswer, editDistance } from '../src/core/riddle';

describe('두린의 문 수수께끼', () => {
  it('정답과 흔한 오타·변형은 통과', () => {
    for (const s of ['mellon', 'Mellon!', ' MELLON ', 'melon', 'mellom', 'friend', 'Friend.', 'frend', '친구', '벗', '멜론', 'ｍｅｌｌｏｎ']) expect(checkAnswer(s), s).toBe(true);
  });
  it('빈 입력·짧은 헛답·다른 단어는 실패 (두 글자 답에 거리 2를 주면 생기는 구멍)', () => {
    for (const s of ['', '  ', 'ab', '친', '친척', '벚', '벗님', '구', 'hello', 'moria', 'mel', 'open', '열려라']) expect(checkAnswer(s), s).toBe(false);
  });
  it('편집 거리', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
    expect(editDistance('친구', '친척')).toBe(1);
  });
});
