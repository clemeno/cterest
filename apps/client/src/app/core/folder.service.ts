// Folder CRUD, playlist-style link/unlink, and the slug-addressed public reads (§7).

import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { firstValueFrom } from 'rxjs'
import type { Folder, Media, Paginated, PublicFolder, Visibility } from '../models'

// Single-object argument shapes (max-params: methods take one options object).
export interface CreateFolder {
  name: string
  visibility: Visibility
}

export interface UpdateFolder {
  id: string
  patch: { name?: string; visibility?: Visibility }
}

export interface FolderMediaRef {
  id: string
  mediaId: string
}

export interface SlugPageQuery {
  slug: string
  limit: number
  offset: number
}

export interface PublicRawUrlArgs {
  slug: string
  mediaId: string
  download?: boolean
}

@Injectable({ providedIn: 'root' })
export class FolderService {
  private readonly http = inject(HttpClient)

  // ---- owner routes ----
  listOwn (): Promise<Folder[]> {
    return firstValueFrom(this.http.get<Folder[]>('/api/folders'))
  }

  create (inCreate: CreateFolder): Promise<Folder> {
    return firstValueFrom(this.http.post<Folder>('/api/folders', { name: inCreate.name, visibility: inCreate.visibility }))
  }

  update (inUpdate: UpdateFolder): Promise<Folder> {
    return firstValueFrom(this.http.patch<Folder>(`/api/folders/${inUpdate.id}`, inUpdate.patch))
  }

  remove (inId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/folders/${inId}`))
  }

  // Reference / dereference a media (a link, never a byte copy, §5).
  link (inLink: FolderMediaRef): Promise<unknown> {
    return firstValueFrom(this.http.post(`/api/folders/${inLink.id}/media`, { mediaId: inLink.mediaId }))
  }

  unlink (inUnlink: FolderMediaRef): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/folders/${inUnlink.id}/media/${inUnlink.mediaId}`))
  }

  // ---- folder-scoped reads (by slug; the gate decides, §7) ----
  getBySlug (inSlug: string): Promise<PublicFolder> {
    return firstValueFrom(this.http.get<PublicFolder>(`/api/f/${inSlug}`))
  }

  listBySlug (inQuery: SlugPageQuery): Promise<Paginated<Media>> {
    const params = { limit: String(inQuery.limit), offset: String(inQuery.offset) }
    return firstValueFrom(this.http.get<Paginated<Media>>(`/api/f/${inQuery.slug}/media`, { params: params }))
  }

  publicRawUrl (inRaw: PublicRawUrlArgs): string {
    return `/api/f/${inRaw.slug}/media/${inRaw.mediaId}/raw${inRaw.download === true ? '?download' : ''}`
  }
}
