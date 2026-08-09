create extension if not exists pgcrypto with schema extensions;

create sequence public.sapori_sync_revision_seq
  as bigint
  start with 1
  increment by 1
  no cycle;

create table public.recipes (
  owner_id uuid not null references auth.users (id) on delete cascade,
  recipe_id text not null,
  content jsonb not null default '{}'::jsonb,
  is_favorite boolean not null default false,
  image_path text,
  content_version bigint not null default 0,
  favorite_version bigint not null default 0,
  image_version bigint not null default 0,
  revision bigint not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  primary key (owner_id, recipe_id),

  constraint recipes_recipe_id_valid check (
    recipe_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
  ),
  constraint recipes_content_object check (
    jsonb_typeof(content) = 'object'
  ),
  constraint recipes_content_size check (
    octet_length(content::text) <= 1048576
  ),
  constraint recipes_versions_valid check (
    content_version >= 0
    and favorite_version >= 0
    and image_version >= 0
  ),
  constraint recipes_revision_valid check (revision > 0),
  constraint recipes_image_owned check (
    image_path is null
    or (
      length(image_path) between 1 and 1024
      and split_part(image_path, '/', 1) = owner_id::text
      and split_part(image_path, '/', 2) = recipe_id
    )
  )
);

create table public.user_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  categories jsonb not null default '[]'::jsonb,
  categories_version bigint not null default 0,
  revision bigint not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_settings_categories_array check (
    jsonb_typeof(categories) = 'array'
    and jsonb_array_length(categories) <= 100
  ),
  constraint user_settings_categories_size check (
    octet_length(categories::text) <= 131072
  ),
  constraint user_settings_version_valid check (categories_version >= 0),
  constraint user_settings_revision_valid check (revision > 0)
);

create table public.sync_receipts (
  owner_id uuid not null references auth.users (id) on delete cascade,
  operation_id uuid not null,
  device_id uuid not null,
  request_hash bytea not null,
  entity_type text not null,
  entity_id text not null,
  channel text not null,
  action text not null,
  result jsonb,
  applied_revision bigint,
  created_at timestamptz not null default now(),
  applied_at timestamptz,

  primary key (owner_id, operation_id),

  constraint sync_receipts_entity_type_valid check (
    entity_type in ('recipe', 'settings')
  ),
  constraint sync_receipts_channel_valid check (
    channel in ('content', 'favorite', 'image', 'categories')
  ),
  constraint sync_receipts_action_valid check (
    action in ('upsert', 'set', 'delete')
  ),
  constraint sync_receipts_entity_id_size check (
    length(entity_id) between 1 and 128
  ),
  constraint sync_receipts_revision_valid check (
    applied_revision is null or applied_revision > 0
  )
);

create index recipes_owner_revision_idx
  on public.recipes (owner_id, revision);

create index user_settings_owner_revision_idx
  on public.user_settings (owner_id, revision);

create index sync_receipts_owner_created_idx
  on public.sync_receipts (owner_id, created_at desc);

create function public.stamp_sapori_sync_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.revision := nextval('public.sapori_sync_revision_seq'::regclass);
  new.updated_at := now();
  return new;
end;
$$;

create trigger recipes_stamp_sync_revision
before insert or update on public.recipes
for each row execute function public.stamp_sapori_sync_revision();

create trigger user_settings_stamp_sync_revision
before insert or update on public.user_settings
for each row execute function public.stamp_sapori_sync_revision();

revoke all on sequence public.sapori_sync_revision_seq from public, anon, authenticated;
revoke execute on function public.stamp_sapori_sync_revision() from public, anon, authenticated;

comment on table public.recipes is
  'Replica cloud local-first delle ricette Sapori, separata per proprietario.';

comment on table public.user_settings is
  'Impostazioni sincronizzabili Sapori; nella prima versione contiene solo le categorie.';

comment on table public.sync_receipts is
  'Ricevute idempotenti delle operazioni di sincronizzazione applicate.';
