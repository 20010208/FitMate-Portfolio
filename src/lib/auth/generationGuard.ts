/**
 * Tracks a monotonically increasing "generation" so that an async auth
 * result which is superseded by a newer request/event (a fresh getUser(),
 * a login, a logout) never gets applied to state. Each caller records the
 * generation it started with via next(), then checks isCurrent() once its
 * async work resolves; if a newer generation has since started, the result
 * is stale and must be discarded.
 */
export function createGenerationGuard() {
  let generation = 0
  return {
    next(): number {
      generation += 1
      return generation
    },
    isCurrent(g: number): boolean {
      return g === generation
    },
  }
}
