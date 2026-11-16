/**
 * 시험용 SKP 바이트 만들기: 쓰기 도구 본체는 앱과 함께 쓰는 src/app/skpwrite.ts에 있고,
 * 여기서는 Node의 deflateRawSync로 압축하는 zip·skpFile만 덧씌운다(실제 SketchUp 파일처럼 DEFLATE 항목을 시험하려고).
 * 실제 SketchUp 파일은 저장소에 넣지 않는다.
 */

import { deflateRawSync } from 'node:zlib';
import { skpFile as writeSkpFile, zip as writeZip, type SkpFileOpts, type ZipEntry } from '../src/app/skpwrite';

export * from '../src/app/skpwrite';

export const nodeDeflate = (data: Uint8Array): Uint8Array => new Uint8Array(deflateRawSync(data));

/** ZIP(항목의 deflate가 참이면 Node zlib으로 압축) */
export function zip(entries: ZipEntry[]): Uint8Array {
  return writeZip(entries, nodeDeflate);
}

/** 2021 이후 꼴의 파일 전체(기본으로 material.xml·model.dat을 DEFLATE로 압축) */
export function skpFile(model: Uint8Array, opts: Omit<SkpFileOpts, 'compress'> = {}): Uint8Array {
  return writeSkpFile(model, { ...opts, compress: nodeDeflate });
}

/**
 * 파일 안 ZIP에서 이름에 ASCII 밖 바이트가 든 항목(all이면 모든 항목)의 중앙 목록·지역 머리 일반 목적 깃발에 비트 11(0x800 — 이름이 UTF-8)을 단 사본(84차 —
 * 다른 프로그램이 다시 묶은 꾸러미 흉내). 위치는 끝 레코드에서 구한다
 */
export function flagUtf8Names(file: Uint8Array, all = false): Uint8Array {
  const b = file.slice();
  const dv = new DataView(b.buffer);
  let eocd = b.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const base = eocd - cdSize - cdOffset;
  let p = base + cdOffset;
  for (let i = 0; i < count; i++) {
    const nameLen = dv.getUint16(p + 28, true);
    const local = base + dv.getUint32(p + 42, true);
    if (all || b.subarray(p + 46, p + 46 + nameLen).some((x) => x >= 0x80)) {
      dv.setUint16(p + 8, dv.getUint16(p + 8, true) | 0x800, true);
      dv.setUint16(local + 6, dv.getUint16(local + 6, true) | 0x800, true);
    }
    p += 46 + nameLen + dv.getUint16(p + 30, true) + dv.getUint16(p + 32, true);
  }
  return b;
}
