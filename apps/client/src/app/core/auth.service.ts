// Session state for the client. Wraps the auth endpoints behind one interface so
// the real Better Auth flow can replace the mock sign-in without touching UI.

import { Injectable, inject, signal } from '@angular/core'
import { HttpClient } from '@angular/common/http'
import { firstValueFrom } from 'rxjs'
import type { User } from '../models'

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient)

  readonly user = signal<User | null>(null)
  readonly ready = signal(false) // true once the initial session probe finished

  // Probe the current session (called at startup and by the auth guard).
  async refresh (): Promise<User | null> {
    let user: User | null = null
    try {
      const res = await firstValueFrom(this.http.get<{ user: User | null }>('/api/auth/session'))
      user = res.user
    } catch {
      user = null
    } finally {
      this.ready.set(true)
    }
    this.user.set(user)
    return user
  }

  // Sign in with a whitelisted email + password; throws on rejection (generic failure).
  async signIn (inArgs: { email: string; password: string }): Promise<User> {
    const res = await firstValueFrom(
      this.http.post<{ user: User }>('/api/auth/mock-sign-in', inArgs)
    )
    this.user.set(res.user)
    return res.user
  }

  async signOut (): Promise<void> {
    await firstValueFrom(this.http.post('/api/auth/sign-out', {}))
    this.user.set(null)
  }
}
