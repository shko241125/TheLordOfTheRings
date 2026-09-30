import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * 시뮬레이션 버전 = src/sim·src/core 파일 내용의 해시. 리플레이는 이 값이 같을 때만 재생한다
 * (계획서 F: "빌드 해시가 다르면 영상 대신 요약") — 렌더·UI만 바꾼 빌드에서는 옛 리플레이가 그대로 재생된다.
 */
function simVersion(): string {
  const h = createHash('sha1');
  for (const dir of ['src/sim', 'src/core']) {
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()) h.update(f).update(readFileSync(join(dir, f)));
  }
  return h.digest('hex').slice(0, 12);
}

export default defineConfig({
  define: { __SIM_VERSION__: JSON.stringify(simVersion()) },
  server: {
    // WSL에서 /mnt/c(Windows 드라이브)는 inotify가 동작하지 않아 파일 변경을 못 잡는다 → 폴링
    watch: { usePolling: true, interval: 300 },
  },
  build: {
    target: 'es2022',
    // three/webgpu + Rapier(base64 WASM)만으로 1MB를 넘는다. 구역 코드 스플리팅은 M2에서.
    chunkSizeWarningLimit: 2500,
  },
  test: {
    // 시뮬레이션마다 내비메시를 굽는다(구역 1 ≈ 0.5초). 파일이 병렬로 돌면 CPU를 나눠 쓰느라 기본 5초를 넘긴 적이 있다
    // (전투·이동 테스트에서 두 번 — 부하 때문이지 논리 문제가 아니었다) → 전체 기본값을 60초로
    testTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
