import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js'

export type AuthErrorContext = 'signup' | 'login'

export type AuthErrorMessageKey =
  | 'authErrorWeakPassword'
  | 'authErrorInvalidCredentials'
  | 'authErrorEmailNotConfirmed'
  | 'authErrorUserExists'
  | 'authErrorRateLimit'
  | 'authErrorSignupDisabled'
  | 'authErrorNetwork'
  | 'authErrorSignupGeneric'
  | 'authErrorLoginGeneric'

// Codes confirmed against the installed SDK (@supabase/auth-js 2.101.1,
// node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts). Codes not
// present there are intentionally left unmapped and fall through to the
// context-specific generic message instead of being guessed.
const AUTH_ERROR_CODE_TO_KEY = {
  weak_password: 'authErrorWeakPassword',
  invalid_credentials: 'authErrorInvalidCredentials',
  email_not_confirmed: 'authErrorEmailNotConfirmed',
  user_already_exists: 'authErrorUserExists',
  over_request_rate_limit: 'authErrorRateLimit',
  over_email_send_rate_limit: 'authErrorRateLimit',
  signup_disabled: 'authErrorSignupDisabled',
} as const satisfies Readonly<Record<string, AuthErrorMessageKey>>

const CONTEXT_FALLBACK_KEY: Readonly<Record<AuthErrorContext, AuthErrorMessageKey>> = {
  signup: 'authErrorSignupGeneric',
  login: 'authErrorLoginGeneric',
}

// error.code is attacker/server-influenced input, so it must be checked as an
// own property before indexing — a plain object literal otherwise leaks
// Object.prototype members (constructor/toString/__proto__) as if they were
// mapped values.
function isKnownAuthErrorCode(code: string): code is keyof typeof AUTH_ERROR_CODE_TO_KEY {
  return Object.prototype.hasOwnProperty.call(AUTH_ERROR_CODE_TO_KEY, code)
}

/**
 * Maps a Supabase Auth error (or any unknown thrown value) to a safe
 * translation key for display. Never returns the raw SDK message, a stack
 * trace, or any part of the input error object.
 */
export function getAuthErrorMessageKey(error: unknown, context: AuthErrorContext): AuthErrorMessageKey {
  // isAuthRetryableFetchError/isAuthError are exported type guards from
  // @supabase/auth-js (re-exported via @supabase/supabase-js), not string
  // matching on error.message, so this stays safe across SDK message wording changes.
  if (isAuthRetryableFetchError(error)) {
    return 'authErrorNetwork'
  }
  if (isAuthError(error) && typeof error.code === 'string' && isKnownAuthErrorCode(error.code)) {
    return AUTH_ERROR_CODE_TO_KEY[error.code]
  }
  return CONTEXT_FALLBACK_KEY[context]
}
