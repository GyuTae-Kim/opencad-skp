/**
 * 파일 내용 지문(SHA-256 — 측정 안내를 파일별로 기억하는 열쇠): 파일을 덩이씩 읽으며 구해(파일 전체를 들지 않는다) 넘길 수 있는 ArrayBuffer로 낸다.
 * 해석 워커(작은 모형 — 결과 뒤)와 지문 워커(큰 모형 — 34차, print.worker.ts)가 같이 쓴다. 못 구하면 null(그 파일은 안내를 기억하지 않는다)
 */
import { blobSource, sourceSha256 } from '../range';

export async function filePrint(file: Blob): Promise<ArrayBuffer | null> {
  try {
    const d = await sourceSha256(blobSource(file));
    return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}
