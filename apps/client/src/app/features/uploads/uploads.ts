import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import type { PageEvent } from '@angular/material/paginator'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatProgressBarModule } from '@angular/material/progress-bar'
import { MediaService } from '../../core/media.service'
import type { Media } from '../../models'
import { DEFAULT_PAGE_SIZE } from '../../models'
import { MediaTable } from '../../shared/media-table'
import type { RawUrlBuilderArgs } from '../../shared/media-table'

// Post-login landing: the caller's own uploads, newest first, paginated (§8),
// plus a drag-drop / file-picker upload zone.
@Component({
  selector: 'app-uploads',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MediaTable],
  templateUrl: './uploads.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './uploads.scss',
})
export class Uploads implements OnInit {
  private readonly media = inject(MediaService)

  readonly items = signal<Media[]>([])
  readonly total = signal(0)
  readonly pageSize = signal(DEFAULT_PAGE_SIZE)
  readonly pageIndex = signal(0)
  readonly uploading = signal(false)
  readonly dragging = signal(false)

  // Bound raw-URL builder for the owner-scoped route.
  readonly rawUrl = (inArgs: RawUrlBuilderArgs): string =>
    this.media.rawUrl({ id: inArgs.media.id, download: inArgs.download })

  async ngOnInit (): Promise<void> {
    await this.load()
  }

  // Fetch the current page of own uploads.
  async load (): Promise<void> {
    const page = await this.media.listOwn({ limit: this.pageSize(), offset: this.pageIndex() * this.pageSize() })
    this.items.set(page.items)
    this.total.set(page.total)
  }

  async onPage (inEvent: PageEvent): Promise<void> {
    this.pageSize.set(inEvent.pageSize)
    this.pageIndex.set(inEvent.pageIndex)
    await this.load()
  }

  async onDrop (inEvent: DragEvent): Promise<void> {
    inEvent.preventDefault()
    this.dragging.set(false)
    const files = inEvent.dataTransfer?.files
    if (files !== undefined && files.length > 0) { await this.uploadFiles(files) }
  }

  async onPick (inEvent: Event): Promise<void> {
    const input = inEvent.target as HTMLInputElement
    const files = input.files
    if (files !== null && files.length > 0) { await this.uploadFiles(files) }
    input.value = ''
  }

  // Upload each selected file (reading image dimensions client-side), then reload.
  async uploadFiles (inFiles: FileList): Promise<void> {
    this.uploading.set(true)
    try {
      for (const file of Array.from(inFiles)) {
        const dims = await this.readDims(file)
        await this.media.upload({ file: file, dims: dims })
      }
      this.pageIndex.set(0)
      await this.load()
    } finally {
      this.uploading.set(false)
    }
  }

  async onDelete (inMedia: Media): Promise<void> {
    await this.media.remove(inMedia.id)
    await this.load()
  }

  // Read intrinsic width/height for images (best-effort; empty for other types).
  private readDims (inFile: File): Promise<{ width?: number; height?: number }> {
    // eslint-disable-next-line promise/param-names -- Promise executor arg is fixed by the API; org style would name it inResolve
    return new Promise(inResolve => {
      if (!inFile.type.startsWith('image/')) {
        inResolve({})
        return
      }
      const url = URL.createObjectURL(inFile)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        inResolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        inResolve({})
      }
      img.src = url
    })
  }
}
