import dicomParser from 'dicom-parser';
import dcmjs from 'dcmjs';
import type { DataSet } from 'dicom-parser';
import type { Frame, TagRow, Vec3 } from '../types';
// Supported monochrome image objects. Non-image objects are never treated as pixels.
const classicMR = '1.2.840.10008.5.1.4.1.1.4';
const enhancedMR = `${classicMR}.1`;
export const syntaxes = new Set([
  '1.2.840.10008.1.2',
  '1.2.840.10008.1.2.1',
  '1.2.840.10008.1.2.2',
  '1.2.840.10008.1.2.4.90',
  '1.2.840.10008.1.2.4.91',
  '1.2.840.10008.1.2.4.57',
  '1.2.840.10008.1.2.4.70',
  '1.2.840.10008.1.2.4.80',
  '1.2.840.10008.1.2.4.81',
  '1.2.840.10008.1.2.5',
]);
const numbers = (d: DataSet, tag: string) => d.string(tag)?.split('\\').map(Number);
const number = (d: DataSet, tag: string) => {
  const v = d.string(tag);
  return v ? Number(v.split('\\')[0]) : undefined;
};
const item = (d: DataSet | undefined, tag: string) => d?.elements[tag]?.items?.[0]?.dataSet;
const charsetLabels: Record<string, string> = {
  'ISO_IR 6': 'ascii',
  'ISO_IR 100': 'iso-8859-1',
  'ISO_IR 101': 'iso-8859-2',
  'ISO_IR 109': 'iso-8859-3',
  'ISO_IR 110': 'iso-8859-4',
  'ISO_IR 144': 'iso-8859-5',
  'ISO_IR 127': 'iso-8859-6',
  'ISO_IR 126': 'iso-8859-7',
  'ISO_IR 138': 'iso-8859-8',
  'ISO_IR 148': 'iso-8859-9',
  'ISO_IR 192': 'utf-8',
  GB18030: 'gb18030',
  GBK: 'gbk',
  'ISO 2022 IR 87': 'iso-2022-jp',
};
export function textValue(d: DataSet, tag: string, charset?: string) {
  const e = d.elements[tag];
  if (!e) return '';
  const cs = charset ?? d.string('x00080005') ?? 'ISO_IR 6';
  const label = charsetLabels[cs] ?? (cs.includes('ISO 2022 IR 87') ? 'iso-2022-jp' : undefined);
  if (!label) return '[Unsupported character set]';
  return new TextDecoder(label)
    .decode(d.byteArray.subarray(e.dataOffset, e.dataOffset + e.length))
    .replace(/[\0 ]+$/g, '');
}
export async function readHeader(blob: Blob): Promise<DataSet> {
  if (blob.size > 128 * 1024 ** 2)
    throw new Error('Instance exceeds the 128 MiB read limit. Use a smaller selection.');
  let size = Math.min(blob.size, 64 * 1024);
  while (size > 0) {
    try {
      return dicomParser.parseDicom(new Uint8Array(await blob.slice(0, size).arrayBuffer()), {
        untilTag: 'x7fe00010',
      });
    } catch {
      if (size >= blob.size)
        throw new Error('Unreadable or non-DICOM file. Part 10 headers are required.');
      size = Math.min(size * 2, blob.size);
    }
  }
  throw new Error('Empty file.');
}
export function indexDataset(d: DataSet, sourceId: string): Frame[] {
  const sop = d.string('x00080016');
  if (sop === '1.2.840.10008.1.3.10') return []; // DICOMDIR: direct recursive scanning discovers its referenced files.
  if (sop !== classicMR && sop !== enhancedMR)
    throw new Error(
      'Unsupported object: only classic MR and Enhanced MR monochrome images are accepted.',
    );
  if ((d.string('x00080008') ?? '').includes('MOSAIC'))
    throw new Error('Vendor mosaic images require a separate adapter.');
  const syntax = d.string('x00020010') ?? '';
  if (!syntaxes.has(syntax)) throw new Error('Unsupported transfer syntax.');
  const photo = d.string('x00280004') ?? '';
  if (!['MONOCHROME1', 'MONOCHROME2'].includes(photo) || d.uint16('x00280002') !== 1)
    throw new Error('Only single-channel monochrome MR pixels are supported.');
  const rows = d.uint16('x00280010') ?? 0,
    columns = d.uint16('x00280011') ?? 0,
    bits = d.uint16('x00280100') ?? 0;
  if (!rows || !columns || ![8, 16].includes(bits) || rows * columns > 16_000_000)
    throw new Error('Unsupported pixel dimensions or allocation.');
  const studyUID = d.string('x0020000d'),
    seriesUID = d.string('x0020000e'),
    sopUID = d.string('x00080018');
  if (!studyUID || !seriesUID || !sopUID)
    throw new Error('Required DICOM study, series, or instance identity is missing.');
  const count = number(d, 'x00280008') ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 20000)
    throw new Error('Invalid or excessive frame count.');
  const shared = item(d, 'x52009229');
  const per = d.elements.x52009230?.items;
  if (count > 1 && (sop !== enhancedMR || per?.length !== count))
    throw new Error('Multiframe image lacks supported per-frame spatial/dimension metadata.');
  return Array.from({ length: count }, (_, frame) => {
    const fg = per?.[frame]?.dataSet;
    const group = (tag: string) => item(fg, tag) ?? item(shared, tag) ?? d;
    const position = numbers(group('x00209113'), 'x00200032') as Vec3 | undefined;
    const orientation = numbers(group('x00209116'), 'x00200037');
    const diffusion = group('x00189117');
    const fc = group('x00209111');
    const dims = fc.elements.x00209157;
    const dimensionValues = dims
      ? Array.from({ length: dims.length / 4 }, (_, i) => fc.uint32('x00209157', i)).join(',')
      : '';
    // Dimension Index Values are retained excluding spatial position and temporal index.
    const dimensionDefs = d.elements.x00209222?.items;
    const extraDims =
      dimensionDefs
        ?.map((it, i) => ({
          pointer:
            (it.dataSet?.uint16('x00209165', 0) ?? 0) * 65536 +
            (it.dataSet?.uint16('x00209165', 1) ?? 0),
          value: dimensionValues.split(',')[i],
        }))
        .filter((x) => ![0x00209057, 0x00200032, 0x00209128].includes(x.pointer ?? 0))
        .map((x) => x.value)
        .join(',') ?? '';
    return {
      id: `local:${sourceId}:${frame}`,
      sourceId,
      frame,
      studyUID,
      seriesUID,
      sopUID,
      studyDescription: textValue(d, 'x00081030') || 'Untitled examination',
      studyDate: d.string('x00080020') || '',
      seriesDescription: textValue(d, 'x0008103e') || 'Untitled series',
      seriesDate: d.string('x00080021') || '',
      seriesNumber: number(d, 'x00200011') ?? 0,
      instance: number(d, 'x00200013') ?? frame,
      rows,
      columns,
      bits,
      signed: d.uint16('x00280103') === 1,
      photometric: photo,
      syntax,
      frameOfReference: d.string('x00200052'),
      position,
      orientation,
      spacing: numbers(group('x00289110'), 'x00280030'),
      windowCenter: number(group('x00289132'), 'x00281050'),
      windowWidth: number(group('x00289132'), 'x00281051'),
      slope: number(group('x00289145'), 'x00281053') ?? 1,
      intercept: number(group('x00289145'), 'x00281052') ?? 0,
      temporal: String(fc.uint32('x00209128') ?? number(d, 'x00200100') ?? ''),
      echo: String(
        group('x00189114').double('x00189082') ??
          number(d, 'x00180086') ??
          number(d, 'x00180081') ??
          '',
      ),
      diffusion: [
        diffusion.double('x00189087') ?? '',
        [0, 1, 2]
          .map((i) => (item(diffusion, 'x00189076') ?? diffusion).double('x00189089', i) ?? '')
          .join(','),
        extraDims,
      ].join('/'),
      imageType: d.string('x00080008') ?? '',
      frameTime: numbers(d, 'x00181065')?.[frame] || number(d, 'x00181063'),
    };
  });
}
const names: Record<string, string> = {
  x00080005: 'Specific Character Set',
  x00080008: 'Image Type',
  x00080016: 'SOP Class UID',
  x00080018: 'SOP Instance UID',
  x00080020: 'Study Date',
  x00080021: 'Series Date',
  x00080060: 'Modality',
  x00081030: 'Study Description',
  x0008103e: 'Series Description',
  x00100010: 'Patient Name',
  x00100020: 'Patient ID',
  x00100030: 'Patient Birth Date',
  x00100040: 'Patient Sex',
  x00180050: 'Slice Thickness',
  x00180081: 'Echo Time',
  x0020000d: 'Study Instance UID',
  x0020000e: 'Series Instance UID',
  x00200011: 'Series Number',
  x00200013: 'Instance Number',
  x00200032: 'Image Position Patient',
  x00200037: 'Image Orientation Patient',
  x00200052: 'Frame of Reference UID',
  x00280010: 'Rows',
  x00280011: 'Columns',
  x00280030: 'Pixel Spacing',
  x00281050: 'Window Center',
  x00281051: 'Window Width',
  x52009229: 'Shared Functional Groups',
  x52009230: 'Per-frame Functional Groups',
  x7fe00010: 'Pixel Data',
};
export function tags(
  d: DataSet,
  depth = 0,
  prefix = '',
  charset = d.string('x00080005'),
): TagRow[] {
  const result: TagRow[] = [];
  for (const [tag, e] of Object.entries(d.elements)) {
    const path = `${prefix}/${tag}`,
      vr =
        e.vr ??
        dcmjs.data.DicomMetaDictionary.dictionary[
          `(${tag.slice(1, 5)},${tag.slice(5)})`.toUpperCase()
        ]?.vr ??
        'UN';
    let value = '';
    if (e.items) value = `${e.items.length} sequence item(s)`;
    else if (tag === 'x7fe00010' || ['OB', 'OW', 'OF', 'OD', 'OL', 'OV', 'UN'].includes(vr))
      value = `Binary ${vr}, ${e.length} bytes`;
    else if (['US', 'SS', 'UL', 'SL', 'FL', 'FD'].includes(vr)) {
      const read = (
        { US: 'uint16', SS: 'int16', UL: 'uint32', SL: 'int32', FL: 'float', FD: 'double' } as const
      )[vr as 'US'];
      const bytes = ['US', 'SS'].includes(vr) ? 2 : vr === 'FD' ? 8 : 4;
      value = Array.from({ length: Math.min(64, e.length / bytes) }, (_, i) =>
        String(d[read](tag, i)),
      ).join(' \\ ');
    } else value = textValue(d, tag, charset).slice(0, 4096);
    result.push({
      tag: `(${tag.slice(1, 5)},${tag.slice(5)})`,
      name:
        names[tag] ??
        dcmjs.data.DicomMetaDictionary.dictionary[
          `(${tag.slice(1, 5)},${tag.slice(5)})`.toUpperCase()
        ]?.name.replace(/([a-z])([A-Z])/g, '$1 $2') ??
        'Unknown / private tag',
      vr,
      value,
      depth,
      path,
    });
    if (depth < 16)
      e.items?.forEach((it, i) => {
        if (it.dataSet) result.push(...tags(it.dataSet, depth + 1, `${path}[${i + 1}]`, charset));
      });
  }
  return result;
}
