import { afterEach, expect, test, vi } from 'vitest';
import { exportSave, importSave, loadSave } from '../src/save';

// 브라우저 저장소 흉내 (Node에는 localStorage가 없다)
function fakeStorage() {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => m.set(k, v), removeItem: (k: string) => m.delete(k) });
  return m;
}
afterEach(() => vi.unstubAllGlobals());

const v4 = { v: 4, classId: 'dwarf', zone: 'zone2', entry: null, progress: {}, growth: { level: 3, xp: 10, points: 1, skills: [0] }, gear: { inventory: [], equipped: [null, null, null, null, null, null], gold: 40, mithril: 0, draughts: 2 } };

test('내보낸 저장을 가져오면 같은 저장이 된다 (옛 버전은 올려서)', () => {
  fakeStorage();
  expect(exportSave()).toBeNull();
  expect(importSave(JSON.stringify(v4))).toBe(true);
  const a = loadSave()!;
  expect(a).toMatchObject({ v: 5, classId: 'dwarf', zone: 'zone2', pages: [], gear: { gold: 40, draughts: 2 } });
  const file = exportSave()!;
  fakeStorage(); // 브라우저 데이터를 지운 뒤
  expect(importSave(file)).toBe(true);
  expect(loadSave()).toEqual(a);
});

test('저장 파일이 아니면 지금 저장을 건드리지 않는다', () => {
  const m = fakeStorage();
  importSave(JSON.stringify(v4));
  const before = m.get('moria.save');
  for (const bad of ['', '{', 'null', '{"v":5}', JSON.stringify({ ...v4, classId: 'orc' })]) expect(importSave(bad)).toBe(false);
  expect(m.get('moria.save')).toBe(before);
});
