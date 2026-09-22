import { BlobReader, ZipReader, configure, type FileEntry } from '@zip.js/zip.js';
configure({ useWebWorkers: false }); // Runs inside our dedicated I/O worker.
export const zipLimits = { entries: 20000, entryBytes: 128 * 1024 ** 2, totalBytes: 8 * 1024 ** 3 };
export function safePath(name: string) {
  const path = name.replaceAll('\\', '/');
  return (
    !!path &&
    !path.startsWith('/') &&
    !/^[a-z]:/i.test(path) &&
    !path.split('/').some((x) => x === '..' || x === '.') &&
    !path.includes('\0')
  );
}
export async function openZip(file: Blob, signal?: AbortSignal) {
  const reader = new ZipReader(new BlobReader(file));
  const entries: FileEntry[] = [];
  const names = new Set<string>();
  let total = 0,
    count = 0;
  try {
    for await (const e of reader.getEntriesGenerator()) {
      signal?.throwIfAborted();
      if (++count > zipLimits.entries)
        throw new Error('ZIP has too many entries. Extract externally and use folder import.');
      if (!safePath(e.filename)) throw new Error('ZIP contains an unsafe path.');
      const name = e.filename.replaceAll('\\', '/');
      if (names.has(name)) throw new Error('ZIP contains duplicate entry paths.');
      names.add(name);
      if (e.directory) continue;
      if (e.encrypted || ![0, 8].includes(e.compressionMethod) || e.diskNumberStart !== 0)
        throw new Error('Encrypted, multipart, or non-DEFLATE ZIP entries are unsupported.');
      if (/\.(zip|7z|rar)$/i.test(name))
        throw new Error('Nested archives are unsupported. Extract externally.');
      total += e.uncompressedSize;
      if (e.uncompressedSize > zipLimits.entryBytes || total > zipLimits.totalBytes)
        throw new Error(
          'ZIP expansion exceeds the local import limit. Extract externally and select fewer files.',
        );
      entries.push(e as FileEntry);
    }
    return { reader, entries };
  } catch (error) {
    await reader.close();
    throw error;
  }
}
export async function extract(entry: FileEntry, signal?: AbortSignal): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  await entry.getData(
    new WritableStream<Uint8Array>({
      write(chunk) {
        size += chunk.byteLength;
        if (size > zipLimits.entryBytes || size > entry.uncompressedSize)
          throw new Error('ZIP actual output exceeds its expansion limit.');
        chunks.push(new Uint8Array(chunk));
      },
    }),
    { signal, checkSignature: true },
  );
  if (size !== entry.uncompressedSize) throw new Error('ZIP entry length mismatch.');
  return new Blob(chunks);
}
