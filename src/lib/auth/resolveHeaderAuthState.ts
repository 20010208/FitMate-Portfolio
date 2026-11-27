export type HeaderAuthState = {
  isGuest: boolean
  nickname: string | null
}

/** Safe to server-render for anyone: no session, no personal data. */
export const GUEST_HEADER_STATE: HeaderAuthState = { isGuest: true, nickname: null }

/**
 * Pure mapping from a resolved Supabase user (+ optional profile nickname)
 * to the header's display state. Used only client-side (see AppHeader.tsx)
 * so the public blog route tree never needs a server-side auth check.
 */
export function resolveHeaderAuthState(
  user: { id: string } | null | undefined,
  nickname: string | null | undefined
): HeaderAuthState {
  if (!user) return GUEST_HEADER_STATE
  return { isGuest: false, nickname: nickname ?? null }
}

/**
 * Decides what to show *immediately* when a new auth event/user arrives,
 * before any profile fetch has completed. A switch to a different user (or
 * to guest) takes effect right away, with nickname cleared to null, so the
 * previous user's name never lingers on screen while the new user's profile
 * is still loading. An event for the *same* user (e.g. TOKEN_REFRESHED)
 * returns null — meaning "no immediate change" — so an already-correct
 * nickname is never cleared or re-rendered.
 *
 * `displayedUserId` is the user id the caller's current state reflects (or
 * null for guest); the caller is responsible for tracking it and updating it
 * to the returned `displayedUserId` when acting on a non-null result.
 */
export function nextDisplayedUserState(
  displayedUserId: string | null,
  user: { id: string } | null | undefined
): { displayedUserId: string | null; immediateState: HeaderAuthState } | null {
  if (!user) {
    if (displayedUserId === null) return null
    return { displayedUserId: null, immediateState: GUEST_HEADER_STATE }
  }
  if (user.id === displayedUserId) return null
  return { displayedUserId: user.id, immediateState: resolveHeaderAuthState(user, null) }
}

/**
 * Combines "this is the very first auth result the caller has ever seen"
 * with the steady-state nextDisplayedUserState() logic above.
 *
 * Before the first getUser() result (success *or* failure) or the first
 * onAuthStateChange event (including the INITIAL_SESSION Supabase always
 * fires on subscribe) has been applied, the caller's displayed state must
 * always be updated to a real guest/authenticated value — regardless of
 * which one of those arrives first. nextDisplayedUserState()'s "no change"
 * shortcut assumes displayedUserId===null already means "guest is being
 * shown", which is not true while the caller is still rendering an
 * unresolved/neutral placeholder (displayedUserId===null there means
 * "nothing has been shown yet", not "guest has been shown"). Once
 * hasResolvedInitial is true, this delegates to nextDisplayedUserState()
 * exactly as before.
 */
export function resolveInitialOrNextUserState(
  hasResolvedInitial: boolean,
  displayedUserId: string | null,
  user: { id: string } | null | undefined
): { displayedUserId: string | null; immediateState: HeaderAuthState } | null {
  if (!hasResolvedInitial) {
    return { displayedUserId: user?.id ?? null, immediateState: resolveHeaderAuthState(user, null) }
  }
  return nextDisplayedUserState(displayedUserId, user)
}
