import dicomParser from 'dicom-parser';
import { indexDataset, readHeader, tags } from '../imaging/formats/dicom';
import { extract, openZip, zipLimits } from '../imaging/sources/zip';
import type { FileEntry, ZipReader, BlobReader } from '@zip.js/zip.js';
type Source = { file?: Blob; entry?: FileEntry; archive?: string; path: string };
const sources = new Map<string, Source>();
const archives = new Map<string, ZipReader<BlobReader>>();
const aborters = new Map<number, AbortController>();
let processed = 0;
let readLimit = 96 * 1024 ** 2;
let extractionTail: Promise<unknown> = Promise.resolve();
async function blob(id: string, signal: AbortSignal) {
  const s = sources.get(id);
  if (!s) throw new Error('Source was removed.');
  if ((s.file?.size ?? s.entry!.uncompressedSize) > readLimit)
    throw new Error(
      'Instance exceeds the compressed-source budget for this memory profile. Use a smaller instance or the Standard profile.',
    );
  let b: Blob;
  if (s.file) b = s.file;
  else {
    const task = extractionTail.then(() => {
      signal.throwIfAborted();
      return extract(s.entry!, signal);
    });
    extractionTail = task.catch(() => {});
    b = await task;
  }
  signal.throwIfAborted();
  return b;
}
self.onmessage = async ({ data: { id, op, args } }) => {
  if (op === 'cancel') {
    aborters.get(args)?.abort();
    return;
  }
  const abort = new AbortController();
  aborters.set(id, abort);
  try {
    let value: unknown;
    if (op === 'configure') readLimit = args;
    if (op === 'add') {
      sources.set(args.id, {
        file: args.file,
        path: (args.file.webkitRelativePath || args.file.name).replaceAll('\\', '/'),
      });
      value = args.id;
    }
    if (op === 'zip') {
      const archive = await openZip(args.file, abort.signal);
      archives.set(args.id, archive.reader);
      value = archive.entries.map((entry, i) => {
        const id = `${args.id}-${i}`;
        sources.set(id, { entry, archive: args.id, path: entry.filename.replaceAll('\\', '/') });
        return { id, size: entry.uncompressedSize };
      });
    }
    if (op === 'index') {
      const b = await blob(args, abort.signal);
      if (sources.get(args)?.archive) {
        processed += b.size;
        if (processed > zipLimits.totalBytes)
          throw new Error('Total ZIP expansion limit reached for this session.');
      }
      const dataset = await readHeader(b);
      const frames = indexDataset(dataset, args);
      let missingReferences = 0;
      if (dataset.string('x00080016') === '1.2.840.10008.1.3.10') {
        const source = sources.get(args)!;
        const parent = source.path.split('/').slice(0, -1).join('/');
        const paths = new Set(
          [...sources.values()]
            .filter((s) => s.archive === source.archive)
            .map((s) => s.path.toUpperCase()),
        );
        for (const item of dataset.elements.x00041220?.items ?? []) {
          const ref = item.dataSet?.string('x00041500')?.replaceAll('\\', '/');
          if (ref && !paths.has((parent ? `${parent}/${ref}` : ref).toUpperCase()))
            missingReferences++;
        }
      }
      value = { frames, missingReferences };
    }
    if (op === 'blob') value = await blob(args, abort.signal);
    if (op === 'tags')
      value = tags(
        dicomParser.parseDicom(
          new Uint8Array(await (await blob(args, abort.signal)).arrayBuffer()),
        ),
      );
    if (op === 'removeArchive') {
      for (const [key, source] of sources) if (source.archive === args) sources.delete(key);
      await archives.get(args)?.close();
      archives.delete(args);
    }
    if (op === 'remove') {
      for (const key of args) sources.delete(key);
      for (const [key, reader] of archives)
        if (![...sources.values()].some((s) => s.archive === key)) {
          await reader.close();
          archives.delete(key);
        }
      if (!archives.size) processed = 0;
    }
    abort.signal.throwIfAborted();
    self.postMessage({ id, value });
  } catch (error) {
    if (op === 'zip') {
      for (const [key, source] of sources) if (source.archive === args.id) sources.delete(key);
      await archives.get(args.id)?.close();
      archives.delete(args.id);
    }
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Local file processing failed.',
    });
  } finally {
    aborters.delete(id);
  }
};
