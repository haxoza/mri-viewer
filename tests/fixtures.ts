import type { Frame } from '../src/imaging/types';
export function frame(index: number, overrides: Partial<Frame> = {}): Frame {
  return {
    id: `local:synthetic-${index}:0`,
    sourceId: `synthetic-${index}`,
    frame: 0,
    studyUID: '1.2.3',
    seriesUID: '1.2.3.4',
    sopUID: `1.2.3.4.${index}`,
    studyDescription: 'Synthetic examination',
    studyDate: '',
    seriesDescription: 'Synthetic ramp',
    seriesDate: '',
    seriesNumber: 1,
    instance: index,
    rows: 32,
    columns: 32,
    bits: 16,
    signed: false,
    photometric: 'MONOCHROME2',
    syntax: '1.2.840.10008.1.2.1',
    frameOfReference: '1.2.3.5',
    position: [0, 0, index * 2],
    orientation: [1, 0, 0, 0, 1, 0],
    spacing: [1, 1],
    slope: 1,
    intercept: 0,
    temporal: '',
    echo: '',
    diffusion: '//',
    imageType: 'ORIGINAL',
    ...overrides,
  };
}
// Synthetic Part 10 data generated in code: no patient data or binary fixtures in Git.
export function dicom(
  index: number,
  options: { signed?: boolean; inverted?: boolean; series?: number } = {},
) {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  function element(group: number, tag: number, vr: string, value: string | number | Uint8Array) {
    let bytes: Uint8Array;
    if (typeof value === 'number') {
      bytes = new Uint8Array(2);
      new DataView(bytes.buffer).setUint16(0, value, true);
    } else if (typeof value === 'string') {
      bytes = encoder.encode(value + (value.length % 2 ? (vr === 'UI' ? '\0' : ' ') : ''));
    } else bytes = value;
    const long = ['OB', 'OW', 'SQ', 'UN', 'UT'].includes(vr);
    const h = new Uint8Array(long ? 12 : 8);
    const d = new DataView(h.buffer);
    d.setUint16(0, group, true);
    d.setUint16(2, tag, true);
    h.set(encoder.encode(vr), 4);
    if (long) d.setUint32(8, bytes.length, true);
    else d.setUint16(6, bytes.length, true);
    chunks.push(h, bytes);
  }
  const prefix = new Uint8Array(132);
  prefix.set(encoder.encode('DICM'), 128);
  chunks.push(prefix);
  element(2, 0x10, 'UI', '1.2.840.10008.1.2.1');
  element(8, 0x16, 'UI', '1.2.840.10008.5.1.4.1.1.4');
  element(8, 0x18, 'UI', `1.2.3.${options.series ?? 1}.${index + 1}`);
  element(8, 0x60, 'CS', 'MR');
  element(8, 0x1030, 'LO', 'Synthetic examination');
  element(8, 0x103e, 'LO', `Synthetic volume ${options.series ?? 1}`);
  element(0x20, 0x0d, 'UI', '1.2.3');
  element(0x20, 0x0e, 'UI', `1.2.3.${options.series ?? 1}`);
  element(0x20, 0x11, 'IS', String(options.series ?? 1));
  element(0x20, 0x13, 'IS', String(index + 1));
  element(0x20, 0x32, 'DS', `0\\0\\${index * 2}`);
  element(0x20, 0x37, 'DS', '1\\0\\0\\0\\1\\0');
  element(0x20, 0x52, 'UI', '1.2.3.99');
  element(0x28, 2, 'US', 1);
  element(0x28, 4, 'CS', options.inverted ? 'MONOCHROME1' : 'MONOCHROME2');
  element(0x28, 0x10, 'US', 32);
  element(0x28, 0x11, 'US', 32);
  element(0x28, 0x30, 'DS', '1\\1');
  element(0x28, 0x100, 'US', 16);
  element(0x28, 0x101, 'US', 16);
  element(0x28, 0x102, 'US', 15);
  element(0x28, 0x103, 'US', options.signed ? 1 : 0);
  element(0x28, 0x1050, 'DS', '512');
  element(0x28, 0x1051, 'DS', '1024');
  element(0x28, 0x1052, 'DS', options.signed ? '-100' : '0');
  element(0x28, 0x1053, 'DS', '1');
  const pixels = new Uint8Array(32 * 32 * 2);
  const view = new DataView(pixels.buffer);
  for (let i = 0; i < 1024; i++) view.setInt16(i * 2, (i + index * 32) % 1024, true);
  element(0x7fe0, 0x10, 'OW', pixels);
  const result = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

function concat(parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return result;
}
function rawTag(tag: number, vr: string, data: string | Uint8Array) {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data + (data.length % 2 ? (vr === 'UI' ? '\0' : ' ') : ''))
      : data;
  const long = ['OW', 'SQ'].includes(vr);
  const header = new Uint8Array(long ? 12 : 8);
  const view = new DataView(header.buffer);
  view.setUint16(0, tag >>> 16, true);
  view.setUint16(2, tag & 65535, true);
  header.set(new TextEncoder().encode(vr), 4);
  if (long) view.setUint32(8, bytes.length, true);
  else view.setUint16(6, bytes.length, true);
  return concat([header, bytes]);
}
function sequence(tag: number, items: Uint8Array[]) {
  return rawTag(
    tag,
    'SQ',
    concat(
      items.map((data) => {
        const header = new Uint8Array(8);
        const v = new DataView(header.buffer);
        v.setUint16(0, 0xfffe, true);
        v.setUint16(2, 0xe000, true);
        v.setUint32(4, data.length, true);
        return concat([header, data]);
      }),
    ),
  );
}
function ul(...numbers: number[]) {
  const bytes = new Uint8Array(numbers.length * 4),
    view = new DataView(bytes.buffer);
  numbers.forEach((n, i) => view.setUint32(i * 4, n, true));
  return bytes;
}
export function enhancedDicom() {
  const original = dicom(0);
  const body: Uint8Array[] = [];
  const view = new DataView(original.buffer);
  for (let at = 132; at < original.length;) {
    const tag = view.getUint16(at, true) * 65536 + view.getUint16(at + 2, true);
    const vr = new TextDecoder().decode(original.slice(at + 4, at + 6));
    const header = ['OW', 'SQ', 'OB'].includes(vr) ? 12 : 8;
    const length = header === 12 ? view.getUint32(at + 8, true) : view.getUint16(at + 6, true);
    if (![0x00080016, 0x7fe00010].includes(tag))
      body.push(original.slice(at, at + header + length));
    at += header + length;
  }
  // Dimension pointers are AT values (two little-endian uint16s), not a little-endian uint32 tag number.
  body.push(
    rawTag(0x00080016, 'UI', '1.2.840.10008.5.1.4.1.1.4.1'),
    rawTag(0x00280008, 'IS', '6'),
    rawTag(0x00181065, 'DS', '0\\40\\40\\80\\80\\80'),
  );
  body.push(
    sequence(0x00209222, [
      rawTag(0x00209165, 'AT', new Uint8Array([0x20, 0, 0x57, 0x90])),
      rawTag(0x00209165, 'AT', new Uint8Array([0x20, 0, 0x28, 0x91])),
    ]),
  );
  body.push(
    sequence(
      0x52009230,
      Array.from({ length: 6 }, (_, frame) =>
        concat([
          sequence(0x00209113, [rawTag(0x00200032, 'DS', `0\\0\\${(frame % 3) * 2}`)]),
          sequence(0x00209111, [
            concat([
              rawTag(0x00209128, 'UL', ul(Math.floor(frame / 3) + 1)),
              rawTag(0x00209157, 'UL', ul((frame % 3) + 1, Math.floor(frame / 3) + 1)),
            ]),
          ]),
        ]),
      ),
    ),
  );
  const pixels = new Uint8Array(6 * 32 * 32 * 2),
    pv = new DataView(pixels.buffer);
  for (let i = 0; i < pixels.length / 2; i++) pv.setUint16(i * 2, i % 1024, true);
  body.push(rawTag(0x7fe00010, 'OW', pixels));
  body.sort((a, b) => {
    const x = new DataView(a.buffer, a.byteOffset),
      y = new DataView(b.buffer, b.byteOffset);
    return (
      x.getUint16(0, true) - y.getUint16(0, true) || x.getUint16(2, true) - y.getUint16(2, true)
    );
  });
  return concat([original.slice(0, 132), ...body]);
}
