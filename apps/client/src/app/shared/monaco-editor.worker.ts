// Local worker entry for Monaco's base editor service. Angular's esbuild builder only
// resolves `new Worker(new URL('./relative', import.meta.url))` against project files,
// not bare package specifiers — so this thin module re-exports Monaco's worker and is
// referenced relatively from text-editor-dialog.ts.
import 'monaco-editor/esm/vs/editor/editor.worker.js'
