/**
 * 스모크 테스트 (계획서 M5 7번): 실제 브라우저에서 부팅 → 새 게임 → 이동 → 저장 → 새로고침 → 이어하기, 콘솔 에러 0.
 *   A. 배포 빌드(vite build + preview): 부팅·이동·콘솔 에러 0 — 개발 훅이 없으므로 키 입력과 화면 문구만 본다
 *   B. 개발 서버: 전 과정 — 조작은 전부 키 입력, 개발 훅(__moria)은 위치를 '읽기'만 한다
 * 각각 WebGPU와 WebGL2(?backend=webgl)로. 실패하면 종료 코드 1.
 * 브라우저: CHROME_PATH (기본 /usr/bin/google-chrome). GPU가 없으면 SwiftShader로 돈다 (느리지만 동작한다).
 *   npm run smoke
 */
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { createServer, preview } from 'vite';

const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const IGNORE = [/GL Driver Message/, /software WebGL/, /WebGPU is not available/];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'],
});

async function page() {
  const p = await browser.newPage();
  await p.setViewport({ width: 960, height: 600 });
  const errors = [];
  p.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warn') if (!IGNORE.some((r) => r.test(m.text()))) errors.push(m.text());
  });
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { p, errors };
}

const ready = (p) => p.waitForFunction(() => document.getElementById('start').textContent.includes('클릭해서') || getComputedStyle(document.getElementById('error')).display !== 'none', { timeout: 180_000 });
/** 개발 서버: 조작 안내는 부팅 중간에, 개발 훅(__moria)은 부팅 맨 끝(예열 뒤)에 생긴다 → 훅까지 기다린다 */
const devReady = (p) => p.waitForFunction(() => '__moria' in window || getComputedStyle(document.getElementById('error')).display !== 'none', { timeout: 180_000 });
const bootError = (p) => p.evaluate(() => (getComputedStyle(document.getElementById('error')).display !== 'none' ? document.getElementById('error').textContent.slice(0, 300) : null));

// 환경 격리: Vite의 build·createServer는 같은 프로세스의 NODE_ENV를 서로 바꿔 놓는다
//   build 먼저 → 뒤의 개발 서버에 개발 훅이 없다 / 개발 서버 먼저 → 뒤의 빌드에 개발 도구가 들어간다 (둘 다 이 스크립트에서 실제로 겪었다)
// → 빌드는 별도 프로세스(npm run build와 같은 조건)로, 개발 서버는 이 프로세스에서
// ---------- B. 개발 서버: 새 게임 → 문 → 화로 저장 → 새로고침 → 이어하기 ----------
const dev = await createServer({ server: { port: 5180, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
await dev.listen();
const pos = (p) => p.evaluate(() => { const t = window.__moria.sim.player.body.translation(); return { x: t.x, y: t.y, z: t.z }; });
/** 카메라를 목표로 돌리고(마우스와 같은 입력) W를 누른 채 가까워질 때까지 */
async function walkTo(p, tx, tz, within, timeout = 120_000) {
  const t0 = Date.now();
  await p.keyboard.down('KeyW');
  try {
    for (;;) {
      const me = await pos(p);
      const d = Math.hypot(tx - me.x, tz - me.z);
      if (d < within) return true;
      if (Date.now() - t0 > timeout) return false;
      await p.evaluate((yaw) => (window.__moria.input.view.yaw = yaw), Math.atan2(-(tx - me.x), -(tz - me.z)));
      await sleep(150);
    }
  } finally {
    await p.keyboard.up('KeyW');
  }
}
for (const backend of ['webgpu', 'webgl']) {
  const { p, errors } = await page();
  const q = `quality=low${backend === 'webgl' ? '&backend=webgl' : ''}`;
  await p.goto(`http://127.0.0.1:5180/?new=1&${q}`);
  await devReady(p);
  const err = await bootError(p);
  check(`[dev/${backend}] 부팅`, !err, err ?? '');
  if (err) continue;
  await p.evaluate(() => (document.getElementById('start').style.display = 'none'));
  check(`[dev/${backend}] 문 앞까지 걷기`, await walkTo(p, 0, 43, 1.5));
  await p.keyboard.press('KeyE');
  await sleep(500);
  await p.type('#durin-in', 'mellon');
  await p.keyboard.press('Enter');
  const opened = await p.waitForFunction(() => window.__moria.sim.doors[0].open, { timeout: 60_000 }).then(() => true, () => false);
  check(`[dev/${backend}] 두린의 문 (mellon)`, opened);
  await sleep(1500);
  // 화로(−5, 32) 받침 앞. 상호작용 거리 2.2m 안에 확실히 들도록 목표 1.2m 앞, 허용 0.6m (처음 허용 1.4m는 최대 2.8m까지 떨어져 E가 닿지 않았다)
  check(`[dev/${backend}] 화로까지 걷기`, await walkTo(p, -5, 33.2, 0.6));
  await sleep(500);
  await p.keyboard.press('KeyE');
  const saved = await p.waitForFunction(() => JSON.parse(localStorage.getItem('moria.save') ?? 'null')?.progress?.zone1?.checkpoint === 0 /* 저장 v3: 구역별 진행 상태 */, { timeout: 60_000 }).then(() => true, () => false);
  check(`[dev/${backend}] 화로에서 저장`, saved);
  await p.goto(`http://127.0.0.1:5180/?${q}`);
  await devReady(p);
  const cont = await p.evaluate(() => { const s = window.__moria.sim; const t = s.player.body.translation(); return { cp: s.checkpoint, door: s.doors[0].open, d: Math.hypot(t.x + 5, t.z - 33.5) }; });
  check(`[dev/${backend}] 새로고침 → 화로에서 이어하기`, cont.cp === 0 && cont.door && cont.d < 1, JSON.stringify(cont));
  check(`[dev/${backend}] 콘솔 에러 0`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}
// 모바일(터치) — 가로 844×390 에뮬레이션: 왼쪽을 끌어 걷고, 공격 버튼을 탭한다
{
  const { p, errors } = await page();
  await p.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, isLandscape: true });
  await p.goto('http://127.0.0.1:5180/?new=1&quality=low&touch=1');
  await devReady(p);
  await p.touchscreen.tap(422, 40); // 시작 화면 닫기
  await sleep(500);
  const z0 = (await pos(p)).z;
  await p.touchscreen.touchStart(150, 280);
  await p.touchscreen.touchMove(150, 250);
  await p.touchscreen.touchMove(150, 215);
  await sleep(3000);
  await p.touchscreen.touchEnd();
  const walked = z0 - (await pos(p)).z;
  check('[dev/touch] 가상 조이스틱으로 걷기', walked > 2, `${walked.toFixed(1)}m`);
  await p.touchscreen.tap(844 - 90, 390 - 110);
  await sleep(150);
  check('[dev/touch] 공격 버튼', (await p.evaluate(() => window.__moria.sim.player.action)) === 'attack');
  check('[dev/touch] 콘솔 에러 0', errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}
await dev.close();
// ---------- A. 배포 빌드 ----------
execFileSync('npx', ['vite', 'build', '--logLevel', 'warn'], { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
const prev = await preview({ preview: { port: 4180, strictPort: true, host: '127.0.0.1' }, logLevel: 'warn' });
for (const backend of ['webgpu', 'webgl']) {
  const { p, errors } = await page();
  await p.goto(`http://127.0.0.1:4180/?new=1&quality=low${backend === 'webgl' ? '&backend=webgl' : ''}`);
  await ready(p);
  const err = await bootError(p);
  check(`[build/${backend}] 부팅`, !err, err ?? '');
  await p.evaluate(() => (document.getElementById('start').style.display = 'none'));
  await p.keyboard.down('KeyW');
  await sleep(3000);
  await p.keyboard.up('KeyW');
  await sleep(1000);
  check(`[build/${backend}] 개발 도구 없음`, await p.evaluate(() => !('__moria' in window)));
  check(`[build/${backend}] 콘솔 에러 0`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await p.close();
}
// 브라우저의 keep-alive 연결이 남아 있으면 close()가 끝나지 않는다 (모든 검사가 통과한 뒤 멈춘 적이 있다) → 연결부터 끊는다
prev.httpServer.closeAllConnections?.();
await new Promise((r) => prev.httpServer.close(r));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
