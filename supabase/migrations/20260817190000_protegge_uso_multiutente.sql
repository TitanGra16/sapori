-- Protezioni di uso equo per mantenere Sapori utilizzabile da piu account
-- anche sul piano gratuito. I limiti sono applicati nel database e in
-- Storage: non dipendono quindi dal solo client JavaScript.

create or replace function private.compact_sapori_recipe_tombstone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Dopo una cancellazione il contenuto non serve piu al pull: versioni,
  -- revisione e deleted_at sono sufficienti a propagare il tombstone.
  -- Svuotarlo impedisce alle ricette eliminate di consumare la quota dati.
  if new.deleted_at is not null then
    new.content := '{}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function private.compact_sapori_recipe_tombstone()
  from public, anon, authenticated;

drop trigger if exists recipes_00_compact_tombstone on public.recipes;
create trigger recipes_00_compact_tombstone
before insert or update of content, deleted_at on public.recipes
for each row execute function private.compact_sapori_recipe_tombstone();

create or replace function private.enforce_sapori_recipe_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active_count bigint := 0;
  v_total_count bigint := 0;
  v_content_bytes numeric := 0;
  v_check_active boolean := false;
  v_max_active constant integer := 1500;
  v_max_rows constant integer := 3000;
  v_max_content_bytes constant bigint := 20971520; -- 20 MiB
begin
  if new.owner_id is null then
    raise exception using
      errcode = '22023',
      message = 'sapori-invalid-recipe-owner';
  end if;

  -- La stessa chiave usata dalla RPC serializza anche controlli e scrittura:
  -- due dispositivi dello stesso account non possono superare insieme il
  -- limite dopo avere letto entrambi un conteggio ancora libero.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sapori-sync:' || new.owner_id::text, 0)
  );

  if tg_op = 'INSERT' then
    select count(*)
      into v_total_count
      from public.recipes
     where owner_id = new.owner_id;

    if v_total_count >= v_max_rows then
      raise exception using
        errcode = 'P0001',
        message = 'sapori-recipe-row-limit';
    end if;
  end if;

  if new.deleted_at is null then
    if tg_op = 'INSERT' then
      v_check_active := true;
    elsif tg_op = 'UPDATE' and old.deleted_at is not null then
      v_check_active := true;
    end if;

    if v_check_active then
      select count(*)
        into v_active_count
        from public.recipes
       where owner_id = new.owner_id
         and deleted_at is null
         and recipe_id <> new.recipe_id;

      if v_active_count >= v_max_active then
        raise exception using
          errcode = 'P0001',
          message = 'sapori-recipe-active-limit';
      end if;
    end if;
  end if;

  -- Include anche i tombstone, il cui contenuto e stato appena ridotto a {}.
  -- Escludere la riga corrente rende il calcolo corretto sia in INSERT sia in
  -- UPDATE senza contare due volte il nuovo contenuto.
  select coalesce(sum(pg_catalog.octet_length(content::text)), 0)
    into v_content_bytes
    from public.recipes
   where owner_id = new.owner_id
     and recipe_id <> new.recipe_id;

  v_content_bytes := v_content_bytes +
    pg_catalog.octet_length(coalesce(new.content, '{}'::jsonb)::text);

  if v_content_bytes > v_max_content_bytes then
    raise exception using
      errcode = 'P0001',
      message = 'sapori-recipe-bytes-limit';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sapori_recipe_quota()
  from public, anon, authenticated;

drop trigger if exists recipes_10_enforce_quota on public.recipes;
create trigger recipes_10_enforce_quota
before insert or update of content, deleted_at on public.recipes
for each row execute function private.enforce_sapori_recipe_quota();

create or replace function private.enforce_sapori_receipt_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hour_count bigint := 0;
  v_day_count bigint := 0;
  v_total_count bigint := 0;
  v_max_per_hour constant integer := 1000;
  v_max_per_day constant integer := 5000;
  v_max_retained constant integer := 20000;
begin
  -- Un retry con lo stesso operation_id deve rimanere sempre idempotente e
  -- non deve consumare una nuova unita del rate limit.
  if exists (
    select 1
      from public.sync_receipts
     where owner_id = new.owner_id
       and operation_id = new.operation_id
  ) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sapori-sync:' || new.owner_id::text, 0)
  );

  -- Manteniamo sei mesi di idempotenza. Un dispositivo rimasto offline piu
  -- a lungo ripartira dalle versioni server e gestira un eventuale conflitto,
  -- senza che le ricevute crescano per sempre.
  delete from public.sync_receipts
   where owner_id = new.owner_id
     and result is not null
     and applied_at is not null
     and created_at < pg_catalog.now() - interval '180 days';

  select
    count(*) filter (where created_at >= pg_catalog.now() - interval '1 hour'),
    count(*) filter (where created_at >= pg_catalog.now() - interval '1 day'),
    count(*)
  into v_hour_count, v_day_count, v_total_count
  from public.sync_receipts
  where owner_id = new.owner_id;

  if v_hour_count >= v_max_per_hour then
    raise exception using
      errcode = 'P0001',
      message = 'sapori-sync-hourly-limit';
  end if;

  if v_day_count >= v_max_per_day then
    raise exception using
      errcode = 'P0001',
      message = 'sapori-sync-daily-limit';
  end if;

  if v_total_count >= v_max_retained then
    raise exception using
      errcode = 'P0001',
      message = 'sapori-sync-receipt-limit';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_sapori_receipt_limits()
  from public, anon, authenticated;

drop trigger if exists sync_receipts_10_enforce_limits on public.sync_receipts;
create trigger sync_receipts_10_enforce_limits
before insert on public.sync_receipts
for each row execute function private.enforce_sapori_receipt_limits();

create or replace function private.sapori_recipe_image_quota_status(
  p_owner_id uuid,
  p_object_name text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_bytes numeric := 0;
  v_global_bytes numeric := 0;
  v_owner_objects bigint := 0;
  v_already_exists boolean := false;
  v_max_owner_bytes constant bigint := 52428800; -- 50 MiB
  v_max_global_bytes constant bigint := 943718400; -- 900 MiB
  v_max_owner_objects constant integer := 120;
  v_max_file_bytes constant bigint := 8388608; -- 8 MiB
  v_reason text := null;
begin
  if p_owner_id is null
     or p_object_name is null
     or p_object_name !~ (
       '^' || p_owner_id::text ||
       '/[A-Za-z0-9][A-Za-z0-9_-]{0,127}/' ||
       '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-' ||
       '[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp|gif)$'
     ) then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'invalid-path'
    );
  end if;

  if p_size_bytes is null
     or p_size_bytes < 1
     or p_size_bytes > v_max_file_bytes then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'invalid-size'
    );
  end if;

  -- Il lock globale rende atomico il controllo fra account diversi. Il lock
  -- resta attivo fino al commit dell'INSERT di storage.objects.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sapori-storage-global', 0)
  );

  select exists (
    select 1
      from storage.objects
     where bucket_id = 'recipe-images'
       and name = p_object_name
       and pg_catalog.split_part(name, '/', 1) = p_owner_id::text
  ) into v_already_exists;

  select
    count(*),
    coalesce(sum(
      case
        when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
          then (metadata ->> 'size')::numeric
        else 0
      end
    ), 0)
  into v_owner_objects, v_owner_bytes
  from storage.objects
  where bucket_id = 'recipe-images'
    and pg_catalog.split_part(name, '/', 1) = p_owner_id::text;

  select coalesce(sum(
    case
      when coalesce(metadata ->> 'size', '') ~ '^[0-9]{1,20}$'
        then (metadata ->> 'size')::numeric
      else 0
    end
  ), 0)
  into v_global_bytes
  from storage.objects
  where bucket_id = 'recipe-images';

  if not v_already_exists then
    if v_owner_objects >= v_max_owner_objects then
      v_reason := 'account-object-limit';
    elsif v_owner_bytes + p_size_bytes > v_max_owner_bytes then
      v_reason := 'account-byte-limit';
    elsif v_global_bytes + p_size_bytes > v_max_global_bytes then
      v_reason := 'global-byte-limit';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', v_reason is null,
    'reason', v_reason,
    'alreadyExists', v_already_exists,
    'usedBytes', v_owner_bytes,
    'limitBytes', v_max_owner_bytes,
    'objectCount', v_owner_objects,
    'objectLimit', v_max_owner_objects
  );
end;
$$;

revoke all on function private.sapori_recipe_image_quota_status(uuid, text, bigint)
  from public, anon, authenticated;

create or replace function public.check_recipe_image_upload(
  p_expected_owner_id uuid,
  p_object_name text,
  p_size_bytes bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null then
    raise exception using
      errcode = '42501',
      message = 'Autenticazione richiesta';
  end if;

  if p_expected_owner_id is null
     or v_owner_id is distinct from p_expected_owner_id then
    raise exception using
      errcode = '28000',
      message = 'Account autenticato diverso da quello atteso';
  end if;

  return private.sapori_recipe_image_quota_status(
    v_owner_id,
    p_object_name,
    p_size_bytes
  );
end;
$$;

revoke execute on function public.check_recipe_image_upload(uuid, text, bigint)
  from public, anon;
grant execute on function public.check_recipe_image_upload(uuid, text, bigint)
  to authenticated;

create or replace function public.sapori_recipe_image_upload_allowed(
  p_object_name text,
  p_metadata jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_size_text text := coalesce(p_metadata ->> 'size', '');
  v_status jsonb;
begin
  if v_owner_id is null or v_size_text !~ '^[0-9]{1,10}$' then
    return false;
  end if;

  v_status := private.sapori_recipe_image_quota_status(
    v_owner_id,
    p_object_name,
    v_size_text::bigint
  );
  return coalesce((v_status ->> 'allowed')::boolean, false);
end;
$$;

revoke execute on function public.sapori_recipe_image_upload_allowed(text, jsonb)
  from public, anon;
grant execute on function public.sapori_recipe_image_upload_allowed(text, jsonb)
  to authenticated;

drop policy if exists recipe_images_insert_own on storage.objects;
create policy recipe_images_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'recipe-images'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.sapori_recipe_image_upload_allowed(name, metadata)
);

comment on function public.check_recipe_image_upload(uuid, text, bigint) is
  'Controlla prima dell upload la quota fotografica dell account autenticato atteso.';

comment on function public.sapori_recipe_image_upload_allowed(text, jsonb) is
  'Applica in RLS i limiti per account e il margine globale del bucket fotografie Sapori.';

comment on policy recipe_images_insert_own on storage.objects is
  'Ogni account carica solo nel proprio percorso e nel proprio budget fotografico.';

notify pgrst, 'reload schema';
