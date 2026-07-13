// Guards the owner-only routes: resolves the session (once) and bounces anonymous
// visitors to the sign-in page. The server re-checks every request regardless (§7).

import { inject } from '@angular/core'
import type { CanActivateFn } from '@angular/router'
import { Router } from '@angular/router'
import { AuthService } from './auth.service'

export const authGuard: CanActivateFn = async () => {
  const auth = inject(AuthService)
  const router = inject(Router)

  const user = auth.user() ?? (await auth.refresh())
  return user !== null ? true : router.createUrlTree(['/sign-in'])
}
