import type { Frame, TagRow } from '../types';
class LocalSourceRegistry {
  private worker = new Worker(new URL('../../workers/io.worker.ts', import.meta.url), {
    type: 'module',
  });
  private sequence = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  constructor() {
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data.value);
    };
    this.worker.onerror = () => {
      for (const p of this.pending.values())
        p.reject(new Error('Local file worker failed. Reload to retry.'));
      this.pending.clear();
    };
  }
  call<T>(op: string, args: unknown, signal?: AbortSignal): Promise<T> {
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Cancelled', 'AbortError'));
        return;
      }
      const cancel = () => {
        this.worker.postMessage({ op: 'cancel', args: id });
        this.pending.delete(id);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      signal?.addEventListener('abort', cancel, { once: true });
      this.pending.set(id, {
        resolve: (v) => {
          signal?.removeEventListener('abort', cancel);
          resolve(v as T);
        },
        reject: (e) => {
          signal?.removeEventListener('abort', cancel);
          reject(e);
        },
      });
      this.worker.postMessage({ id, op, args });
    });
  }
  configure(bytes: number) {
    return this.call('configure', bytes);
  }
  async add(file: File) {
    const id = crypto.randomUUID();
    await this.call('add', { id, file });
    return id;
  }
  async zip(file: File, signal: AbortSignal) {
    const id = crypto.randomUUID();
    try {
      return await this.call<{ id: string; size: number }[]>('zip', { id, file }, signal);
    } catch (error) {
      await this.call('removeArchive', id);
      throw error;
    }
  }

  index(id: string, signal: AbortSignal) {
    return this.call<{ frames: Frame[]; missingReferences: number }>('index', id, signal);
  }
  blob(id: string) {
    return this.call<Blob>('blob', id);
  }
  tags(id: string) {
    return this.call<TagRow[]>('tags', id);
  }
  remove(ids: string[]) {
    return this.call('remove', ids);
  }
}
export const sources = new LocalSourceRegistry();
