/**
 * 해석 워커 손님: 파일(Blob·File)을 워커로 넘기고, 진행률을 받아 결과 장면을 돌려받는다. 결과에는 뒤따라 오는 파일 내용 지문의
 * 약속(print)을 붙인다. 워커는 처음 쓸 때 만들고 하나를 계속 쓴다. 워커가 죽으면 기다리던 요청을 모두 실패로(지문은 null로) 끝내고
 * 다음에 새로 만든다.
 */
import type { ParseRequest, ParseResponse, ParseResult } from './protocol';

interface Pending {
  resolve: (r: ParseResult) => void;
  reject: (e: Error) => void;
  progress?: ((fraction: number, stage: string) => void) | undefined;
  /** 결과를 받은 뒤 지문을 기다린다(이때도 pending에 남는다) */
  print?: (digest: ArrayBuffer | null) => void;
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
      this.pending.set(id, { resolve, reject, progress });
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
    this.fail(new Error('해석을 멈췄습니다'));
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
      if (m.type === 'done') return p.resolve({ ...m.result, print: new Promise((r) => (p.print = r)) });
      this.pending.delete(m.id);
      if (m.type === 'print') p.print?.(m.digest);
      else if (m.type === 'error') p.reject(new Error(m.message));
    };
    w.onerror = (ev: ErrorEvent) => {
      ev.preventDefault();
      this.fail(new Error(ev.message || '해석 워커가 멈췄습니다(메모리가 모자랄 수 있습니다)'));
      w.terminate();
      if (this.worker === w) this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private fail(e: Error): void {
    const all = [...this.pending.values()];
    this.pending.clear();
    // 결과를 받은 요청은 지문이 null로, 나머지는 실패로(받은 약속에 reject는 아무 일도 하지 않는다)
    for (const p of all) {
      p.print?.(null);
      p.reject(e);
    }
  }
}
