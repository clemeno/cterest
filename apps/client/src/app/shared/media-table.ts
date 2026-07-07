import { Component, input, output, ChangeDetectionStrategy } from '@angular/core'
import { DatePipe } from '@angular/common'
import { MatTableModule } from '@angular/material/table'
import type { PageEvent } from '@angular/material/paginator'
import { MatPaginatorModule } from '@angular/material/paginator'
import { MatIconModule } from '@angular/material/icon'
import { MatButtonModule } from '@angular/material/button'
import { MatTooltipModule } from '@angular/material/tooltip'
import type { Media } from '../models'
import { kDefaultPageSize, kPageSizeOptions } from '../models'

// Category -> Material icon for the non-previewable fallback tile.
const kCategoryIcon: Record<Media['category'], string> = {
  image: 'image',
  video: 'movie',
  audio: 'audiotrack',
  text: 'description',
  document: 'article',
}

// Byte-size thresholds for the human-readable formatter.
const kKilobyte = 1024
const kMegabyte = kKilobyte * 1024

// One-object argument for the raw-URL builder (max-params: single param).
export interface RawUrlBuilderArgs {
  media: Media
  download: boolean
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
  readonly pageSize = input<number>(kDefaultPageSize)
  readonly pageIndex = input<number>(0)

  // Builds the /raw URL for a row (differs between owner + folder-scoped routes).
  readonly rawUrl = input.required<(inArgs: RawUrlBuilderArgs) => string>()

  // Toggle the per-row action buttons per host page.
  readonly showDelete = input(false) // owner: delete media entirely
  readonly showRemove = input(false) // folder-detail: dereference from folder
  readonly showAdd = input(false) // folder-detail: add own media to folder

  readonly pageChange = output<PageEvent>()
  readonly deleted = output<Media>()
  readonly removed = output<Media>()
  readonly added = output<Media>()

  readonly pageSizeOptions = kPageSizeOptions
  readonly columns = ['preview', 'filename', 'category', 'size', 'uploaded', 'actions']

  iconFor (inMedia: Media): string {
    return kCategoryIcon[inMedia.category]
  }

  // Human-readable byte size.
  formatSize (inBytes: number): string {
    let vResult = `${(inBytes / kMegabyte).toFixed(1)} MB`
    if (inBytes < kKilobyte) { vResult = `${inBytes} B` }
    if (inBytes >= kKilobyte && inBytes < kMegabyte) { vResult = `${(inBytes / kKilobyte).toFixed(1)} KB` }
    return vResult
  }
}
