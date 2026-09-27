import { useSession } from '../../app/store';
import { allSets } from '../../imaging/catalog';

// Human-readable session labels, never DICOM descriptions or identifiers.
export function viewLabel(setId?: string) {
  const index = allSets(useSession.getState().studies).findIndex((s) => s.id === setId);
  return index < 0 ? null : `View ${index + 1}`;
}
