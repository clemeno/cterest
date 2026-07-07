import { Component, inject, ChangeDetectionStrategy } from '@angular/core'
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router'
import { MatToolbarModule } from '@angular/material/toolbar'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatMenuModule } from '@angular/material/menu'
import { AuthService } from './core/auth.service'

// Application shell: top toolbar with nav + account menu, and the routed outlet.
@Component({
  selector: 'app-root',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './app.scss',
})
export class App {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly user = this.auth.user

  // Sign out then return to the sign-in page.
  async signOut (): Promise<void> {
    await this.auth.signOut()
    await this.router.navigate(['/sign-in'])
  }
}
