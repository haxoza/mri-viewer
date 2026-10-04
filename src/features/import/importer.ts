import { sources } from '../../imaging/sources/registry';
import { useSession } from '../../app/store';
import { forgetFrames, registerFrames } from '../../imaging/rendering/runtime';
import { controllers, pause, crosshairs } from '../../imaging/rendering/controller';
export interface ImportProgress {
  done: number;
  total: number;
  accepted: number;
  duplicates: number;
  issues: string[];
  cancelled: boolean;
  finished: boolean;
}
export async function importFiles(
  files: File[],
  signal: AbortSignal,
  progress: (p: ImportProgress) => void,
) {
  const report: ImportProgress = {
    done: 0,
    total: files.length,
    accepted: 0,
    duplicates: 0,
    issues: [],
    cancelled: false,
    finished: false,
  };
  const emit = () => progress({ ...report, issues: [...report.issues] });
  emit();
  const frames = [...useSession.getState().frames];
  const seen = new Map(frames.map((f) => [f.sopUID, f.sourceId]));
  const queue: string[] = [];
  const added = new Set<string>();
  const kept = new Set<string>();
  const issue = (text: string) => {
    if (report.issues.length < 100) report.issues.push(text);
  };
  try {
    for (const file of files) {
      signal.throwIfAborted();
      if (file.name.toLowerCase().endsWith('.zip')) {
        try {
          const entries = await sources.zip(file, signal);
          for (const e of entries) {
            queue.push(e.id);
            added.add(e.id);
          }
        } catch (error) {
          if (signal.aborted) throw error;
          issue(error instanceof Error ? error.message : 'ZIP could not be opened.');
        }
      } else {
        const id = await sources.add(file);
        queue.push(id);
        added.add(id);
      }
    }
    report.total = queue.length;
    emit();
    for (const id of queue) {
      signal.throwIfAborted();
      try {
        const { frames: incoming, missingReferences } = await sources.index(id, signal);
        if (missingReferences)
          issue(
            `Media index references ${missingReferences} unavailable file(s). Supplied files were scanned directly.`,
          );
        if (incoming.length) {
          const prior = seen.get(incoming[0].sopUID);
          if (prior) {
            const [a, b] = await Promise.all([sources.blob(prior), sources.blob(id)]);
            signal.throwIfAborted();
            let equal = a.size === b.size;
            if (equal) {
              const hashes = await Promise.all(
                [a, b].map(
                  async (blob) =>
                    new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
                ),
              );
              equal = hashes[0].every((v, i) => v === hashes[1][i]);
            }
            if (equal) report.duplicates++;
            else
              issue(
                `Entry ${report.done + 1}: conflicting SOP identity; existing instance retained.`,
              );
          } else {
            frames.push(...incoming);
            seen.set(incoming[0].sopUID, id);
            kept.add(id);
            registerFrames(incoming);
            report.accepted += incoming.length;
          }
        }
      } catch (error) {
        if (signal.aborted) throw error;
        issue(
          `Entry ${report.done + 1}: ${error instanceof Error ? error.message : 'Indexing failed.'}`,
        );
      }
      report.done++;
      if (report.done % 12 === 0 || report.done === report.total) {
        useSession.getState().updateCatalog([...frames]);
        emit();
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } catch (error) {
    report.cancelled = signal.aborted;
    if (!signal.aborted) issue(error instanceof Error ? error.message : 'Import failed.');
  } finally {
    await sources.remove([...added].filter((id) => !kept.has(id)));
    useSession.getState().updateCatalog(frames);
    report.finished = true;
    emit();
    const state = useSession.getState();
    const first = state.studies[0]?.series[0]?.sets[0];
    if (first && !state.panes[state.active].setId) void controllers[state.active].assign(first.id);
  }
}
export async function removeStudy(uid: string) {
  pause();
  const state = useSession.getState();
  const outgoing = state.frames.filter((f) => f.studyUID === uid);
  const sets = new Set(
    state.studies.find((s) => s.uid === uid)?.series.flatMap((s) => s.sets.map((s) => s.id)),
  );
  for (const [i, p] of state.panes.entries())
    if (p.setId && sets.has(p.setId)) controllers[i].clear();
  for (const id of sets) crosshairs.delete(id);
  if (state.nativePoint && sets.has(state.nativePoint.setId))
    useSession.setState({ nativePoint: undefined });
  forgetFrames(outgoing);
  await sources.remove([...new Set(outgoing.map((f) => f.sourceId))]);
  state.updateCatalog(state.frames.filter((f) => f.studyUID !== uid));
}
export async function droppedFiles(items: DataTransferItemList): Promise<File[]> {
  const files: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      files.push(
        await new Promise<File>((resolve, reject) =>
          (entry as FileSystemFileEntry).file(resolve, reject),
        ),
      );
    } else {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!entries.length) break;
        for (const e of entries) await walk(e);
      }
    }
  };
  const entries = Array.from(items).map((item) => ({
    entry: item.webkitGetAsEntry?.(),
    file: item.getAsFile(),
  }));
  for (const { entry, file } of entries)
    if (entry) await walk(entry);
    else if (file) files.push(file);
  return files;
}
