/**
 * model.dat 풀기 워커(49차): 해석 워커가 띄워 큰 2021+ 모형의 압축된 model.dat를 맡긴다. 파일에서 덩이씩 읽어 내장 풀기로 풀고
 * 풀린 바이트를 모아 해석 워커로 넘긴다 — 풀기와 객체 읽기가 두 스레드에서 겹친다(src/inflatepipe.ts)
 */
import { serveInflate } from '../inflatepipe';

serveInflate(self as unknown as DedicatedWorkerGlobalScope);
