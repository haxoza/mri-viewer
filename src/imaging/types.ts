export type Vec3 = [number, number, number];
export type Plane = 'axial' | 'sagittal' | 'coronal';
export type Profile = 'standard' | 'low';
export interface Frame {
  id: string;
  sourceId: string;
  frame: number;
  studyUID: string;
  seriesUID: string;
  sopUID: string;
  studyDescription: string;
  studyDate: string;
  seriesDescription: string;
  seriesDate: string;
  seriesNumber: number;
  instance: number;
  rows: number;
  columns: number;
  bits: number;
  signed: boolean;
  photometric: string;
  syntax: string;
  frameOfReference?: string;
  position?: Vec3;
  orientation?: number[];
  spacing?: number[];
  windowCenter?: number;
  windowWidth?: number;
  slope: number;
  intercept: number;
  temporal: string;
  echo: string;
  diffusion: string;
  imageType: string;
  frameTime?: number;
}
export interface DisplaySet {
  id: string;
  seriesUID: string;
  frames: Frame[];
  geometry: boolean;
  normal?: Vec3;
  positions: number[];
  orientation: string;
  dimension: string;
  warning?: string;
}
export interface Series {
  uid: string;
  description: string;
  date: string;
  number: number;
  sets: DisplaySet[];
}
export interface Study {
  uid: string;
  description: string;
  date: string;
  series: Series[];
}
export interface TagRow {
  tag: string;
  name: string;
  vr: string;
  value: string;
  depth: number;
  path: string;
}
export const budgets = {
  standard: {
    cache: 256 * 1024 ** 2,
    volume: 640 * 1024 ** 2,
    volumes: 2,
    exportSide: 4096,
    exportPixels: 16_000_000,
    source: 96 * 1024 ** 2,
  },
  low: {
    cache: 128 * 1024 ** 2,
    volume: 384 * 1024 ** 2,
    volumes: 1,
    exportSide: 2048,
    exportPixels: 4_000_000,
    source: 48 * 1024 ** 2,
  },
};
