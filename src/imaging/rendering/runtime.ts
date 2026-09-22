import { init, imageLoader, metaData, cache, Enums, type Types } from '@cornerstonejs/core';
import dicomLoader from '@cornerstonejs/dicom-image-loader';
import { logging } from '@cornerstonejs/metadata';
import dicomParser from 'dicom-parser';
import { sources } from '../sources/registry';
import type { Frame, Profile } from '../types';
import { budgets } from '../types';
const frames = new Map<string, Frame>();
const extras = new Map<string, Record<string, unknown>>();
let ready: Promise<void> | undefined;
let running = 0;
let concurrency = 2;
const waiters: (() => void)[] = [];
async function decode(id: string, options: object = {}) {
  if (running >= concurrency) await new Promise<void>((r) => waiters.push(r));
  running++;
  try {
    const f = frames.get(id);
    if (!f) throw new Error('Image is no longer available.');
    const blob = await sources.blob(f.sourceId);
    const dataset = dicomParser.parseDicom(new Uint8Array(await blob.arrayBuffer()));
    const saved: Record<string, unknown> = {};
    for (const type of ['imagePixelModule', 'voiLutModule', 'modalityLutModule', 'sopCommonModule'])
      saved[type] = dicomLoader.wadouri.metaData.metadataForDataset(type, id, dataset);
    extras.set(id, saved);
    const pixels = dicomLoader.wadouri.getPixelData(dataset, f.frame);
    const image = await dicomLoader.createImage(id, pixels, f.syntax, {
      ...options,
      preScale: { enabled: true },
    });
    // createImage owns only decoded pixels; the full Part 10 dataset is not cached.
    if (!frames.has(id)) throw new Error('Image was removed during decoding.');
    return image as Types.IImage;
  } finally {
    running--;
    waiters.shift()?.();
  }
}
function provider(type: string, id: string) {
  const f = frames.get(id);
  if (!f) return;
  const M = Enums.MetadataModules;
  if (type === M.IMAGE_PLANE) {
    const orientation = f.orientation ?? [1, 0, 0, 0, 1, 0];
    return {
      frameOfReferenceUID: f.frameOfReference,
      rows: f.rows,
      columns: f.columns,
      imageOrientationPatient: orientation,
      rowCosines: orientation.slice(0, 3),
      columnCosines: orientation.slice(3),
      imagePositionPatient: f.position ?? [0, 0, f.instance],
      rowPixelSpacing: f.spacing?.[0] ?? 1,
      columnPixelSpacing: f.spacing?.[1] ?? 1,
      pixelSpacing: f.spacing,
      sliceThickness: 1,
    };
  }
  if (type === M.GENERAL_SERIES)
    return {
      modality: 'MR',
      seriesInstanceUID: f.seriesUID,
      studyInstanceUID: f.studyUID,
      seriesNumber: f.seriesNumber,
    };
  if (type === M.GENERAL_IMAGE) return { instanceNumber: f.instance, sopInstanceUID: f.sopUID };
  if (type === M.MODALITY_LUT)
    return {
      ...(extras.get(id)?.[type] as object),
      rescaleSlope: f.slope,
      rescaleIntercept: f.intercept,
    };
  if (type === M.VOI_LUT)
    return {
      ...(extras.get(id)?.[type] as object),
      windowCenter: f.windowCenter === undefined ? undefined : [f.windowCenter],
      windowWidth: f.windowWidth === undefined ? undefined : [f.windowWidth],
    };
  if (type === M.IMAGE_PIXEL)
    return (
      extras.get(id)?.[type] ?? {
        rows: f.rows,
        columns: f.columns,
        bitsAllocated: f.bits,
        bitsStored: f.bits,
        highBit: f.bits - 1,
        samplesPerPixel: 1,
        photometricInterpretation: f.photometric,
        pixelRepresentation: f.signed ? 1 : 0,
      }
    );
  if (type === 'transferSyntax') return { transferSyntaxUID: f.syntax };
  return extras.get(id)?.[type];
}
export function initialize(profile: Profile) {
  concurrency = profile === 'low' ? 1 : 2;
  void sources.configure(budgets[profile].source);
  if (!ready)
    ready = (async () => {
      logging.log.setLevel('silent');
      for (const logger of Object.values(logging.log.getLoggers()))
        (logger as { setLevel: (level: string) => void }).setLevel('silent');
      await init({ isMobile: profile === 'low', rendering: { webGlContextCount: 2 }, debug: {} });
      dicomLoader.init({ maxWebWorkers: profile === 'low' ? 1 : 2 });
      metaData.addProvider(provider, 10000);
      imageLoader.registerImageLoader('local', (id, options) => ({ promise: decode(id, options) }));
      cache.setMaxCacheSize(budgets[profile].cache);
    })();
  return ready;
}
export function registerFrames(incoming: Frame[]) {
  for (const f of incoming) frames.set(f.id, f);
}
export function forgetFrames(outgoing: Frame[]) {
  for (const f of outgoing) {
    frames.delete(f.id);
    extras.delete(f.id);
    if (cache.getImageLoadObject(f.id)) cache.removeImageLoadObject(f.id, { force: true });
  }
}
export function loadFrame(id: string) {
  return imageLoader.loadAndCacheImage(id);
}
export function retryFrame(id: string) {
  if (cache.getImageLoadObject(id)) cache.removeImageLoadObject(id, { force: true });
}
