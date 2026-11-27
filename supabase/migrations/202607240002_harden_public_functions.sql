-- Function Security hardening: fix "Function Search Path Mutable" for 4 functions
-- and remove unnecessary direct EXECUTE privilege on the SECURITY DEFINER
-- trigger function public.handle_new_user().
--
-- Source of truth: exact current production definitions, attributes, and ACLs
-- for all four functions were confirmed via a read-only SELECT against
-- pg_proc/pg_trigger/information_schema.role_routine_grants run by the user
-- in the Supabase Dashboard SQL Editor (not by this migration's author, and
-- not via any local dump). CREATE OR REPLACE FUNCTION is used throughout so
-- that existing ACLs, owner, and object dependencies (including the
-- on_auth_user_created and food_items_reading_trigger triggers, both left
-- untouched by this migration) are preserved automatically; only the body
-- (for schema-qualification) and the explicitly-listed attributes below are
-- changed. All four functions keep their exact signature, return type,
-- language, volatility, strictness, SECURITY DEFINER/INVOKER, and PARALLEL
-- setting from production; only `SET search_path = ''` is newly added.
--
-- This migration touches only: the 4 function bodies below, and EXECUTE
-- revokes on public.handle_new_user() for PUBLIC/anon/authenticated. It does
-- not touch reserve_ai_usage/release_ai_usage, any table, any trigger
-- definition, any RLS policy, any DB data, or Storage.

-- 1. public.get_brand_categories(text)
-- Unqualified reference fixed: food_items -> public.food_items.
-- ACL (PUBLIC/anon/authenticated/postgres/service_role EXECUTE) is
-- unaffected by CREATE OR REPLACE and is intentionally left unchanged, since
-- this function is called directly via supabase.rpc() from
-- src/app/(dashboard)/meal/food-search/FoodSearchClient.tsx.
create or replace function public.get_brand_categories(brand_name text)
returns table(category text)
language sql
volatile
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
  SELECT DISTINCT category
  FROM public.food_items
  WHERE brand = brand_name
    AND category IS NOT NULL
    AND category != ''
  ORDER BY category;
$$;

-- 2. public.kata_to_hira(text)
-- Pure string transformation; only references built-in functions
-- (length/ascii/substring/chr), all in pg_catalog. pg_catalog is always
-- implicitly searched regardless of search_path, so these calls continue to
-- resolve correctly with search_path='' and the body is left byte-for-byte
-- identical to production; only SET search_path = '' is added.
create or replace function public.kata_to_hira(t text)
returns text
language plpgsql
immutable
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
DECLARE
  result text := '';
  i integer;
  code integer;
BEGIN
  FOR i IN 1..length(t) LOOP
    code := ascii(substring(t FROM i FOR 1));
    IF code >= 12449 AND code <= 12534 THEN
      result := result || chr(code - 96);
    ELSE
      result := result || substring(t FROM i FOR 1);
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- 3. public.set_food_item_reading()
-- Trigger function on public.food_items (BEFORE INSERT OR UPDATE, trigger
-- "food_items_reading_trigger" — left untouched by this migration).
-- Unqualified reference fixed: kata_to_hira(NEW.name) -> public.kata_to_hira(NEW.name).
create or replace function public.set_food_item_reading()
returns trigger
language plpgsql
volatile
called on null input
security invoker
parallel unsafe
set search_path = ''
as $$
BEGIN
  IF NEW.reading IS NULL THEN
    NEW.reading := public.kata_to_hira(NEW.name);
  END IF;
  RETURN NEW;
END;
$$;

-- 4. public.handle_new_user()
-- Trigger function on auth.users (AFTER INSERT, trigger
-- "on_auth_user_created" — left untouched by this migration). Body already
-- fully schema-qualified (public.profiles) in production; no body change
-- needed beyond adding SET search_path = ''.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
volatile
called on null input
security definer
parallel unsafe
set search_path = ''
as $$
begin
  insert into public.profiles (user_id)
  values (new.id);
  return new;
end;
$$;

-- Trigger invocation does not go through direct-call EXECUTE privilege
-- checks (trigger functions are invoked by the trigger mechanism itself, not
-- via a caller-issued SELECT/CALL), so on_auth_user_created continues to
-- fire this function on every auth.users insert after these revokes.
-- postgres and service_role retain their existing EXECUTE grants; only the
-- PUBLIC/anon/authenticated direct-call path is removed.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
