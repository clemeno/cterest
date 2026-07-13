import type { OnInit } from '@angular/core'
import { Component, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { form, required, email, FormField } from '@angular/forms/signals'
import { Router } from '@angular/router'
import { MatCardModule } from '@angular/material/card'
import { MatButtonModule } from '@angular/material/button'
import { MatFormFieldModule } from '@angular/material/form-field'
import { MatInputModule } from '@angular/material/input'
import { AuthService } from '../../core/auth.service'

// Sign-in page. In the mock this is a whitelisted email + a shared mock password;
// the real app swaps in the Google Identity Services button.
@Component({
  selector: 'app-sign-in',
  imports: [
    FormField,
    MatCardModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './sign-in.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './sign-in.scss',
})
export class SignIn implements OnInit {
  private readonly auth = inject(AuthService)
  private readonly router = inject(Router)

  readonly error = signal<string | null>(null)

  // Signal Form: the whitelisted email (prefilled for the POC) + the mock password.
  private readonly model = signal({ email: 'clemeno@gmail.com', password: '' })
  readonly signInForm = form(this.model, inPath => {
    required(inPath.email, { message: 'Email is required' })
    email(inPath.email)
    required(inPath.password, { message: 'Password is required' })
  })

  async ngOnInit (): Promise<void> {
    // Already signed in? Skip straight to the app.
    if (this.auth.user() !== null) {
      await this.router.navigate(['/uploads'])
    }
  }

  // Submit the email + password (the button is disabled until the form is valid).
  async submit (): Promise<void> {
    this.error.set(null)
    try {
      await this.auth.signIn({
        email: this.signInForm.email().value(),
        password: this.signInForm.password().value(),
      })
      await this.router.navigate(['/uploads'])
    } catch {
      this.error.set('Sign-in failed. Check your email and password.')
    }
  }
}
