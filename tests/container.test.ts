import { describe, expect, it } from 'vitest';
import { readSkpHeader, readUtf16String } from '../src/header';
import { readZipDirectory, readZipItem, scanZipLocal, undoCp437 } from '../src/zip';
import { concat, flagUtf8Names, oldSkpHeader, skpFile, utf16String, utf8, zip } from './build';

describe('SKP 머리', () => {
  it('2021 이후: 표지·버전·VFF 블록 뒤 ZIP 시작', () => {
    const file = skpFile(new Uint8Array([0xf4, 0x01, 0, 0, 0, 0]), { version: '21.0.339' });
    const h = readSkpHeader(file)!;
    expect(h.title).toBe('SketchUp Model');
    expect(h.version).toBe('21.0.339');
    expect([h.major, h.minor, h.build]).toEqual([21, 0, 339]);
    expect(h.container).toBe('zip');
    expect(h.subVersion).toBe(17);
    // "SketchUp Model"(4+28) + "{21.0.339}"(4+20) + "VFF"(3) + u16(2) + 8
    expect(h.bodyOffset).toBe(32 + 24 + 13);
    expect([...file.subarray(h.bodyOffset, h.bodyOffset + 4)]).toEqual([0x50, 0x4b, 3, 4]);
  });

  it('2020 이하: MFC 꼴로 가른다', () => {
    const h = readSkpHeader(oldSkpHeader('8.0.1'))!;
    expect(h.version).toBe('8.0.1');
    expect(h.major).toBe(8);
    expect(h.container).toBe('mfc');
  });

  it('SketchUp 파일이 아니면 null', () => {
    expect(readSkpHeader(utf8('solid cube\nendsolid'))).toBeNull();
    expect(readSkpHeader(utf16String('Other Model'))).toBeNull();
    expect(readSkpHeader(new Uint8Array(0))).toBeNull();
  });

  it('긴 문자열 길이(FF + u16)', () => {
    const s = 'x'.repeat(300);
    const b = new Uint8Array(6 + 600);
    b.set([0xff, 0xfe, 0xff, 0xff, 300 & 0xff, 300 >> 8]);
    for (let i = 0; i < 300; i++) b[6 + 2 * i] = 0x78;
    expect(readUtf16String(b, 0)).toEqual([s, 606]);
    expect(readUtf16String(b.subarray(0, 100), 0)).toBeNull();
  });
});

describe('ZIP 읽기(앞붙이가 있는 꾸러미)', () => {
  it('저장·DEFLATE 항목을 꺼낸다', () => {
    const a = utf8('<x/>'.repeat(100));
    const b = utf8('hello 가나다');
    const z = zip([
      { name: 'materials/빨강/material.xml', data: a, deflate: true },
      { name: 'model.dat', data: b },
    ]);
    const file = concat([new Uint8Array(77).fill(9), z]);
    const dir = readZipDirectory(file)!;
    expect(dir.map((d) => d.name)).toEqual(['materials/빨강/material.xml', 'model.dat']);
    expect(dir[0]!.method).toBe(8);
    expect(readZipItem(file, dir[0]!)).toEqual(a);
    expect(readZipItem(file, dir[1]!)).toEqual(b);
  });

  it('ZIP이 아니면 null', () => {
    expect(readZipDirectory(utf8('no zip here'))).toBeNull();
  });
});

describe('다른 프로그램이 다시 묶으며 두 번 인코딩한 항목 이름(84차)', () => {
  // 파이썬 cp437 코덱으로 만든 값(UTF-8 바이트를 CP437로 읽은 글): '무늬A', '의자'
  const MOJI = 'δ¼┤δè¼A';
  const CHAIR = '∞¥ÿ∞₧É';
  const xml = utf8('<x/>'.repeat(20));
  const png = utf8('png');
  const entries = (folder: string, chair: string): Parameters<typeof zip>[0] => [
    { name: `materials/${folder}/material.xml`, data: xml, deflate: true },
    { name: `materials/${folder}/a.png`, data: png },
    { name: `thumbnails/${chair}.png`, data: png },
    { name: 'model.dat', data: utf8('m') },
  ];
  const names = (b: Uint8Array): string[] => readZipDirectory(b)!.map((d) => d.name);

  it('undoCp437: CP437로 읽은 UTF-8 바이트만 되돌린다', () => {
    expect(undoCp437(MOJI)).toBe('무늬A');
    expect(undoCp437(CHAIR)).toBe('의자');
    expect(undoCp437('Caf├⌐')).toBe('Café');
    // ASCII뿐 · CP437 표 밖 글자 · 되돌린 바이트가 올바른 UTF-8이 아님(é = 0x82 홀로, ï ½)
    for (const s of ['model.dat', '무늬A', 'Café', 'naïve ½']) expect(undoCp437(s)).toBeNull();
  });

  it('깃발 달린 이름이 모두 되돌려지면 되돌리고 원래 이름 바이트 수를 남긴다 — 중앙 목록·지역 머리 길 모두', () => {
    const file = flagUtf8Names(concat([new Uint8Array(41).fill(7), zip(entries(MOJI, CHAIR))]));
    const want = ['materials/무늬A/material.xml', 'materials/무늬A/a.png', 'thumbnails/의자.png', 'model.dat'];
    const dir = readZipDirectory(file)!;
    expect(dir.map((d) => d.name)).toEqual(want);
    expect(dir.map((d) => d.nameBytes)).toEqual([...entries(MOJI, CHAIR).slice(0, 3).map((e) => utf8(e.name).length), undefined]);
    expect(readZipItem(file, dir[0]!)).toEqual(xml);
    expect(readZipItem(file, dir[2]!)).toEqual(png);
    const local = scanZipLocal(file, 41).items;
    expect(local.map((d) => d.name)).toEqual(want);
    expect(local.map((d) => d.nameBytes)).toEqual(dir.map((d) => d.nameBytes));
  });

  it('깃발 없는 이름(SketchUp이 쓴 꼴)·깃발대로 UTF-8로 쓴 이름이 하나라도 든 꾸러미는 그대로', () => {
    // 깃발 없음: 같은 글이어도 그대로(SketchUp은 비트 11 없이 UTF-8 이름을 쓴다)
    expect(names(zip(entries(MOJI, CHAIR)))).toEqual(entries(MOJI, CHAIR).map((e) => e.name));
    // 깃발 달린 한글(CP437 표 밖) 이름
    expect(names(flagUtf8Names(zip(entries('무늬A', '의자'))))).toEqual(entries('무늬A', '의자').map((e) => e.name));
    // 섞임: 한 이름이 UTF-8로 쓴 한글이면 되돌릴 수 있는 이름도 모두 그대로
    const mixed = readZipDirectory(flagUtf8Names(zip(entries(MOJI, '의자'))))!;
    expect(mixed.map((d) => d.name)).toEqual(entries(MOJI, '의자').map((e) => e.name));
    expect(mixed.every((d) => d.nameBytes === undefined)).toBe(true);
    // 깃발 단 라틴 글자 이름(되돌리면 é가 0x82 홀로 — 올바른 UTF-8이 아님)
    expect(names(flagUtf8Names(zip([{ name: 'materials/Café/a.png', data: png }, { name: 'model.dat', data: utf8('m') }])))).toEqual(['materials/Café/a.png', 'model.dat']);
    // 모든 항목에 깃발(ASCII 이름에도)이어도 ASCII 이름은 그대로
    expect(names(flagUtf8Names(zip(entries(MOJI, CHAIR)), true))).toEqual(['materials/무늬A/material.xml', 'materials/무늬A/a.png', 'thumbnails/의자.png', 'model.dat']);
  });
});
