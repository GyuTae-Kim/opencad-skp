/**
 * 보기 설정의 주변 가림(코어 0.49.0 SSAO·0.50.0 움직이는 동안 끄기 — 54차): 메뉴 두 항목이 앱 상태를 바꾸고 코어에 거는 값,
 * 움직이는 동안 끄기의 기본(휴대폰·큰 모형), 새 문서에서 다시 거는 것, 네 언어 글. 앱 클래스는 DOM·뷰어 전체를 만들어야 해 원문으로 본다
 * (실제 화면의 프레임 비용과 메뉴 동작은 헤드리스 Chrome으로 쟀다 — README 개발 절).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { languages, translate } from '../../site/i18n.mjs';

const app = readFileSync(resolve(__dirname, '../../src/app/app.ts'), 'utf8');
const LABELS = ['주변 가림(구석·틈 어둡게)', '움직이는 동안 주변 가림 끄기'];

describe('보기 설정 주변 가림(54차)', () => {
  it('메뉴: 켜고 끄기, 움직이는 동안 끄기(가림을 켰을 때만)', () => {
    expect(app).toContain(`{ label: '${LABELS[0]}', checked: this.aoOn, toggle: true, run: () => this.setAmbientOcclusion(!this.aoOn) }`);
    expect(app).toContain(`{ label: '${LABELS[1]}', checked: this.aoMovingOff, toggle: true, disabled: !this.aoOn, run: () => this.setAoMovingOff(!this.aoMovingOff) }`);
  });

  it('코어에 거는 값: 끄면 null, 켜면 moving off·keep — 기본 꺼짐, 움직이는 동안 끄기 기본은 휴대폰이거나 큰 모형', () => {
    expect(app).toMatch(/private aoOn = false;/);
    expect(app).toMatch(/this\.viewer\?\.setAmbientOcclusion\(this\.aoOn \? \{ moving: this\.aoMovingOff \? 'off' : 'keep' \} : null\)/);
    expect(app).toMatch(/this\.aoMovingChoice \?\? \(!!this\.phoneQuery\?\.matches \|\| \(!!this\.doc && isBigScene\(this\.doc\)\)\)/);
    // 새 문서를 올릴 때 다시 건다(기본이 문서 크기를 따른다 — 코어 선택은 장면을 바꿔도 남는다)
    const setDoc = app.slice(app.indexOf('private setDoc('), app.indexOf('private setDoc(') + 8000);
    expect(setDoc).toContain('this.applyAmbientOcclusion();');
  });

  it('네 언어로 옮긴다', () => {
    for (const { code } of languages.filter((l) => l.code !== 'ko')) for (const t of LABELS) expect(translate(t, code), `${code}: ${t}`).not.toMatch(/[가-힣]/);
    expect(translate(LABELS[0]!, 'en')).toBe('Ambient occlusion (darken corners and gaps)');
  });
});
