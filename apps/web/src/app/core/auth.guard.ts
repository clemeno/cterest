// Guards the owner-only routes: resolves the session (once) and bounces anonymous
// visitors to the sign-in page. The server re-checks every request regardless (§7).

import { inject } from '@angular/core'
import type { CanActivateFn } from '@angular/router'
import { Router } from '@angular/router'
import { AuthService } from './auth.service'

export const authGuard: CanActivateFn = async () => {
  const vAuth = inject(AuthService)
  const vRouter = inject(Router)

  const vUser = vAuth.user() ?? (await vAuth.refresh())
  return vUser !== null ? true : vRouter.createUrlTree(['/sign-in'])
}
