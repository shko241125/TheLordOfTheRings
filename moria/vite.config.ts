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
    // 라이브러리를 게임 코드와 나눈다 (계획서 14장 로딩 전략): 게임 코드만 바뀐 배포에서는 브라우저가 라이브러리를 캐시에서 다시 쓴다.
    // Rapier(compat)는 WASM을 base64로 품어 혼자 4.3MB(gzip 1.7MB)다 → 경고 한도는 그 위로.
    // ponytail: .wasm 파일을 따로 받는 비-compat 패키지로 바꾸면 줄지만, 물리 적재 경로가 바뀌어 결정성 골든을 다시 검증해야 한다
    chunkSizeWarningLimit: 4500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'rapier', test: /node_modules[\\/]@dimforge/ },
            { name: 'three', test: /node_modules[\\/]three/ },
            { name: 'vendor', test: /node_modules/ },
          ],
        },
      },
    },
  },
  test: {
    // 시뮬레이션마다 내비메시를 굽는다(구역 1 ≈ 0.5초). 파일이 병렬로 돌면 CPU를 나눠 쓰느라 기본 5초를 넘긴 적이 있다
    // (전투·이동 테스트에서 두 번 — 부하 때문이지 논리 문제가 아니었다) → 전체 기본값을 60초로
    testTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
