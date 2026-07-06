import type { OnInit } from '@angular/core'
import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { RouterLink } from '@angular/router'
import { MatCardModule } from '@angular/material/card'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatSelectModule } from '@angular/material/select'
import { MatSnackBar } from '@angular/material/snack-bar'
import { FolderService } from '../../core/folder.service'
import type { Folder, Visibility } from '../../models'

const kVisibilityOptions: Visibility[] = ['private', 'protected', 'public']

// One-object argument for the visibility change (max-params: single param).
interface VisibilityChange {
  folder: Folder
  visibility: Visibility
}

// Manage the caller's folders: create, rename, change visibility, share (slug
// link), delete. Referencing media into folders happens on the detail page.
@Component({
  selector: 'app-folders',
  imports: [
    FormsModule,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './folders.html',
  styleUrl: './folders.scss',
})
export class Folders implements OnInit {
  private readonly folders = inject(FolderService)
  private readonly snack = inject(MatSnackBar)

  readonly list = signal<Folder[]>([])
  readonly newName = signal('')
  readonly newVisibility = signal<Visibility>('private')
  readonly editingId = signal<string | null>(null)
  readonly draftName = signal('')

  readonly visibilityOptions = kVisibilityOptions

  async ngOnInit (): Promise<void> {
    await this.load()
  }

  async load (): Promise<void> {
    this.list.set(await this.folders.listOwn())
  }

  async create (): Promise<void> {
    const vName = this.newName().trim()
    if (vName === '') { return }
    await this.folders.create({ name: vName, visibility: this.newVisibility() })
    this.newName.set('')
    this.newVisibility.set('private')
    await this.load()
  }

  startEdit (inFolder: Folder): void {
    this.editingId.set(inFolder.id)
    this.draftName.set(inFolder.name)
  }

  async saveName (inFolder: Folder): Promise<void> {
    const vName = this.draftName().trim()
    if (vName !== '' && vName !== inFolder.name) { await this.folders.update({ id: inFolder.id, patch: { name: vName } }) }
    this.editingId.set(null)
    await this.load()
  }

  async changeVisibility (inChange: VisibilityChange): Promise<void> {
    await this.folders.update({ id: inChange.folder.id, patch: { visibility: inChange.visibility } })
    await this.load()
  }

  async remove (inFolder: Folder): Promise<void> {
    await this.folders.remove(inFolder.id)
    await this.load()
  }

  // Copy the shareable slug link (private folders are not shareable).
  async copyLink (inFolder: Folder): Promise<void> {
    const vUrl = `${location.origin}/f/${inFolder.slug}`
    await navigator.clipboard.writeText(vUrl)
    this.snack.open('Share link copied', 'OK', { duration: 2500 })
  }
}
