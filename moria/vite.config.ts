import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
