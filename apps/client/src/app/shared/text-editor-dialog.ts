import type { ElementRef } from '@angular/core'
import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, effect, inject, signal, viewChild } from '@angular/core'
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner'
import { DragDropModule } from '@angular/cdk/drag-drop'
import type * as MonacoNs from 'monaco-editor'
import type { BundledLanguage, Highlighter, ThemeRegistrationAny } from 'shiki'
import { MediaService } from '../core/media.service'
import { clemMonokai001Theme } from './clem-monokai-001.theme'
import { DialogTitlebar } from './dialog-titlebar'

// Data handed to the dialog by MediaTable.openText().
export interface TextEditorData {
  src: string // context-correct GET /raw URL (owner or folder-scoped)
  filename: string // shown in the header
  mediaId: string // owner PUT target when saving
  editable: boolean // false in public/read-only views -> read-only editor, no Save
  lang: string // Monaco/Shiki language id derived from the extension
}

// Registered Monaco theme name; matches clemMonokai001Theme.name so Shiki and the
// plaintext fallback both resolve to the same colours.
const kThemeName = 'clem-monokai-001'

// Editor options mirroring the VSCode config this project is developed under.
const kFontFamily = "'Fira Code', 'Consolas', monospace"
const kFontSize = 14
const kLineHeight = 16
const kTabSize = 2

// Vertical guide lines drawn at these columns (soft/hard wrap conventions).
const kRulers = [80, 140]

// Styling for the markdown preview page: black background + white text (the app's dark
// main theme), except blockquotes and code, which keep their own accent styling. Fenced
// code blocks carry Shiki's inline monokai background, so it wins over the pre rule here.
const kPreviewCss = 'body{margin:0;padding:16px;background:#151316;color:#fff;font:14px/1.5 sans-serif;}' +
  'a{color:#66d9ef;}img{max-width:100%;}table{border-collapse:collapse;}th,td{border:1px solid #45575e;padding:4px 8px;}' +
  'blockquote{margin:0;padding:4px 12px;border-left:4px solid #66d9ef;background:#1a2a30;color:#F8F8F2;}' +
  `pre,code{font-family:${kFontFamily};}pre{background:#0f1c21;padding:12px;border-radius:4px;overflow:auto;}`

// Full-size text preview/editor. Monaco (the VSCode editor widget) is dynamically
// imported so its bundle is a lazy chunk loaded only when a text file is opened; Shiki
// supplies TextMate tokenisation with the ported CLEm_Monokai_001 theme, so no Monaco
// language web-workers are needed (only the base editor worker).
@Component({
  selector: 'app-text-editor-dialog',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatDialogModule, DragDropModule, DialogTitlebar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div cdkDrag cdkDragRootElement=".cdk-overlay-pane" cdkDragBoundary=".cdk-overlay-container">
      <app-dialog-titlebar icon="description" [title]="data.filename">
        @if (data.editable) {
          <button leading mat-button (click)="save()" [disabled]="saving() || loading()">
            <mat-icon>save</mat-icon>
            {{ saving() ? 'Saving…' : 'Save' }}
          </button>
        }
        @if (canPreview) {
          <button leading mat-button (click)="togglePreview()">
            <mat-icon>vertical_split</mat-icon>
            {{ showPreview() ? 'Hide preview' : 'Preview' }}
          </button>
        }
        @if (error() !== '') {
          <span class="err">{{ error() }}</span>
        }
      </app-dialog-titlebar>
      <mat-dialog-content class="wrap">
        <div #host class="editor"></div>
        @if (showPreview()) {
          <iframe #frame class="preview" sandbox="allow-same-origin" title="Preview"></iframe>
        }
        @if (loading()) {
          <div class="loading"><mat-progress-spinner mode="indeterminate" [diameter]="36" /></div>
        }
      </mat-dialog-content>
    </div>
  `,
  styles: `
    .err { color: #ff6b6b; font-size: 12px; }
    .wrap { position: relative; display: flex; gap: 8px; width: 90vw; padding: 0; max-height: none; }
    .editor { flex: 2 1 0; min-width: 0; height: 70vh; }
    .preview { flex: 1 1 0; min-width: 0; height: 70vh; border: 0; border-radius: 4px; background: #151316; }
    .loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
  `,
})
export class TextEditorDialog {
  readonly data = inject<TextEditorData>(MAT_DIALOG_DATA)
  private readonly media = inject(MediaService)
  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host')
  private readonly frame = viewChild<ElementRef<HTMLIFrameElement>>('frame')

  readonly loading = signal(true)
  readonly saving = signal(false)
  readonly error = signal('')

  // Rendered preview is offered only for languages we can render (markdown, html);
  // when available it is shown by default. previewDoc holds the built iframe document.
  readonly canPreview = this.data.lang === 'markdown' || this.data.lang === 'html'
  readonly showPreview = signal(this.canPreview)
  private readonly previewDoc = signal('')

  private editor: MonacoNs.editor.IStandaloneCodeEditor | null = null

  constructor () {
    // init() catches its own failures, so this never rejects; the catch only satisfies
    // no-floating-promises without the (banned) void operator.
    afterNextRender(() => { this.init().catch(() => undefined) })
    // Push the latest rendered document into the iframe whenever either the frame
    // (toggled on) or the content changes. srcdoc is set imperatively to bypass
    // Angular HTML sanitisation; the iframe sandbox (no allow-scripts) contains it.
    effect(() => {
      const vFrame = this.frame()
      const vDoc = this.previewDoc()
      if (vFrame !== undefined && vDoc !== '') {
        vFrame.nativeElement.srcdoc = vDoc
      }
    })
    inject(DestroyRef).onDestroy(() => { this.dispose() })
  }

  // Load Monaco + the file, wire highlighting, then create the editor. Any failure
  // surfaces in the header instead of throwing.
  private async init (): Promise<void> {
    try {
      const vMonaco: typeof MonacoNs = await import('monaco-editor/esm/vs/editor/editor.api')
      ensureMonacoWorker()
      const vText = await this.media.readRaw(this.data.src)
      await applyHighlighting({ monaco: vMonaco, lang: this.data.lang })
      this.editor = vMonaco.editor.create(this.host().nativeElement, {
        value: vText,
        language: this.data.lang,
        theme: kThemeName,
        readOnly: !this.data.editable,
        fontFamily: kFontFamily,
        fontLigatures: false,
        fontSize: kFontSize,
        lineHeight: kLineHeight,
        tabSize: kTabSize,
        insertSpaces: true,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        lineNumbers: 'on',
        rulers: kRulers,
      })
      this.editor.onDidChangeModelContent(() => { this.updatePreview() })
      if (this.data.editable) {
        // Ctrl/Cmd+S saves (mirrors the header button) and swallows the browser's
        // save-page dialog while the editor has focus.
        this.editor.addCommand(vMonaco.KeyMod.CtrlCmd | vMonaco.KeyCode.KeyS, () => { this.save().catch(() => undefined) })
      }
      this.updatePreview()
    } catch (vErr: unknown) {
      this.error.set(errorMessage(vErr))
    } finally {
      this.loading.set(false)
    }
  }

  // Show/hide the side-by-side rendered preview and refresh it when shown.
  togglePreview (): void {
    this.showPreview.update(inShown => !inShown)
    this.updatePreview()
  }

  // Re-render the preview from the current buffer (no-op unless preview is visible).
  private updatePreview (): void {
    if (this.canPreview && this.showPreview()) {
      this.renderPreview(this.editor?.getValue() ?? '').catch(() => undefined)
    }
  }

  // Build the iframe document: markdown is parsed to HTML (marked, lazy-imported) and
  // wrapped in a themed page; html files are shown verbatim.
  private async renderPreview (inText: string): Promise<void> {
    let vBody = inText
    if (this.data.lang === 'markdown') {
      vBody = await renderMarkdown(inText)
    }
    this.previewDoc.set(buildPreviewDoc({ lang: this.data.lang, body: vBody }))
  }

  // Write the current buffer back through the owner PUT route.
  async save (): Promise<void> {
    const vEditor = this.editor
    if (vEditor !== null && !this.saving()) {
      this.saving.set(true)
      this.error.set('')
      try {
        await this.media.saveText({ id: this.data.mediaId, content: vEditor.getValue() })
      } catch (vErr: unknown) {
        this.error.set(errorMessage(vErr))
      } finally {
        this.saving.set(false)
      }
    }
  }

  private dispose (): void {
    // Only the editor is per-dialog. The shared highlighter is intentionally NOT disposed:
    // Monaco is a global singleton and its token providers capture the highlighter, so
    // disposing here would leave Monaco referencing a dead instance ("Shiki instance has
    // been disposed") on the next tokenisation.
    this.editor?.dispose()
  }
}

// Register the base Monaco worker once. Shiki does tokenisation, so only the editor
// worker (not the per-language services) is ever requested.
function ensureMonacoWorker (): void {
  const vGlobal = self as unknown as { MonacoEnvironment?: unknown }
  if (vGlobal.MonacoEnvironment === undefined) {
    vGlobal.MonacoEnvironment = {
      getWorker: () => new Worker(new URL('./monaco-editor.worker', import.meta.url), { type: 'module' }),
    }
  }
}

// Session-wide Shiki highlighter and its lazy init promise (guards concurrent opens).
// Shared on purpose: Monaco is a global singleton whose token providers capture the
// highlighter, so one instance must outlive every dialog. Grammars load on demand.
let gHighlighter: Highlighter | null = null
let gHighlighterInit: Promise<Highlighter> | null = null

// True once a theme named kThemeName exists in Monaco (via Shiki or the plaintext
// fallback). Stops the plaintext branch clobbering the rich Shiki theme.
let gThemeReady = false

// Get (or lazily create once) the shared highlighter, carrying the ported theme.
async function getHighlighter (): Promise<Highlighter> {
  gHighlighterInit ??= createSharedHighlighter()
  return gHighlighterInit
}

// One-time highlighter build; languages are added later via loadLanguage().
async function createSharedHighlighter (): Promise<Highlighter> {
  const { createHighlighter } = await import('shiki')
  gHighlighter = await createHighlighter({ themes: [clemMonokai001Theme as unknown as ThemeRegistrationAny], langs: [] })
  return gHighlighter
}

// Apply CLEm_Monokai_001 colours. Code langs go through the shared Shiki highlighter
// (real TextMate scopes); plaintext has no grammar, so just define a theme carrying the
// editor bg/fg. Never disposes anything.
async function applyHighlighting (inArgs: { monaco: typeof MonacoNs; lang: string }): Promise<void> {
  const { monaco: vMonaco, lang: vLang } = inArgs
  if (vLang === 'plaintext') {
    if (!gThemeReady) {
      vMonaco.editor.defineTheme(kThemeName, {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: { 'editor.background': '#1a2a30', 'editor.foreground': '#F8F8F2' },
      })
      gThemeReady = true
    }
  } else {
    const vHighlighter = await getHighlighter()
    if (!vHighlighter.getLoadedLanguages().includes(vLang)) {
      await vHighlighter.loadLanguage(vLang as BundledLanguage)
    }
    const { shikiToMonaco } = await import('@shikijs/monaco')
    vMonaco.languages.register({ id: vLang })
    shikiToMonaco(vHighlighter, vMonaco)
    gThemeReady = true
  }
}

// Parse markdown to HTML (marked, lazy-imported). Fenced code blocks are coloured via
// the shared Shiki highlighter with the same theme as the editor; grammars are preloaded
// from the fences first (codeToHtml is synchronous and needs the language ready), and an
// unknown/absent language falls back to marked's default plain <pre><code>.
async function renderMarkdown (inText: string): Promise<string> {
  const { Marked } = await import('marked')
  const vHighlighter = await getHighlighter()
  const vLoaded = vHighlighter.getLoadedLanguages()
  for (const vMatch of inText.matchAll(/^[ \t]*```([\w-]+)/gm)) {
    const vLang = vMatch[1]
    if (vLang !== undefined && !vLoaded.includes(vLang)) {
      await vHighlighter.loadLanguage(vLang as BundledLanguage).catch(() => undefined)
    }
  }
  const vMarked = new Marked()
  vMarked.use({
    renderer: {
      code ({ text, lang }) {
        let vOut: string | false = false
        if (typeof lang === 'string' && lang !== '' && vHighlighter.getLoadedLanguages().includes(lang)) {
          vOut = vHighlighter.codeToHtml(text, { lang, theme: kThemeName })
        }
        return vOut
      },
    },
  })
  return vMarked.parse(inText)
}

// Wrap preview body for the iframe: html files render verbatim; markdown-rendered HTML
// is wrapped in a themed document so it reads like the editor.
function buildPreviewDoc (inArgs: { lang: string; body: string }): string {
  let vResult = inArgs.body
  if (inArgs.lang === 'markdown') {
    vResult = `<!doctype html><meta charset="utf-8"><style>${kPreviewCss}</style>${inArgs.body}`
  }
  return vResult
}

// Human-readable message from an unknown thrown value.
function errorMessage (inErr: unknown): string {
  return inErr instanceof Error ? inErr.message : 'Something went wrong'
}
