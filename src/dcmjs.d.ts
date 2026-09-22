declare module 'dcmjs' {
  const dcmjs: {
    data: { DicomMetaDictionary: { dictionary: Record<string, { name: string; vr: string }> } };
  };
  export default dcmjs;
}
