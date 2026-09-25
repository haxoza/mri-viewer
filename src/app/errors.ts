/** Only explicitly authored messages cross the agent boundary; decoder errors may contain IDs. */
export class ViewerError extends Error {}
export const memoryError =
  'MPR exceeds this memory profile. Close a reconstruction or select a smaller series; stack viewing remains available.';
