/**
 * 성능 예산 측정 (계획서 M5 1번): 구역마다 방 가운데에 서서 draw call·삼각형·켜진 광원·그림자 광원·시뮬레이션 틱을 잰다.
 * 개발 서버 + 개발 훅(__moria.perf). 품질 Low·High 각각. 결과는 마크다운 표로 찍는다 (FPS는 GPU 없는 환경이라 재지 않는다).
 *   node scripts/perf.mjs [webgpu|webgl] [zoneN]
 */
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const BACKEND = process.argv[2] === 'webgl' ? 'webgl' : 'webgpu';
const ZONES = process.argv[3] ? [process.argv[3]] : ['zone1', 'zone2', 'zone3', 'zone4', 'zone5'];
const QUALITIES = ['low', 'high'];
// 방 가운데로는 못 재는 장면 (다리 방 가운데는 용암 바닥이다). 다리 위 z −82는 추격 안전선(−80)을 넘어 발로그가 깨어난다
const SCENES = { zone5: [{ name: '발로그전 (다리 위)', x: 0, y: 0, z: -82 }] };
const BUDGET = { low: { draw: 100, lights: 16, shadows: 1 }, high: { draw: 300, lights: 64, shadows: 2 } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = await createServer({ server: { port: 5192, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600_000,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'],
});

const save = (zone) => JSON.stringify({
  v: 5, classId: 'human', zone, entry: null, progress: {}, growth: { level: 1, xp: 0, points: 0, skills: [] },
  gear: { inventory: [], equipped: [null, null, null, null, null, null], gold: 0, mithril: 0 }, pages: [],
});

const rows = [];
const errors = [];
for (const q of QUALITIES) {
  for (const zone of ZONES) {
    const p = await browser.newPage();
    await p.setViewport({ width: 1280, height: 720 });
    p.on('pageerror', (e) => errors.push(`${zone}/${q}: ${e.message}`));
    await p.goto('http://localhost:5192/', { waitUntil: 'load' });
    await p.evaluate((s) => localStorage.setItem('moria.save', s), save(zone));
    await p.goto(`http://localhost:5192/?quality=${q}${BACKEND === 'webgl' ? '&backend=webgl' : ''}`, { waitUntil: 'load' });
    await p.waitForFunction(() => window.__moria, { timeout: 500_000, polling: 2000 });
    const rooms = [
      ...(await p.evaluate(() => window.__moria.sim.level.rooms.map((r) => ({ name: r.name, x: (r.min[0] + r.max[0]) / 2, y: r.min[1], z: (r.min[2] + r.max[2]) / 2 })))),
      ...(SCENES[zone] ?? []),
    ];
    // 전투 장면에서도 끝까지 서 있도록 체력을 계속 채운다 (개발 측정 전용 — 결정론과 무관)
    await p.evaluate(() => setInterval(() => (window.__moria.sim.player.hp = window.__moria.sim.player.maxHp), 100));
    // 시작 화면을 눌러 게임을 돌린다 (틱이 흘러야 틱 시간이 쌓인다)
    await p.mouse.click(640, 360);
    for (const r of rooms) {
      // 매 측정 전에 방 가운데로 옮긴다 (용암·낭떠러지 위면 바닥이 없을 수 있다 — 그래도 보이는 것은 같다)
      await p.evaluate((r) => {
        const s = window.__moria.sim;
        s.player.body.setTranslation({ x: r.x, y: r.y + 1.5, z: r.z }, true);
      }, r);
      await sleep(1500);
      await p.evaluate(() => window.__moria.perf(true)); // 옮긴 직후(물리 넓은 단계 재구성 등)의 튐은 빼고 잰다
      await sleep(3000);
      const m = await p.evaluate(() => window.__moria.perf());
      rows.push({ q, zone, room: r.name, ...m });
      console.error(`${q} ${zone} ${r.name}: draw ${m.draw} lights ${m.lights} shadows ${m.shadows} tick ${m.tickAvg.toFixed(2)}/${m.tickP95.toFixed(2)}ms`);
    }
    await p.close();
  }
}
await browser.close();
await server.close();

const over = (r) => {
  const b = BUDGET[r.q];
  return [r.draw > b.draw && 'draw', r.lights > b.lights && 'lights', r.shadows > b.shadows && 'shadows', r.tickP95 > (r.q === 'low' ? 8 : 4) && 'tick'].filter(Boolean);
};
console.log(`\n백엔드 ${BACKEND}\n`);
console.log('| 품질 | 구역 | 방 | draw call | 삼각형 | 켜진 광원 | 그림자 광원 | 틱 평균/p95 (ms) | 초과 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const r of rows) {
  console.log(`| ${r.q} | ${r.zone} | ${r.room} | ${r.draw} | ${(r.tris / 1000).toFixed(0)}K | ${r.lights} | ${r.shadows} | ${r.tickAvg.toFixed(2)} / ${r.tickP95.toFixed(2)} | ${over(r).join(', ') || '—'} |`);
}
console.log(`\n페이지 오류 ${errors.length}${errors.length ? `\n${errors.join('\n')}` : ''}`);
process.exit(rows.some((r) => over(r).length) || errors.length ? 1 : 0);
