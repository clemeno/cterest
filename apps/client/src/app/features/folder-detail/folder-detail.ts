import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { PageEvent } from '@angular/material/paginator'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatChipsModule } from '@angular/material/chips'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MediaService } from '../../core/media.service'
import { FolderService } from '../../core/folder.service'
import type { Folder, Media } from '../../models'
import { kDefaultPageSize } from '../../models'
import { MediaTable } from '../../shared/media-table'
import type { RawUrlBuilderArgs } from '../../shared/media-table'

// Manage one folder's contents: the referenced media (remove links) plus a panel
// of the caller's own uploads to reference in (playlist-style, §5). The owner
// reads the folder's media by its slug (the owner passes any visibility gate).
@Component({
  selector: 'app-folder-detail',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatChipsModule, MediaTable],
  templateUrl: './folder-detail.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './folder-detail.scss',
})
export class FolderDetail implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly folders = inject(FolderService)
  private readonly media = inject(MediaService)
  private readonly snack = inject(MatSnackBar)

  private readonly id = this.route.snapshot.paramMap.get('id')!

  readonly folder = signal<Folder | null>(null)

  // media referenced in this folder
  readonly inItems = signal<Media[]>([])
  readonly inTotal = signal(0)
  readonly inSize = signal(kDefaultPageSize)
  readonly inIndex = signal(0)

  // the caller's own uploads (candidates to reference)
  readonly ownItems = signal<Media[]>([])
  readonly ownTotal = signal(0)
  readonly ownSize = signal(kDefaultPageSize)
  readonly ownIndex = signal(0)

  // Raw-URL builders: in-folder reads go via slug, own uploads via media id.
  readonly rawInFolder = (inArgs: RawUrlBuilderArgs): string =>
    this.folders.publicRawUrl({ slug: this.folder()!.slug, mediaId: inArgs.media.id, download: inArgs.download })

  readonly rawOwn = (inArgs: RawUrlBuilderArgs): string =>
    this.media.rawUrl({ id: inArgs.media.id, download: inArgs.download })

  async ngOnInit (): Promise<void> {
    const vFolder = (await this.folders.listOwn()).find(f => f.id === this.id) ?? null
    this.folder.set(vFolder)
    if (vFolder !== null) {
      await Promise.all([this.loadInFolder(), this.loadOwn()])
    }
  }

  async loadInFolder (): Promise<void> {
    const vPage = await this.folders.listBySlug({ slug: this.folder()!.slug, limit: this.inSize(), offset: this.inIndex() * this.inSize() })
    this.inItems.set(vPage.items)
    this.inTotal.set(vPage.total)
  }

  async loadOwn (): Promise<void> {
    const vPage = await this.media.listOwn({ limit: this.ownSize(), offset: this.ownIndex() * this.ownSize() })
    this.ownItems.set(vPage.items)
    this.ownTotal.set(vPage.total)
  }

  async onInPage (inEvent: PageEvent): Promise<void> {
    this.inSize.set(inEvent.pageSize)
    this.inIndex.set(inEvent.pageIndex)
    await this.loadInFolder()
  }

  async onOwnPage (inEvent: PageEvent): Promise<void> {
    this.ownSize.set(inEvent.pageSize)
    this.ownIndex.set(inEvent.pageIndex)
    await this.loadOwn()
  }

  async add (inMedia: Media): Promise<void> {
    await this.folders.link({ id: this.id, mediaId: inMedia.id })
    this.snack.open(`Added ${inMedia.filename}`, undefined, { duration: 1500 })
    await this.loadInFolder()
  }

  async removeFromFolder (inMedia: Media): Promise<void> {
    await this.folders.unlink({ id: this.id, mediaId: inMedia.id })
    await this.loadInFolder()
  }

  async copyLink (): Promise<void> {
    await navigator.clipboard.writeText(`${location.origin}/f/${this.folder()!.slug}`)
    this.snack.open('Share link copied', 'OK', { duration: 2500 })
  }
}
