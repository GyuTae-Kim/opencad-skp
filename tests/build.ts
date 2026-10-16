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
