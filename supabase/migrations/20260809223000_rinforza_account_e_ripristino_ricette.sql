create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

alter function public.apply_sync_operation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) set schema private;

alter function private.apply_sync_operation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) rename to apply_sync_operation_v1;

alter function public.pull_sync_changes(bigint, integer) set schema private;

alter function private.pull_sync_changes(bigint, integer)
  rename to pull_sync_changes_v1;

revoke all on function private.apply_sync_operation_v1(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) from public, anon, authenticated;

revoke all on function private.pull_sync_changes_v1(bigint, integer)
  from public, anon, authenticated;

create function public.apply_sync_operation(
  p_expected_owner_id uuid,
  p_operation_id uuid,
  p_device_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_channel text,
  p_action text,
  p_base_server_version bigint,
  p_payload jsonb default '{}'::jsonb
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

  -- La revisione usa una sequence globale, che assegna il numero prima del
  -- commit. Serializzando le scritture dello stesso account evitiamo che una
  -- revisione maggiore diventi visibile prima di una minore ancora in attesa,
  -- situazione che farebbe avanzare il cursore oltre una modifica non letta.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('sapori-sync:' || v_owner_id::text, 0)
  );

  -- Un ID stabile puo essere riutilizzato dopo che il relativo tombstone e
  -- gia stato ricevuto dal dispositivo. Se la versione coincide, riapriamo la
  -- riga nella stessa transazione; la funzione v1 valida poi il payload,
  -- incrementa la versione e registra la ricevuta idempotente. In caso di
  -- errore l'intera transazione, inclusa questa modifica, viene annullata.
  if p_entity_type = 'recipe'
     and p_channel = 'content'
     and p_action = 'upsert'
     and not exists (
       select 1
       from public.sync_receipts as receipt
       where receipt.owner_id = v_owner_id
         and receipt.operation_id = p_operation_id
     ) then
    update public.recipes
    set deleted_at = null
    where owner_id = v_owner_id
      and recipe_id = p_entity_id
      and deleted_at is not null
      and content_version = coalesce(p_base_server_version, 0);
  end if;

  return private.apply_sync_operation_v1(
    p_operation_id,
    p_device_id,
    p_entity_type,
    p_entity_id,
    p_channel,
    p_action,
    p_base_server_version,
    p_payload
  );
end;
$$;

create function public.pull_sync_changes(
  p_expected_owner_id uuid,
  p_after_revision bigint default 0,
  p_batch_limit integer default 100
)
returns jsonb
language plpgsql
security definer
stable
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

  return private.pull_sync_changes_v1(p_after_revision, p_batch_limit);
end;
$$;

revoke execute on function public.apply_sync_operation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) from public, anon;

grant execute on function public.apply_sync_operation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) to authenticated;

revoke execute on function public.pull_sync_changes(uuid, bigint, integer)
  from public, anon;

grant execute on function public.pull_sync_changes(uuid, bigint, integer)
  to authenticated;

comment on function public.apply_sync_operation(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) is 'Applica una operazione Sapori solo all account autenticato atteso, con idempotenza e ripristino sicuro dei tombstone.';

comment on function public.pull_sync_changes(uuid, bigint, integer) is
  'Restituisce le modifiche Sapori solo quando l account autenticato coincide con quello atteso dal dispositivo.';

notify pgrst, 'reload schema';
