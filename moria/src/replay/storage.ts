/**
 * 리플레이 저장 (OPFS — 브라우저가 페이지마다 주는 사설 파일 공간). 몇백 KB라 localStorage(문자열·5MB)보다 알맞다.
 * 지원하지 않거나 막힌 환경(시크릿 창 등)에서는 false/null — 호출 쪽이 '마지막 60초 보기'를 숨긴다.
 */
const NAME = 'last.replay';

export async function saveReplay(bytes: Uint8Array): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory();
    const w = await (await root.getFileHandle(NAME, { create: true })).createWritable();
    await w.write(bytes as FileSystemWriteChunkType);
    await w.close();
    return true;
  } catch {
    return false;
  }
}

export async function loadReplay(): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const f = await (await root.getFileHandle(NAME)).getFile();
    return new Uint8Array(await f.arrayBuffer());
  } catch {
    return null;
  }
}
