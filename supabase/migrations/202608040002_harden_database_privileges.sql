-- Privilege hardening for the existing Production project. Every statement
-- below removes a privilege that Production's own RLS policies already make
-- unreachable in practice (blogs writes, direct calls into a trigger-only
-- function) or closes a structural gap that could silently expose a future
-- SECURITY DEFINER function (default EXECUTE privileges). None of these
-- changes are expected to alter any currently-working application or cron
-- behavior — see the per-section notes below and
-- docs/database/SCHEMA_MIGRATION_RUNBOOK.md for the reasoning and the
-- required Preview-environment verification before this is applied to
-- Production.

begin;

-- ============================================================================
-- 1. blogs: remove the write privileges anon/authenticated do not need.
--    RLS already has no INSERT/UPDATE/DELETE policy for `blogs` (confirmed
--    Production metadata: "write policyなし"), so PostgREST/API calls from
--    those two roles are already rejected at the RLS layer today. This
--    statement removes the *redundant* table-level grant that currently
--    sits behind that RLS wall, so that a future policy mistake cannot
--    combine with this table grant to reopen write access. service_role is
--    never named below and keeps every privilege it already has (the
--    scripts/generate-article.mjs cron write path is unaffected).
-- ============================================================================

revoke insert, update, delete, truncate on table public.blogs from anon, authenticated;
grant select on table public.blogs to anon, authenticated;

-- ============================================================================
-- 2. set_food_item_reading(): trigger-only function. No client code calls it
--    directly (only food_items_reading_trigger invokes it), and trigger
--    invocation does not require the firing role to hold a direct EXECUTE
--    grant on the trigger function — this is the exact same reasoning this
--    repo already applied to handle_new_user() in 202607240002. Revoking
--    direct-call EXECUTE here does not affect the trigger.
--
--    get_brand_categories(text) keeps its public EXECUTE grant unchanged
--    (called directly via supabase.rpc() from FoodSearchClient.tsx against
--    public, non-user-owned food master data — this is not touched by this
--    migration).
--
--    kata_to_hira(text) is NOT touched by this migration. Production
--    currently leaves it callable by anon/authenticated. It is only ever
--    invoked internally (from within set_food_item_reading()'s body), never
--    called directly from application code, so it is in principle a
--    candidate for the same EXECUTE revocation — but unlike
--    set_food_item_reading(), it is called as an ordinary nested SQL
--    function call from inside another SECURITY INVOKER function's body,
--    not fired by the trigger mechanism itself. Whether that nested-call
--    privilege check resolves against the original DML-issuing role in a
--    way that would break if EXECUTE were revoked cannot be verified
--    without a live Postgres instance (no runtime environment is available
--    this session — see docs/database/SCHEMA_MIGRATION_RUNBOOK.md). Rather
--    than guess, this migration leaves kata_to_hira's grants exactly as
--    Production has them today; revoking it is deferred to a follow-up
--    change gated on Preview-environment verification.
--
--    reserve_ai_usage(text,uuid) / release_ai_usage(text,uuid) /
--    handle_new_user() already have their intended grants from
--    202607230001 / 202607240002 and are only asserted (never re-issued)
--    below, to confirm this migration has not drifted from that intent.
-- ============================================================================

revoke execute on function public.set_food_item_reading() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.get_brand_categories(text)', 'execute') is not true
    or has_function_privilege('authenticated', 'public.get_brand_categories(text)', 'execute') is not true
  then
    raise exception 'convergence: public.get_brand_categories(text) is expected to remain callable by anon and authenticated; this migration does not change it';
  end if;

  if has_function_privilege('authenticated', 'public.reserve_ai_usage(text,uuid)', 'execute') is not true then
    raise exception 'convergence: public.reserve_ai_usage(text,uuid) is expected to remain callable by authenticated (granted by 202607230001)';
  end if;
  if has_function_privilege('anon', 'public.reserve_ai_usage(text,uuid)', 'execute') is true then
    raise exception 'convergence: public.reserve_ai_usage(text,uuid) is unexpectedly callable by anon';
  end if;

  if has_function_privilege('authenticated', 'public.release_ai_usage(text,uuid)', 'execute') is not true then
    raise exception 'convergence: public.release_ai_usage(text,uuid) is expected to remain callable by authenticated (granted by 202607230001)';
  end if;
  if has_function_privilege('anon', 'public.release_ai_usage(text,uuid)', 'execute') is true then
    raise exception 'convergence: public.release_ai_usage(text,uuid) is unexpectedly callable by anon';
  end if;

  if has_function_privilege('anon', 'public.handle_new_user()', 'execute') is true
    or has_function_privilege('authenticated', 'public.handle_new_user()', 'execute') is true
  then
    raise exception 'convergence: public.handle_new_user() is expected to have no direct anon/authenticated EXECUTE (revoked by 202607240002)';
  end if;
end $$;

-- ============================================================================
-- 3. Future default privileges: close the structural gap where any *new*
--    function created in the public schema by role `postgres` (the role
--    that applies this repo's migrations) is, by Supabase's platform
--    default, immediately EXECUTE-able by anon and authenticated —
--    regardless of whether the function is SECURITY DEFINER or was ever
--    meant to be called directly. This is exactly the mistake class the
--    202607240002 migration had to retroactively fix for handle_new_user().
--    Changing the default for *functions* going forward prevents a repeat.
--
--    Scope decision (A vs B from the task): this migration revokes default
--    EXECUTE on FUNCTIONS only. It deliberately does NOT change default
--    privileges for TABLES or SEQUENCES. Reasoning, grounded in this
--    repo's actual code (not a generic best-practice default):
--      - Every browser-facing table in this schema (profiles, trainings,
--        weight_records, meal_logs, step_logs, food_items, blogs) is read
--        and written directly via `supabase.from(...)` using the publishable
--        (anon-equivalent) key from `src/lib/supabase/client.ts` — the
--        application's security model for tables is "broad table grant +
--        RLS is the actual boundary", by design, for every single table
--        that exists today. There is no precedent anywhere in
--        `supabase/migrations/` of an explicit per-table GRANT being issued
--        for a new table; every table created so far (including step_logs
--        and blogs, per the Production metadata this migration converges
--        against) relies on Supabase's default table privileges.
--      - Revoking default TABLE/SEQUENCE privileges would require every
--        future migration that adds a table to also remember an explicit
--        GRANT, or the new table would be unreachable from the app by
--        default — a foot-gun in the opposite direction from the one this
--        section is trying to close, and a deviation from Supabase's
--        documented, supported operating model (RLS-first, not
--        grant-first, for tables).
--      - The function-EXECUTE default, by contrast, has no such
--        counter-pressure: this repo has exactly one legitimate
--        directly-called RPC today (get_brand_categories, explicitly
--        re-granted above) and the rest are either trigger-only or
--        SECURITY DEFINER functions that must be deliberately opened up
--        (reserve_ai_usage / release_ai_usage), which this repo's existing
--        convention already does with an explicit `grant execute ... to
--        authenticated` right next to the CREATE FUNCTION. Defaulting
--        functions closed does not conflict with that convention — it just
--        makes the "forgot the REVOKE" failure mode impossible by default.
--
--    Object creator is pinned to role `postgres` explicitly, since that is
--    the role Supabase's migration pipeline runs as; a default privilege
--    change only affects objects subsequently created *by the same role*
--    that issued the ALTER DEFAULT PRIVILEGES statement.
--
--    Codex follow-up fix (High #1, corrected 2026-08-04 round 4 — the
--    PostgreSQL model is additive, not override/precedence): the **global**
--    REVOKE (no `IN SCHEMA` clause) is the *central* hardening action here.
--    PostgreSQL's built-in default — when no `ALTER DEFAULT PRIVILEGES`
--    customization exists at all for a given role — is to grant EXECUTE on
--    new functions to PUBLIC; this is a global-level behavior, and
--    Production's `pg_default_acl` was confirmed (Codex audit) to carry a
--    global default ACL entry granting PUBLIC EXECUTE for role `postgres`.
--    The global REVOKE removes that entry; this is the statement that
--    actually closes the "new SECURITY DEFINER function is accidentally
--    public" mistake class described above. Because PUBLIC applies to every
--    role, revoking it from PUBLIC (not just from anon/authenticated
--    individually) is what makes this closure complete.
--
--    Per PostgreSQL's documented behavior for `ALTER DEFAULT PRIVILEGES`,
--    schema-specific default privileges are **added to** whatever the
--    global default privileges are for that object type — they do not
--    replace, override, or take precedence over the global setting, and a
--    schema-specific REVOKE cannot cancel, negate, or "deny" a privilege
--    that a global GRANT (built-in or explicit) separately confers; REVOKE
--    only removes ACL entries that were themselves granted, it does not add
--    a blocking/deny entry. Consequently, the **schema-specific** REVOKE
--    (`IN SCHEMA public`) below is only meaningful because Production's
--    `pg_default_acl` was separately confirmed (Codex audit) to also carry
--    an *existing, explicit* schema-specific default ACL entry (for schema
--    `public`) granting PUBLIC EXECUTE — this statement exists solely to
--    converge and remove that specific, already-present entry. It is not a
--    second, symmetric line of defense against some hypothetical future
--    global GRANT. Each REVOKE below targets a distinct,
--    independently-confirmed existing `pg_default_acl` entry — the global
--    REVOKE and the schema-specific REVOKE are two separate corrective
--    actions for two separately-confirmed facts, not a matched pair issued
--    for mutual protection.
--
--    This does not change any *existing* function's grants (ALTER DEFAULT
--    PRIVILEGES never affects already-created objects) and does not touch
--    service_role (never named in either statement — service_role is not
--    affected by default privileges the way anon/authenticated are, and
--    keeps whatever access it already has). Once this migration is applied,
--    any *future* migration that adds a new function meant to be called
--    directly by anon/authenticated (the way `get_brand_categories` is
--    today) MUST include its own explicit
--    `grant execute on function ... to anon, authenticated;` right next to
--    its `CREATE FUNCTION` — after this migration, that grant is no longer
--    implicit for new functions created by role `postgres` in schema
--    `public`, by either the global or the schema-specific default.
-- ============================================================================

alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

commit;
