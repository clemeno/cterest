import type { ApplicationConfig } from '@angular/core'
import {
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideHttpClient, withFetch } from '@angular/common/http'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'

import { routes } from './app.routes'
import { AuthService } from './core/auth.service'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
    // Probe the session once at startup so the toolbar reflects auth immediately.
    provideAppInitializer(() => inject(AuthService).refresh()),
  ],
}
