import { describe, expect, it } from 'vitest';
import { readSkpImages, skpToScene } from '../src/index';
import { imageMime } from '../src/images';
import { sampleSkpBytes } from '../src/app/sample';
import { entities, modelDat, oldSkpHeader, pngRgb, skpFile, utf8 } from './build';

const tiny = pngRgb(2, 2, (x, y) => [x * 255, y * 255, 0]);
const jpegLike = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

function fileWith(extra: { name: string; data: Uint8Array; deflate?: boolean }[]): Uint8Array {
  return skpFile(modelDat({ root: entities(undefined, {}) }), { extra });
}

describe('꾸러미 안 그림', () => {
  it('예제: 모형·무늬·컴포넌트·장면 미리보기를 자리대로 꺼낸다', () => {
    const img = readSkpImages(sampleSkpBytes());
    expect(img.model?.path).toBe('meta/model_thumbnail.png');
    expect(img.model?.mime).toBe('image/png');
    expect(img.materials.map((m) => m.folder).sort()).toEqual(['기와', '마루', '잔디']);
    expect(img.components.map((c) => c.name).sort()).toEqual(['나무', '의자', '탁자']);
    expect(img.scenes.map((c) => c.name)).toEqual(['앞마당', '식탁']);
    expect(img.skipped).toBe(0);
    // 무늬 재질 폴더는 재질 통계의 folder와 같다
    const s = skpToScene(sampleSkpBytes());
    const stats = s.meta!.materialStats as { name: string; folder?: string; textured: boolean }[];
    for (const m of img.materials) expect(stats.find((x) => x.folder === m.folder)?.textured).toBe(true);
  });

  it('첫 바이트로 꼴을 가리고, material.xml·그림이 아닌 파일·모르는 꼴은 건너뛴다', () => {
    expect(imageMime(tiny)).toBe('image/png');
    expect(imageMime(jpegLike)).toBe('image/jpeg');
    expect(imageMime(utf8('GIF89a......'))).toBe('image/gif');
    expect(imageMime(utf8('BM....'))).toBe('image/bmp');
    expect(imageMime(utf8('RIFF....WEBPVP8 '))).toBe('image/webp');
    expect(imageMime(utf8('hello'))).toBeNull();
    const img = readSkpImages(
      fileWith([
        { name: 'materials/벽돌/벽돌.jpg', data: jpegLike },
        { name: 'materials/벽돌/둘째.png', data: tiny },
        { name: 'materials/돌/note.txt', data: utf8('x') },
        { name: 'materials/가짜/가짜.png', data: utf8('not a png') },
        { name: 'thumbnails/Chair <1>.png', data: tiny, deflate: true },
        { name: 'scene_thumbnails/Scene 1.png', data: tiny },
        { name: 'meta/preview_thumbnail.png', data: tiny },
      ]),
    );
    // 폴더마다 첫 그림 하나
    expect(img.materials.map((m) => [m.folder, m.name, m.mime])).toEqual([['벽돌', '벽돌.jpg', 'image/jpeg']]);
    expect(img.components.map((c) => c.name)).toEqual(['Chair <1>']);
    expect(img.scenes.map((c) => c.name)).toEqual(['Scene 1']);
    // model_thumbnail이 없으면 preview_thumbnail
    expect(img.model?.path).toBe('meta/preview_thumbnail.png');
    expect(img.skipped).toBe(1);
    expect(img.warnings.length).toBe(1);
  });

  it('개수·한 장 크기·전체 크기 한도', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ name: `thumbnails/c${i}.png`, data: tiny }));
    expect(readSkpImages(fileWith(many), { maxCount: 4 }).components.length).toBe(4);
    expect(readSkpImages(fileWith(many), { maxCount: 4 }).skipped).toBe(6);
    expect(readSkpImages(fileWith(many), { maxBytesEach: 10 }).components.length).toBe(0);
    expect(readSkpImages(fileWith(many), { maxTotalBytes: tiny.length * 3 }).components.length).toBe(3);
  });

  it('SketchUp 2021 이후 파일이 아니면 빈 결과', () => {
    expect(readSkpImages(oldSkpHeader('17.2.2555')).components).toEqual([]);
    expect(readSkpImages(utf8('hello')).model).toBeUndefined();
  });
});
