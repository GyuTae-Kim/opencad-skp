// @vitest-environment jsdom
/**
 * 214차 시험(본문은 uilang214.cases.ts)의 ja·zh-CN 언어 걸음 — CI 18차가 uilang214.test.ts(en·de와 나머지 시험)에서 떼어 vitest가 겹쳐 돈다.
 */
import { PARTS, uilang214 } from './uilang214.cases';

uilang214(PARTS.b, false);
