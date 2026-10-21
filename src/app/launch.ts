/**
 * 주소 인자 → 처음에 열 것(순수 함수).
 *   ?open=<같은 출처 주소>  자동 확인용으로 그 파일을 바로 연다(다른 출처는 막는다 — 파일을 바깥으로 보내지도, 바깥 것을 받지도 않게)
 *   ?sample                 예제를 바로 연다
 *   ?shared=<열쇠>          홈 화면 앱이 공유 받은 파일(서비스 워커가 최근 문서 IndexedDB에 넣은 것)을 연다 —
 *                           최근 문서 id(이름:크기), 한 번 쓸 자리(shared:…), 실패(:none 파일 없음 · :error 저장 실패)
 */
import { baseName } from './format';

export type LaunchRequest =
  | { kind: 'none' }
  | { kind: 'sample' }
  | { kind: 'url'; url: string; name: string }
  | { kind: 'shared'; key: string }
  | { kind: 'error'; message: string };

export function parseLaunch(search: string, base: string): LaunchRequest {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return { kind: 'none' };
  }
  const open = params.get('open');
  if (open !== null) {
    if (!open.trim()) return { kind: 'error', message: 'open 인자에 열 파일 주소가 없습니다.' };
    let url: URL;
    let here: URL;
    try {
      here = new URL(base);
      url = new URL(open, here);
    } catch {
      return { kind: 'error', message: `열 파일 주소를 읽지 못했습니다: ${open}` };
    }
    if (url.origin !== here.origin || !/^https?:$/.test(url.protocol))
      return { kind: 'error', message: '같은 출처(이 사이트)의 주소만 열 수 있습니다.' };
    let name = baseName(url.pathname);
    try {
      name = decodeURIComponent(name);
    } catch {
      /* 그대로 쓴다 */
    }
    return { kind: 'url', url: url.href, name: name || 'model.skp' };
  }
  const shared = params.get('shared');
  if (shared !== null) return shared ? { kind: 'shared', key: shared } : { kind: 'error', message: '공유 받은 파일을 찾지 못했습니다.' };
  if (params.has('sample')) return { kind: 'sample' };
  return { kind: 'none' };
}
