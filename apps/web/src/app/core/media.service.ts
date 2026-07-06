// Owner-scoped media operations: list own uploads, upload, delete, raw URLs (§7).

import { Injectable, inject } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { firstValueFrom } from 'rxjs'
import type { Media, Paginated } from '../models'

// Single-object argument shapes (max-params: methods take one options object).
export interface MediaPageQuery {
  limit: number
  offset: number
}

export interface MediaUpload {
  file: File
  dims: { width?: number; height?: number }
  folderId?: string
}

export interface RawUrlArgs {
  id: string
  download: boolean
}

@Injectable({ providedIn: 'root' })
export class MediaService {
  private readonly http = inject(HttpClient)

  // The main view: the caller's own uploads, newest first, paginated (§8).
  listOwn (inQuery: MediaPageQuery): Promise<Paginated<Media>> {
    const vParams = { limit: String(inQuery.limit), offset: String(inQuery.offset) }
    return firstValueFrom(this.http.get<Paginated<Media>>('/api/media', { params: vParams }))
  }

  // Stream one file as the raw request body; metadata rides the query (§6).
  upload (inUpload: MediaUpload): Promise<Media> {
    const vFile = inUpload.file
    const vParams: Record<string, string> = {
      filename: vFile.name,
      type: vFile.type === '' ? 'application/octet-stream' : vFile.type,
    }
    if (inUpload.dims.width !== undefined) { vParams['width'] = String(inUpload.dims.width) }
    if (inUpload.dims.height !== undefined) { vParams['height'] = String(inUpload.dims.height) }
    if (inUpload.folderId !== undefined) { vParams['folderId'] = inUpload.folderId }
    return firstValueFrom(this.http.post<Media>('/api/media', vFile, { params: vParams }))
  }

  remove (inId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/media/${inId}`))
  }

  // Cookie-authed anchor/img URLs — the browser sends the session automatically.
  rawUrl (inRaw: RawUrlArgs): string {
    return `/api/media/${inRaw.id}/raw${inRaw.download ? '?download' : ''}`
  }
}
