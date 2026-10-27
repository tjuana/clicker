/** Vite inlines a binary asset imported with `?inline` as a base64 data URL. */
declare module '*.glb?inline' {
  const dataUrl: string;
  export default dataUrl;
}

/** A source file read as text, for a test that checks what the code names. */
declare module '*.tsx?raw' {
  const source: string;
  export default source;
}
