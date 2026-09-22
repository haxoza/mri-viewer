import type { Frame, Study } from './types';
import { dot, normalOf, orientationName, sameOrientation, validGeometry } from './geometry';
export function buildCatalog(frames: Frame[]): Study[] {
  const studies = new Map<string, Study>();
  for (const f of frames) {
    let study = studies.get(f.studyUID);
    if (!study) {
      study = { uid: f.studyUID, description: f.studyDescription, date: f.studyDate, series: [] };
      studies.set(f.studyUID, study);
    }
    let series = study.series.find((s) => s.uid === f.seriesUID);
    if (!series) {
      series = {
        uid: f.seriesUID,
        description: f.seriesDescription,
        date: f.seriesDate,
        number: f.seriesNumber,
        sets: [],
      };
      study.series.push(series);
    }
    const dimension = `Time ${f.temporal || '–'} · Echo ${f.echo || '–'} · Diffusion ${f.diffusion}`;
    let set = series.sets.find((s) => {
      const a = s.frames[0];
      return (
        s.dimension === dimension &&
        a.rows === f.rows &&
        a.columns === f.columns &&
        a.bits === f.bits &&
        a.signed === f.signed &&
        a.imageType === f.imageType &&
        a.frameOfReference === f.frameOfReference &&
        ((validGeometry(a) && validGeometry(f) && sameOrientation(a, f)) ||
          (!validGeometry(a) && !validGeometry(f)))
      );
    });
    if (!set) {
      set = {
        id: `set-${f.id}`,
        seriesUID: f.seriesUID,
        frames: [],
        geometry: validGeometry(f),
        normal: normalOf(f),
        positions: [],
        orientation: orientationName(normalOf(f)),
        dimension,
      };
      series.sets.push(set);
    }
    set.frames.push(f);
  }
  for (const study of studies.values()) {
    study.series.sort((a, b) => a.number - b.number);
    for (const series of study.series)
      for (const s of series.sets) {
        s.frames.sort((a, b) =>
          s.geometry
            ? dot(a.position!, s.normal!) - dot(b.position!, s.normal!) ||
              a.instance - b.instance ||
              a.id.localeCompare(b.id)
            : a.instance - b.instance || a.id.localeCompare(b.id),
        );
        s.positions = s.geometry ? s.frames.map((f) => dot(f.position!, s.normal!)) : [];
        if (!s.geometry) s.warning = 'Spatial order unavailable; ordered by instance number.';
        else if (s.positions.some((p, i) => i > 0 && Math.abs(p - s.positions[i - 1]) < 0.01))
          s.warning = 'Repeated spatial positions; MPR is unavailable.';
      }
  }
  return [...studies.values()];
}
export const allSets = (studies: Study[]) =>
  studies.flatMap((s) => s.series.flatMap((s) => s.sets));
