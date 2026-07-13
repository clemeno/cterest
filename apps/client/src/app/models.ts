// Shared client-side types mirroring the mock API contract (PLAN §5/§7).

export type Visibility = 'private' | 'protected' | 'public'
export type Category = 'image' | 'video' | 'audio' | 'text' | 'document'

export interface User {
  email: string;
  name: string;
}

export interface Media {
  id: string;
  filename: string;
  mime: string;
  category: Category;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  previewable: boolean;
  size: number;
  uploaderEmail: string;
  uploadedAt: string;
}

export interface Folder {
  id: string;
  slug: string;
  ownerEmail: string;
  name: string;
  visibility: Visibility;
  createdAt: string;
  mediaCount: number;
}

// Read-only view of a folder reached by its slug (owner details withheld).
export interface PublicFolder {
  slug: string;
  name: string;
  visibility: Visibility;
  mediaCount: number;
  isOwner: boolean;
}

// Every list route returns this envelope so mat-paginator can bind directly.
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// Page sizes offered by mat-paginator; the API rejects anything else (§8).
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200]
export const DEFAULT_PAGE_SIZE = 10
