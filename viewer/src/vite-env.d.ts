/// <reference types="vite/client" />

declare module '*?raw' {
  const source: string
  export default source
}

declare module 'https://cdn.jsdelivr.net/pyodide/v0.27.7/full/pyodide.mjs' {
  export function loadPyodide(config: { indexURL: string }): Promise<{
    FS: {
      writeFile: (path: string, data: Uint8Array | string) => void
      readFile: (path: string) => Uint8Array
    }
    globals: {
      set: (name: string, value: unknown) => void
      get: (name: string) => unknown
    }
    runPython: (code: string) => unknown
    loadPackage: (
      names: string | string[],
      opts?: { messageCallback?: (msg: string) => void },
    ) => Promise<void>
  }>
}

