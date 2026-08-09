alter table public.recipes enable row level security;
alter table public.user_settings enable row level security;
alter table public.sync_receipts enable row level security;

revoke all on table public.recipes from public, anon, authenticated;
revoke all on table public.user_settings from public, anon, authenticated;
revoke all on table public.sync_receipts from public, anon, authenticated;

grant usage on schema public to authenticated;
grant select on table public.recipes to authenticated;
grant select on table public.user_settings to authenticated;

create policy recipes_read_own
on public.recipes
for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy user_settings_read_own
on public.user_settings
for select
to authenticated
using ((select auth.uid()) = owner_id);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'recipe-images',
  'recipe-images',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy recipe_images_read_own
on storage.objects
for select
to authenticated
using (
  bucket_id = 'recipe-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy recipe_images_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recipe-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy recipe_images_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'recipe-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

comment on policy recipes_read_own on public.recipes is
  'Ogni account autenticato legge esclusivamente le proprie ricette.';

comment on policy user_settings_read_own on public.user_settings is
  'Ogni account autenticato legge esclusivamente le proprie impostazioni.';
