import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { form, required, FormField } from '@angular/forms/signals'
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
    FormField,
    RouterLink,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  templateUrl: './folders.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './folders.scss',
})
export class Folders implements OnInit {
  private readonly folders = inject(FolderService)
  private readonly snack = inject(MatSnackBar)

  readonly visibilityOptions = kVisibilityOptions
  readonly editingId = signal<string | null>(null)

  // Signal Form (common create area): new folder name + visibility, name required.
  private readonly createModel = signal<{ name: string; visibility: Visibility }>({ name: '', visibility: 'private' })
  readonly createForm = form(this.createModel, inPath => {
    required(inPath.name, { message: 'Name is required' })
  })

  // Signal Form (isolated single field): inline rename of the row being edited.
  private readonly renameModel = signal<{ name: string }>({ name: '' })
  readonly renameForm = form(this.renameModel, inPath => {
    required(inPath.name)
  })

  // Signal Form (array — one standalone field per table row): the folders list.
  // Each row's visibility select binds to listForm[i].visibility.
  private readonly listModel = signal<Folder[]>([])
  readonly listForm = form(this.listModel)

  async ngOnInit (): Promise<void> {
    await this.load()
  }

  async load (): Promise<void> {
    this.listModel.set(await this.folders.listOwn())
  }

  get list (): Folder[] {
    return this.listModel()
  }

  async create (): Promise<void> {
    const vDraft = this.createModel()
    const vName = vDraft.name.trim()
    if (vName !== '') {
      await this.folders.create({ name: vName, visibility: vDraft.visibility })
      this.createModel.set({ name: '', visibility: 'private' })
      await this.load()
    }
  }

  startEdit (inFolder: Folder): void {
    this.renameModel.set({ name: inFolder.name })
    this.editingId.set(inFolder.id)
  }

  async saveName (inFolder: Folder): Promise<void> {
    const vName = this.renameForm.name().value().trim()
    if (vName !== '' && vName !== inFolder.name) {
      await this.folders.update({ id: inFolder.id, patch: { name: vName } })
    }
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
