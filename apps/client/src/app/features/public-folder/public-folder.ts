import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { ActivatedRoute, RouterLink } from '@angular/router'
import type { PageEvent } from '@angular/material/paginator'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatChipsModule } from '@angular/material/chips'
import { FolderService } from '../../core/folder.service'
import type { Media, PublicFolder as PublicFolderMeta } from '../../models'
import { kDefaultPageSize } from '../../models'
import { MediaTable } from '../../shared/media-table'
import type { RawUrlBuilderArgs } from '../../shared/media-table'

// Read-only folder view addressed by slug (§8). Unguarded route: anonymous for
// public folders, member-gated for protected. On any gate failure the server
// returns 404 (no existence oracle) so the UI shows a generic sign-in prompt.
@Component({
  selector: 'app-public-folder',
  imports: [RouterLink, MatButtonModule, MatIconModule, MatChipsModule, MediaTable],
  templateUrl: './public-folder.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './public-folder.scss',
})
export class PublicFolder implements OnInit {
  private readonly route = inject(ActivatedRoute)
  private readonly folders = inject(FolderService)

  private readonly slug = this.route.snapshot.paramMap.get('slug')!

  readonly meta = signal<PublicFolderMeta | null>(null)
  readonly denied = signal(false)
  readonly items = signal<Media[]>([])
  readonly total = signal(0)
  readonly pageSize = signal(kDefaultPageSize)
  readonly pageIndex = signal(0)

  readonly rawUrl = (inArgs: RawUrlBuilderArgs): string =>
    this.folders.publicRawUrl({ slug: this.slug, mediaId: inArgs.media.id, download: inArgs.download })

  async ngOnInit (): Promise<void> {
    try {
      this.meta.set(await this.folders.getBySlug(this.slug))
      await this.load()
    } catch {
      this.denied.set(true)
    }
  }

  async load (): Promise<void> {
    const vPage = await this.folders.listBySlug({ slug: this.slug, limit: this.pageSize(), offset: this.pageIndex() * this.pageSize() })
    this.items.set(vPage.items)
    this.total.set(vPage.total)
  }

  async onPage (inEvent: PageEvent): Promise<void> {
    this.pageSize.set(inEvent.pageSize)
    this.pageIndex.set(inEvent.pageIndex)
    await this.load()
  }
}
