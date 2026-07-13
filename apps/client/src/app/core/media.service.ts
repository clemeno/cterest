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
    const params = { limit: String(inQuery.limit), offset: String(inQuery.offset) }
    return firstValueFrom(this.http.get<Paginated<Media>>('/api/media', { params: params }))
  }

  // Stream one file as the raw request body; metadata rides the query (§6).
  upload (inUpload: MediaUpload): Promise<Media> {
    const file = inUpload.file
    const params: Record<string, string> = {
      filename: file.name,
      type: file.type === '' ? 'application/octet-stream' : file.type,
    }
    if (inUpload.dims.width !== undefined) { params['width'] = String(inUpload.dims.width) }
    if (inUpload.dims.height !== undefined) { params['height'] = String(inUpload.dims.height) }
    if (inUpload.folderId !== undefined) { params['folderId'] = inUpload.folderId }
    return firstValueFrom(this.http.post<Media>('/api/media', file, { params: params }))
  }

  remove (inId: string): Promise<unknown> {
    return firstValueFrom(this.http.delete(`/api/media/${inId}`))
  }

  // Cookie-authed anchor/img URLs — the browser sends the session automatically.
  rawUrl (inRaw: RawUrlArgs): string {
    return `/api/media/${inRaw.id}/raw${inRaw.download ? '?download' : ''}`
  }

  // Fetch a media's raw bytes as text for the in-app editor. The URL is the caller's
  // context-correct /raw endpoint (owner or folder-scoped), so this works in any view.
  readRaw (inUrl: string): Promise<string> {
    return firstValueFrom(this.http.get(inUrl, { responseType: 'text' }))
  }

  // Persist edited text back to an owned media (mock: overwrites the on-disk fixture).
  saveText (inArgs: { id: string; content: string }): Promise<{ ok: boolean; size: number }> {
    return firstValueFrom(this.http.put<{ ok: boolean; size: number }>(
      `/api/media/${inArgs.id}/raw`,
      inArgs.content,
      { headers: { 'Content-Type': 'text/plain' } }
    ))
  }
}
