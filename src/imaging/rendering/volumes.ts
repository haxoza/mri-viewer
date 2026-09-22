import { cache, volumeLoader, type Types } from '@cornerstonejs/core';
import type { DisplaySet, Profile } from '../types';
import { budgets } from '../types';
import { volumeProblem } from '../geometry';
import { loadFrame } from './runtime';
interface Managed {
  id: string;
  setId: string;
  bytes: number;
  refs: Set<number>;
}
class VolumeManager {
  volumes = new Map<string, Managed>();
  private preparing = false;
  private preparations = new Map<string, Promise<string>>();
  prepare(
    set: DisplaySet,
    profile: Profile,
    signal: AbortSignal,
    onProgress: (n: number) => void,
  ): Promise<string> {
    const pending = this.preparations.get(set.id);
    if (pending) return pending;
    const task = this.build(set, profile, signal, onProgress).finally(() =>
      this.preparations.delete(set.id),
    );
    this.preparations.set(set.id, task);
    return task;
  }
  private async build(
    set: DisplaySet,
    profile: Profile,
    signal: AbortSignal,
    onProgress: (n: number) => void,
  ) {
    const existing = this.volumes.get(set.id);
    if (existing) return existing.id;
    if (this.preparing) throw new Error('Another volume is still preparing.');
    const problem = volumeProblem(set);
    if (problem) throw new Error(problem);
    const PixelArray =
      set.frames[0].slope === 1 && set.frames[0].intercept === 0
        ? set.frames[0].bits === 8
          ? Uint8Array
          : set.frames[0].signed
            ? Int16Array
            : Uint16Array
        : Float32Array;
    const b = budgets[profile],
      f = set.frames[0],
      native = f.rows * f.columns * set.frames.length * PixelArray.BYTES_PER_ELEMENT,
      bytes = native * 4;
    if (
      this.volumes.size >= b.volumes ||
      [...this.volumes.values()].reduce((s, v) => s + v.bytes, 0) + bytes > b.volume ||
      native > b.cache * 0.75
    )
      throw new Error(
        'MPR exceeds this memory profile. Close a reconstruction or select a smaller series; stack viewing remains available.',
      );
    this.preparing = true;
    const id = `volume:${crypto.randomUUID()}`;
    try {
      const pixels = new PixelArray(f.rows * f.columns * set.frames.length);
      for (let i = 0; i < set.frames.length; i++) {
        signal.throwIfAborted();
        const image = await loadFrame(set.frames[i].id);
        signal.throwIfAborted();
        const data = image.getPixelData();
        const offset = i * f.rows * f.columns;
        for (let j = 0; j < data.length; j++)
          pixels[offset + j] = image.preScale?.scaled ? data[j] : data[j] * f.slope + f.intercept;
        onProgress(Math.round(((i + 1) / set.frames.length) * 100));
      }
      signal.throwIfAborted();
      volumeLoader.createLocalVolume(id, {
        scalarData: pixels,
        referencedImageIds: set.frames.map((f) => f.id),
        dimensions: [f.columns, f.rows, set.frames.length],
        spacing: [f.spacing![1], f.spacing![0], set.positions[1] - set.positions[0]],
        origin: f.position!,
        direction: [...f.orientation!, ...set.normal!] as Types.Mat3,
        metadata: {
          BitsAllocated: PixelArray.BYTES_PER_ELEMENT * 8,
          BitsStored: PixelArray.BYTES_PER_ELEMENT * 8,
          HighBit: PixelArray.BYTES_PER_ELEMENT * 8 - 1,
          SamplesPerPixel: 1,
          PhotometricInterpretation: f.photometric,
          PixelRepresentation: 1,
          Modality: 'MR',
          ImageOrientationPatient: f.orientation!,
          PixelSpacing: f.spacing!,
          FrameOfReferenceUID: f.frameOfReference ?? '',
          Columns: f.columns,
          Rows: f.rows,
          voiLut:
            f.windowWidth !== undefined
              ? [{ windowCenter: f.windowCenter!, windowWidth: f.windowWidth }]
              : [],
          VOILUTFunction: 'LINEAR',
        },
      });
      this.volumes.set(set.id, { id, setId: set.id, bytes, refs: new Set() });
      return id;
    } catch (error) {
      if (cache.getVolume(id)) cache.removeVolumeLoadObject(id);
      throw error;
    } finally {
      this.preparing = false;
    }
  }
  attach(setId: string, pane: number) {
    this.volumes.get(setId)?.refs.add(pane);
  }
  release(pane: number) {
    for (const [key, v] of this.volumes) {
      v.refs.delete(pane);
      if (v.refs.size === 0) {
        this.remove(key);
      }
    }
  }
  remove(setId: string) {
    const v = this.volumes.get(setId);
    if (!v) return;
    const images = cache.getVolume(v.id)?.imageIds ?? [];
    if (cache.getVolume(v.id)) cache.removeVolumeLoadObject(v.id);
    for (const id of images)
      if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
    this.volumes.delete(setId);
  }
}
export const volumes = new VolumeManager();
