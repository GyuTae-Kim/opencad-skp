/**
 * 세 값의 길이 √(x² + y² + z²) — Math.hypot(x, y, z)와 같은 셈(51차).
 *
 * 큰 모형의 장면 만들기는 정점·면마다 길이를 잰다(법선 옮기기·면 법선·무늬 평면 틀·법선 줄이기). Chrome·Node의 V8은 Math.hypot을 부를 때마다
 * 인자 배열을 새로 잡아 느리다(이 기계에서 600만 번에 330 ms 남짓, 아래 셈은 60 ms 남짓). 그래서 V8 Math.hypot(builtins math.tq)과 같은 차례의
 * 같은 연산을 그대로 옮겼다: 가장 큰 절댓값 m으로 나눈 값의 제곱을 Kahan 합으로 더하고 √합 × m. 연산과 차례가 같아 V8에서는 비트까지 같은 값이다
 * (시험이 넓은 범위의 무작위 값으로 견준다). 무한·NaN·0이 끼면(m이 유한한 양수가 아니면) Math.hypot에 그대로 맡긴다.
 * 다른 엔진(Safari·Firefox)의 Math.hypot은 셈이 달라 마지막 자리가 다를 수 있다 — 그 엔진에서는 V8과 같은 값을 낸다.
 */
export function hypot3(x: number, y: number, z: number): number {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let m = ax > ay ? ax : ay;
  if (az > m) m = az;
  if (!(m > 0 && m < Infinity)) return Math.hypot(x, y, z);
  const a = ax / m;
  const b = ay / m;
  const c = az / m;
  // Kahan 합(첫 항은 보정이 0이라 그대로): sum = a², 둘째 항 b²의 보정 comp, 셋째 항은 c² − comp
  const s0 = a * a;
  const s1 = b * b;
  const p1 = s0 + s1;
  const comp = p1 - s0 - s1;
  return Math.sqrt(p1 + (c * c - comp)) * m;
}
