// @vitest-environment jsdom
/**
 * 214차 시험(본문은 uilang214.cases.ts): en·de 언어 걸음과 언어 걸음 밖 시험(모음·216차·새 열쇠·215차·CI 18차 언어 합).
 * ja·zh-CN 언어 걸음은 uilang214b.test.ts — CI 18차가 한 파일(CI 39~61초)을 둘로 나눠 vitest가 겹쳐 돈다.
 */
import { PARTS, uilang214 } from './uilang214.cases';

uilang214(PARTS.a, true);
