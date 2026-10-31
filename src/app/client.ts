/**
 * 해석 워커 손님: 파일(Blob·File)을 워커로 넘기고, 진행률을 받아 결과 장면을 돌려받는다. 결과에는 뒤따라 오는 파일 내용 지문의
 * 약속(print)을 붙인다. 워커는 처음 쓸 때 만들고 하나를 계속 쓴다. 워커가 죽으면 기다리던 요청을 모두 실패로(지문은 null로) 끝내고
 * 다음에 새로 만든다.
 * 34차: 큰 모형(워커가 결과에 separatePrint를 단다)은 결과를 받자마자 해석 워커를 끝낸다. 그 워커의 heap과 해석하며 남긴 쓰레기(다음 GC까지
 * 남던 배열 — 165 MB 표본에서 화면이 장면을 올리는 동안 렌더러 프로세스 메모리 최고치의 2할)를 한꺼번에 놓고, 지문은 해석기를 싣지 않은
 * 작은 지문 워커(worker/print.worker.ts)가 구한다. 다음 열기는 새 해석 워커로 한다.
 */
import type { ParseRequest, ParseResponse, ParseResult, PrintRequest } from './protocol';

interface Pending {
  resolve: (r: ParseResult) => void;
  reject: (e: Error) => void;
  progress?: ((fraction: number, stage: string) => void) | undefined;
  /** 결과를 받은 뒤 지문을 기다린다(이때도 pending에 남는다) */
  print?: (digest: ArrayBuffer | null) => void;
  /** 지문을 따로 구할 때 줄 파일 */
  file: Blob;
  /** 지문을 구하는 지문 워커(큰 모형 — 해석 워커가 죽어도 이 요청의 지문은 그대로 기다린다) */
  printer?: Worker;
}

export class ParseClient {
  private worker: Worker | null = null;
  private seq = 0;
  /** 결과나 지문을 기다리는 요청 */
  private pending = new Map<number, Pending>();

  /**
   * 파일 해석(Blob은 복사 없이 넘어간다). textureLimit: 워커가 푸는 무늬 그림의 긴 변 한도.
   * 결과의 print는 파일 내용 SHA-256(워커가 결과 뒤에 구해 보낸다 — 못 구했거나 워커가 멈추면 null)
   */
  open(name: string, file: Blob, progress?: (fraction: number, stage: string) => void, opts: { textureLimit?: number } = {}): Promise<ParseResult> {
    let w: Worker;
    try {
      w = this.ensure();
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
    const id = ++this.seq;
    return new Promise<ParseResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, progress, file });
      const req: ParseRequest = { id, type: 'open', name, file };
      if (opts.textureLimit) req.textureLimit = opts.textureLimit;
      try {
        w.postMessage(req);
      } catch (e) {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** 진행 중인 해석을 멈춘다(워커를 끝내고 기다리던 요청은 실패로). 다음 open에서 워커를 새로 만든다. 지문만 기다리면 그대로 둔다 */
  cancel(): void {
    for (const p of this.pending.values()) if (!p.print) return this.dispose();
  }

  dispose(): void {
    const printers = [...this.pending.values()].map((p) => p.printer);
    this.fail(new Error('해석을 멈췄습니다'));
    for (const pw of printers) pw?.terminate();
    this.worker?.terminate();
    this.worker = null;
  }

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module', name: 'opencad-skp-parse' });
    w.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.id);
      if (!p) return;
      if (m.type === 'progress') {
        p.progress?.(m.fraction, m.stage);
        return;
      }
      // 결과에는 뒤따라 올 지문의 약속을 붙이고 지문까지 기다린다
      if (m.type === 'done') {
        p.resolve({ ...m.result, print: new Promise((r) => (p.print = r)) });
        if (m.separatePrint) this.printApart(m.id, p, w);
        return;
      }
      this.pending.delete(m.id);
      if (m.type === 'print') p.print?.(m.digest);
      else if (m.type === 'error') p.reject(new Error(m.message));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      this.fail(new Error(ev.message || '해석 워커가 멈췄습니다(메모리가 모자랄 수 있습니다)'), false);
      w.terminate();
      if (this.worker === w) this.worker = null;
    };
    this.worker = w;
    return w;
  }

  /**
   * 큰 모형의 지문(34차): 해석 워커에 기다리는 다른 요청(앞 파일의 지문 등)이 없으면 그 워커를 곧바로 끝내고(다음 열기는 새 워커),
   * 지문은 지문 워커에 묻는다. 지문을 받거나 지문 워커가 죽으면(null) 그 워커를 끝낸다
   */
  private printApart(id: number, p: Pending, w: Worker): void {
    if (this.worker === w && this.pending.size === 1) {
      w.terminate();
      this.worker = null;
    }
    const end = (digest: ArrayBuffer | null): void => {
      p.printer?.terminate();
      if (this.pending.get(id) !== p) return;
      this.pending.delete(id);
      p.print?.(digest);
    };
    let pw: Worker;
    try {
      pw = new Worker(new URL('../worker/print.worker.ts', import.meta.url), { type: 'module', name: 'opencad-skp-print' });
    } catch {
      end(null);
      return;
    }
    p.printer = pw;
    pw.onmessage = (ev: MessageEvent<ParseResponse>) => {
      const m = ev.data;
      if (m && m.type === 'print' && m.id === id) end(m.digest);
    };
    pw.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      end(null);
    };
    const req: PrintRequest = { id, type: 'print', file: p.file };
    try {
      pw.postMessage(req);
    } catch {
      end(null);
    }
  }

  /** 기다리던 요청을 실패로(지문은 null로). printers가 false면 지문 워커가 구하는 요청은 그대로 둔다(해석 워커만 죽었을 때) */
  private fail(e: Error, printers = true): void {
    const all = [...this.pending].filter(([, p]) => printers || !p.printer);
    for (const [id] of all) this.pending.delete(id);
    // 결과를 받은 요청은 지문이 null로, 나머지는 실패로(받은 약속에 reject는 아무 일도 하지 않는다)
    for (const [, p] of all) {
      p.print?.(null);
      p.reject(e);
    }
  }
}
