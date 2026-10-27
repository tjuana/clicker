/** Vite inlines a binary asset imported with `?inline` as a base64 data URL. */
declare module '*.glb?inline' {
  const dataUrl: string;
  export default dataUrl;
}
