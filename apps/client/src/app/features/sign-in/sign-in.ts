import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { form, required, email, FormField } from '@angular/forms/signals'
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
    FormField,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
  ],
  templateUrl: './sign-in.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sign-in.scss',
})
export class SignIn implements OnInit {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly demoUsers = signal<User[]>([])
  readonly error = signal<string | null>(null)

  // Signal Form: a single isolated email field, required + standard email format.
  private readonly model = signal({ email: '' })
  readonly signInForm = form(this.model, inPath => {
    required(inPath.email, { message: 'Email is required' })
    email(inPath.email)
  })

  async ngOnInit (): Promise<void> {
    // Already signed in? Skip straight to the app; else load the demo accounts.
    let vNext: User[] = []
    if (this.auth.user() !== null) {
      await this.router.navigate(['/uploads'])
    } else {
      try {
        vNext = await this.auth.demoUsers()
      } catch {
        vNext = []
      }
      this.demoUsers.set(vNext)
    }
  }

  // Sign in with an explicit whitelisted email (the demo-account buttons).
  async signInWith (inEmail: string): Promise<void> {
    this.error.set(null)
    try {
      await this.auth.signIn(inEmail)
      await this.router.navigate(['/uploads'])
    } catch {
      this.error.set('Sign-in failed. This email is not whitelisted.')
    }
  }

  // Submit the manual email form (the button is disabled until the field is valid).
  async submit (): Promise<void> {
    await this.signInWith(this.signInForm.email().value())
  }
}
