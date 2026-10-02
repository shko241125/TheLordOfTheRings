/**
 * 마자르불의 책 (계획서 6장 F — Hades식 '죽음 = 진행'). 쓰러질 때마다 발린 원정대 기록 문체로 한 줄을 남긴다.
 * 템플릿 × (쓰러뜨린 것·장소·종족) 치환. 같은 죽음이면 같은 문장이 나오도록 틱으로 고른다.
 * 계획서는 템플릿 40종 — 지금은 16종 (M4 발로그 구역과 함께 늘린다).
 */
export type Killer = 'goblin' | 'troll' | 'collapse' | 'lava' | 'balrog' | 'fire' | 'unknown';

const WHO: Record<Killer, string> = {
  goblin: '고블린들', troll: '동굴 트롤', collapse: '무너진 돌기둥', lava: '깊은 곳의 불', balrog: '두린의 재앙', fire: '뒤쫓아 온 불길', unknown: '어둠 속의 무언가',
};
const RACE = { human: '사람', dwarf: '드워프', elf: '요정' } as const;

const TEMPLATES = [
  '{place}에서 {who}에게 쓰러졌다. 횃불이 꺼지기 전에 이것만은 적는다.',
  '우리는 {place|을} 지키지 못했다. {who|이} 왔다.',
  '{race} 하나가 {place}에 남았다. {who|이} 먼저 닿았다.',
  '북소리. 북소리. {place}에서 {who|을} 보았다.',
  '{who|은} 어둠에서 왔다. {place}의 빛은 너무 작았다.',
  '{place}에서 적는다. {who|을} 막을 수 없었다. 문은 닫혔다.',
  '다시는 {place|을} 지나지 않으리라. {who|이} 거기 있다.',
  '{race}의 발자국이 {place}에서 끊긴다. {who}.',
  '마지막 기록: {place}. {who}. 그들이 온다.',
  '{place}의 돌이 기억할 것이다. {who}에게 진 {race|을}.',
  '횃불 하나, 칼 하나. {place}에서 {who|을} 만났다.',
  '우리는 {place}에서 길을 잃었다. {who|이} 길을 찾았다.',
  '{who}의 그림자가 {place|을} 덮었다. 여기까지다.',
  '{place}. 발소리가 멎었다. {who}.',
  '누군가 이 책을 찾는다면: {place|을} 조심하라. {who|이} 있다.',
  '{race|은} 쓰러졌으나 책은 남는다. {place}, {who}.',
] as const;

/** 받침이 있으면 앞 조사(이·은·을·과), 없으면 뒤 조사(가·는·를·와). 한글이 아니면 받침 있음으로 본다 */
const PAIRS: Record<string, string> = { 이: '가', 은: '는', 을: '를', 과: '와' };
export function josa(word: string, withBatchim: string): string {
  const c = word.charCodeAt(word.length - 1);
  const batchim = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : true;
  return word + (batchim ? withBatchim : PAIRS[withBatchim]!);
}

export function deathLine(tick: number, killer: Killer, place: string, classId: keyof typeof RACE): string {
  const t = TEMPLATES[tick % TEMPLATES.length]!;
  const words: Record<string, string> = { who: WHO[killer], place: place || '모리아의 어둠', race: RACE[classId] };
  // {who|이} → '고블린들이' / '무언가가' — 받침에 맞는 조사
  return t.replace(/\{(who|place|race)(?:\|(이|은|을|과))?\}/g, (_m, k: string, j?: string) => (j ? josa(words[k]!, j) : words[k]!));
}

const KEY = 'moria.book';
const MAX = 60;

/** 책에 한 줄 더한다 (최근 MAX줄). 저장소가 막혀 있으면 조용히 넘어간다 */
export function addToBook(line: string): string[] {
  try {
    const book = [...readBook(), line].slice(-MAX);
    localStorage.setItem(KEY, JSON.stringify(book));
    return book;
  } catch {
    return [line];
  }
}

export function readBook(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
