-- meal-photos Storage: restrict SELECT (read) access to the owning user only.
-- Currently "meal-photos select" allows `role public` with no ownership
-- condition (any signed-in or anonymous request can read any object in this
-- bucket, given the object path). This migration replaces it with an
-- authenticated + own-folder-only policy, matching the existing INSERT/DELETE
-- policies (both already scoped to `(storage.foldername(name))[1] = auth.uid()::text`).
--
-- Only the SELECT policy on storage.objects for this bucket is touched here.
-- INSERT/DELETE policies, UPDATE (none exists), storage.buckets (bucket
-- public/private flag), any other table, RLS enable/disable, and grants are
-- all left untouched by this migration.
--
-- The `meal-photos` bucket itself remains Public until a separate, explicit
-- bucket-level change (via the Storage API, not SQL — see
-- scripts/manage-meal-photos-bucket.mjs). This migration is safe to apply
-- while the bucket is still Public: it only tightens who may read via the
-- authenticated Storage API/RLS path, independent of the bucket's own
-- public/private flag.

drop policy if exists "meal-photos select" on storage.objects;

create policy "meal-photos select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
