// Monaco's deep ESM entry (editor core, no bundled languages) is resolvable at build
// time by esbuild but its package "exports" map does not expose types for the subpath.
// Declare it as the same surface as the package root so the dynamic import stays typed.
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

// Side-effect-only worker bootstrap module (no exports).
declare module 'monaco-editor/esm/vs/editor/editor.worker.js'
