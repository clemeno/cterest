import { ChangeDetectionStrategy, Component, input } from '@angular/core'
import { MatDialogModule } from '@angular/material/dialog'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { DragDropModule } from '@angular/cdk/drag-drop'

// Shared, consistent dialog title bar. Layout: an optional leading icon plus any
// [leading]-projected actions on the left, the title absolutely centered on the bar,
// then default-projected actions and a trailing close button on the right. It IS the
// drag handle (cdkDragHandle), so any dialog that wraps its body in a cdkDrag and drops
// this in becomes draggable by its bar.
@Component({
  selector: 'app-dialog-titlebar',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, DragDropModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="titlebar" cdkDragHandle>
      <div class="side">
        @if (icon() !== '') {
          <mat-icon>{{ icon() }}</mat-icon>
        }
        <ng-content select="[leading]"></ng-content>
      </div>
      <span class="title">{{ title() }}</span>
      <div class="side right">
        <ng-content></ng-content>
        <button mat-icon-button mat-dialog-close aria-label="Close">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    </div>
  `,
  styles: `
    .titlebar { position: relative; display: flex; align-items: center; gap: 8px; padding: 4px 4px 8px; cursor: move; user-select: none; }
    .titlebar button { cursor: pointer; }
    .side { display: flex; align-items: center; gap: 8px; z-index: 1; }
    .right { margin-left: auto; }
    .title { position: absolute; left: 50%; transform: translateX(-50%); max-width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: center; pointer-events: none; font: 500 14px/1.4 sans-serif; opacity: 0.9; }
  `,
})
export class DialogTitlebar {
  readonly title = input('')
  readonly icon = input('')
}
