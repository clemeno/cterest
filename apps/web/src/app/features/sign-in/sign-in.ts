import type { OnInit } from '@angular/core'
import { Component, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { Router } from '@angular/router'
import { MatCardModule } from '@angular/material/card'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { MatIconModule } from '@angular/material/icon'
import { AuthService } from '../../core/auth.service'
import type { User } from '../../models'

// Sign-in page. In the mock this offers one-click whitelisted demo accounts (and a
// manual email field); the real app swaps in the Google Identity Services button.
@Component({
  selector: 'app-sign-in',
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './sign-in.html',
  styleUrl: './sign-in.scss',
})
export class SignIn implements OnInit {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly demoUsers = signal<User[]>([])
  readonly email = signal('')
  readonly error = signal<string | null>(null)

  async ngOnInit (): Promise<void> {
    // Already signed in? Skip straight to the app.
    if (this.auth.user() !== null) {
      await this.router.navigate(['/uploads'])
      return
    }
    try {
      this.demoUsers.set(await this.auth.demoUsers())
    } catch {
      this.demoUsers.set([])
    }
  }

  async signIn (inEmail: string): Promise<void> {
    this.error.set(null)
    try {
      await this.auth.signIn(inEmail)
      await this.router.navigate(['/uploads'])
    } catch {
      this.error.set('Sign-in failed. This email is not whitelisted.')
    }
  }
}
