/// <reference types="vite/client" />

// QNBS-v3: Allow ?raw imports for WGSL compute shader sources (bundled as strings by Vite)
declare module '*.wgsl?raw' {
  const source: string;
  export default source;
}
