import { Component, inject, input, output, ChangeDetectionStrategy } from '@angular/core'
import { DatePipe } from '@angular/common'
import { MatTableModule } from '@angular/material/table'
import type { PageEvent } from '@angular/material/paginator'
import { MatPaginatorModule } from '@angular/material/paginator'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatTooltipModule } from '@angular/material/tooltip'
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog'
import { DragDropModule } from '@angular/cdk/drag-drop'
import type { Media } from '../models'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '../models'
import { TextEditorDialog } from './text-editor-dialog'
import { DialogTitlebar } from './dialog-titlebar'

// Category -> Material icon for the non-previewable fallback tile.
const CATEGORY_ICON: Record<Media['category'], string> = {
  image: 'image',
  video: 'movie',
  audio: 'audiotrack',
  text: 'description',
  document: 'article',
}

// File extension -> Monaco/Shiki language id for the text editor (default plaintext).
const TEXT_LANG: Record<string, string> = {
  txt: 'plaintext',
  md: 'markdown',
  html: 'html',
  css: 'css',
  scss: 'scss',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  json: 'json',
}

// Byte-size thresholds for the human-readable formatter.
const KILOBYTE = 1024
const MEGABYTE = KILOBYTE * 1024

// One-object argument for the raw-URL builder (max-params: single param).
export interface RawUrlBuilderArgs {
  media: Media
  download: boolean
}

// Payload for the media preview dialog (image lightbox, audio or video player).
export interface MediaPreviewData {
  kind: 'image' | 'audio' | 'video'
  src: string
  alt: string
}

// Preview dialog: full-size image, audio or video player, click the backdrop to dismiss.
// Draggable within the viewport by its title bar (the whole pane moves).
@Component({
  selector: 'app-media-preview-dialog',
  imports: [MatDialogModule, DialogTitlebar, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div cdkDrag cdkDragRootElement=".cdk-overlay-pane" cdkDragBoundary=".cdk-overlay-container">
      <app-dialog-titlebar [title]="data.alt" />
      <mat-dialog-content class="body">
        @if (data.kind === 'image') {
          <img class="preview" [src]="data.src" [alt]="data.alt" />
        } @else if (data.kind === 'audio') {
          <audio class="preview" [src]="data.src" [attr.aria-label]="data.alt" controls autoplay></audio>
        } @else {
          <video class="preview" [src]="data.src" [attr.aria-label]="data.alt" controls autoplay></video>
        }
      </mat-dialog-content>
    </div>
  `,
  styles: `
    .body { padding: 0; max-height: 85vh; }
    .preview { display: block; max-width: 80vw; max-height: 80vh; }
    audio.preview { width: min(80vw, 360px); }
    video.preview { width: min(80vw, 640px); }
  `,
})
export class MediaPreviewDialog {
  readonly data = inject<MediaPreviewData>(MAT_DIALOG_DATA)
}

// Reusable paginated media table (own uploads, folder contents, public view).
// Presentational: the parent supplies the raw-URL builder + which actions show,
// and receives page/action events. Open + download are plain cookie-authed anchors.
@Component({
  selector: 'app-media-table',
  imports: [DatePipe, MatTableModule, MatPaginatorModule, MatIconModule, MatButtonModule, MatTooltipModule],
  templateUrl: './media-table.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './media-table.scss',
})
export class MediaTable {
  readonly items = input.required<Media[]>()
  readonly total = input.required<number>()
  readonly pageSize = input<number>(DEFAULT_PAGE_SIZE)
  readonly pageIndex = input<number>(0)

  // Builds the /raw URL for a row (differs between owner + folder-scoped routes).
  readonly rawUrl = input.required<(inArgs: RawUrlBuilderArgs) => string>()

  // Toggle the per-row action buttons per host page.
  readonly showDelete = input(false) // owner: delete media entirely
  readonly showRemove = input(false) // folder-detail: dereference from folder
  readonly showAdd = input(false) // folder-detail: add own media to folder

  // Owner contexts allow saving text edits; read-only views (public) leave it false.
  readonly editable = input(false)

  readonly pageChange = output<PageEvent>()
  readonly deleted = output<Media>()
  readonly removed = output<Media>()
  readonly added = output<Media>()

  readonly pageSizeOptions = PAGE_SIZE_OPTIONS
  readonly columns = ['preview', 'filename', 'category', 'size', 'uploaded', 'actions']

  private readonly dialog = inject(MatDialog)

  iconFor (inMedia: Media): string {
    return CATEGORY_ICON[inMedia.category]
  }

  // Open the media in a modal preview (image lightbox, audio or video player).
  openPreview (inMedia: Media): void {
    const playable = inMedia.category === 'audio' || inMedia.category === 'video'
    const kind = playable ? inMedia.category : 'image'
    this.dialog.open(MediaPreviewDialog, {
      data: { kind: kind, src: this.rawUrl()({ media: inMedia, download: false }), alt: inMedia.filename },
    })
  }

  // Open a text file in the Monaco editor (read-only unless this table is editable).
  openText (inMedia: Media): void {
    const ext = inMedia.filename.split('.').pop()?.toLowerCase() ?? ''
    this.dialog.open(TextEditorDialog, {
      data: {
        src: this.rawUrl()({ media: inMedia, download: false }),
        filename: inMedia.filename,
        mediaId: inMedia.id,
        editable: this.editable(),
        lang: TEXT_LANG[ext] ?? 'plaintext',
      },
      maxWidth: '90vw',
    })
  }

  // Human-readable byte size.
  formatSize (inBytes: number): string {
    let result = `${(inBytes / MEGABYTE).toFixed(1)} MB`
    if (inBytes < KILOBYTE) { result = `${inBytes} B` }
    if (inBytes >= KILOBYTE && inBytes < MEGABYTE) { result = `${(inBytes / KILOBYTE).toFixed(1)} KB` }
    return result
  }
}
