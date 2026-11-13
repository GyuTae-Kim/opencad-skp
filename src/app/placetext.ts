/**
 * 정보 탭 "위치·그림자" 칸의 글(73차에 첫 화면 조각 doc.ts에서 옮김 — 정보 탭 조각만 쓴다): 위도·경도, 시간대, 그림자 시각.
 */

/** 위도·경도 글("37.5665° N, 126.9780° E") */
export function latLonText(lat: number, lon: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lon).toFixed(4)}° ${ew}`;
}

/** 시간대 글(UTC+9, UTC−3:30) */
export function tzText(tz: number): string {
  const sign = tz < 0 ? '−' : '+';
  const a = Math.abs(tz);
  const h = Math.floor(a);
  const m = Math.round((a - h) * 60);
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** 그림자 시각(그곳 시각을 UTC 초처럼 적은 값) → "2026-06-21 13:30" */
export function shadowTimeText(time: number): string {
  const d = new Date(time * 1000);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}
