import type { Routes } from '@angular/router'
import { authGuard } from './core/auth.guard'

// Owner routes are guarded; the public folder view and sign-in stay open.
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'uploads' },
  {
    path: 'sign-in',
    loadComponent: () => import('./features/sign-in/sign-in').then(m => m.SignIn),
  },
  {
    path: 'uploads',
    canActivate: [authGuard],
    loadComponent: () => import('./features/uploads/uploads').then(m => m.Uploads),
  },
  {
    path: 'folders',
    canActivate: [authGuard],
    loadComponent: () => import('./features/folders/folders').then(m => m.Folders),
  },
  {
    path: 'folders/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./features/folder-detail/folder-detail').then(m => m.FolderDetail),
  },
  {
    path: 'f/:slug',
    loadComponent: () => import('./features/public-folder/public-folder').then(m => m.PublicFolder),
  },
  { path: '**', redirectTo: 'uploads' },
]
