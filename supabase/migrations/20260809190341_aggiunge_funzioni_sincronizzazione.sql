create function public.apply_sync_operation(
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
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_request_hash bytea;
  v_existing_hash bytea;
  v_existing_result jsonb;
  v_inserted_rows integer := 0;
  v_recipe public.recipes%rowtype;
  v_settings public.user_settings%rowtype;
  v_exists boolean := false;
  v_current_version bigint := 0;
  v_result jsonb;
  v_favorite boolean;
  v_categories jsonb;
  v_image_path text;
  v_previous_image_path text;
  v_image_bytes bigint;
  v_image_mime text;
begin
  if v_owner_id is null then
    raise exception using
      errcode = '42501',
      message = 'Autenticazione richiesta';
  end if;

  if p_operation_id is null or p_device_id is null then
    raise exception using
      errcode = '22023',
      message = 'Identificatori di sincronizzazione non validi';
  end if;

  if p_entity_id is null or length(p_entity_id) not between 1 and 128 then
    raise exception using
      errcode = '22023',
      message = 'Identificatore entita non valido';
  end if;

  if p_base_server_version is not null and p_base_server_version < 0 then
    raise exception using
      errcode = '22023',
      message = 'Versione server di base non valida';
  end if;

  if jsonb_typeof(v_payload) is distinct from 'object'
     or octet_length(v_payload::text) > 1179648 then
    raise exception using
      errcode = '22023',
      message = 'Payload non valido o troppo grande';
  end if;

  if not coalesce((
    (p_entity_type = 'recipe' and p_channel = 'content' and p_action in ('upsert', 'delete'))
    or (p_entity_type = 'recipe' and p_channel = 'favorite' and p_action = 'set')
    or (p_entity_type = 'recipe' and p_channel = 'image' and p_action in ('upsert', 'delete'))
    or (
      p_entity_type = 'settings'
      and p_entity_id = 'customCategories'
      and p_channel = 'categories'
      and p_action = 'upsert'
    )
  ), false) then
    raise exception using
      errcode = '22023',
      message = 'Operazione di sincronizzazione non supportata';
  end if;

  if p_entity_type = 'recipe'
     and p_entity_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then
    raise exception using
      errcode = '22023',
      message = 'Identificatore ricetta non valido';
  end if;

  v_request_hash := extensions.digest(
    convert_to(
      jsonb_build_object(
        'deviceId', p_device_id,
        'entityType', p_entity_type,
        'entityId', p_entity_id,
        'channel', p_channel,
        'action', p_action,
        'baseServerVersion', p_base_server_version,
        'payload', v_payload
      )::text,
      'UTF8'
    ),
    'sha256'
  );

  insert into public.sync_receipts (
    owner_id,
    operation_id,
    device_id,
    request_hash,
    entity_type,
    entity_id,
    channel,
    action
  )
  values (
    v_owner_id,
    p_operation_id,
    p_device_id,
    v_request_hash,
    p_entity_type,
    p_entity_id,
    p_channel,
    p_action
  )
  on conflict (owner_id, operation_id) do nothing;

  get diagnostics v_inserted_rows = row_count;

  if v_inserted_rows = 0 then
    select request_hash, result
    into v_existing_hash, v_existing_result
    from public.sync_receipts
    where owner_id = v_owner_id
      and operation_id = p_operation_id
    for update;

    if v_existing_hash <> v_request_hash then
      raise exception using
        errcode = '22023',
        message = 'Operation ID gia usato con dati differenti';
    end if;

    if v_existing_result is null then
      raise exception using
        errcode = '40001',
        message = 'Operazione identica ancora in elaborazione';
    end if;

    return v_existing_result;
  end if;

  if p_entity_type = 'recipe' then
    select *
    into v_recipe
    from public.recipes
    where owner_id = v_owner_id
      and recipe_id = p_entity_id
    for update;
    v_exists := found;

    if p_channel = 'content' then
      v_current_version := case when v_exists then v_recipe.content_version else 0 end;

      if coalesce(p_base_server_version, 0) <> v_current_version then
        v_result := jsonb_build_object(
          'status', 'conflict',
          'operationId', p_operation_id,
          'serverVersion', v_current_version,
          'revision', case when v_exists then v_recipe.revision else 0 end,
          'remote', case
            when v_exists then jsonb_build_object(
              'content', v_recipe.content,
              'isFavorite', v_recipe.is_favorite,
              'imagePath', v_recipe.image_path,
              'contentVersion', v_recipe.content_version,
              'favoriteVersion', v_recipe.favorite_version,
              'imageVersion', v_recipe.image_version,
              'deletedAt', v_recipe.deleted_at
            )
            else jsonb_build_object('missing', true)
          end
        );
        update public.sync_receipts
        set result = v_result, applied_at = now()
        where owner_id = v_owner_id and operation_id = p_operation_id;
        return v_result;
      end if;

      if p_action = 'upsert' then
        if jsonb_typeof(v_payload -> 'recipe') is distinct from 'object'
           or octet_length((v_payload -> 'recipe')::text) > 1048576 then
          raise exception using
            errcode = '22023',
            message = 'Contenuto ricetta non valido';
        end if;

        if v_exists and v_recipe.deleted_at is not null then
          v_result := jsonb_build_object(
            'status', 'conflict',
            'operationId', p_operation_id,
            'serverVersion', v_recipe.content_version,
            'revision', v_recipe.revision,
            'remote', jsonb_build_object(
              'content', v_recipe.content,
              'isFavorite', v_recipe.is_favorite,
              'imagePath', v_recipe.image_path,
              'contentVersion', v_recipe.content_version,
              'favoriteVersion', v_recipe.favorite_version,
              'imageVersion', v_recipe.image_version,
              'deletedAt', v_recipe.deleted_at
            )
          );
          update public.sync_receipts
          set result = v_result, applied_at = now()
          where owner_id = v_owner_id and operation_id = p_operation_id;
          return v_result;
        end if;

        if v_exists then
          update public.recipes
          set
            content = v_payload -> 'recipe',
            content_version = content_version + 1
          where owner_id = v_owner_id and recipe_id = p_entity_id
          returning * into v_recipe;
        else
          insert into public.recipes (
            owner_id,
            recipe_id,
            content,
            content_version
          )
          values (
            v_owner_id,
            p_entity_id,
            v_payload -> 'recipe',
            1
          )
          returning * into v_recipe;
        end if;
      else
        if v_exists and v_recipe.deleted_at is not null then
          v_result := jsonb_build_object(
            'status', 'applied',
            'operationId', p_operation_id,
            'serverVersion', v_recipe.content_version,
            'revision', v_recipe.revision,
            'alreadyDeleted', true
          );
          update public.sync_receipts
          set
            result = v_result,
            applied_revision = v_recipe.revision,
            applied_at = now()
          where owner_id = v_owner_id and operation_id = p_operation_id;
          return v_result;
        end if;

        if v_exists then
          v_previous_image_path := v_recipe.image_path;
          update public.recipes
          set
            deleted_at = now(),
            content_version = content_version + 1,
            image_path = null,
            image_version = image_version + case when image_path is null then 0 else 1 end
          where owner_id = v_owner_id and recipe_id = p_entity_id
          returning * into v_recipe;
        else
          insert into public.recipes (
            owner_id,
            recipe_id,
            content,
            content_version,
            deleted_at
          )
          values (
            v_owner_id,
            p_entity_id,
            '{}'::jsonb,
            1,
            now()
          )
          returning * into v_recipe;
        end if;
      end if;

      v_result := jsonb_strip_nulls(jsonb_build_object(
        'status', 'applied',
        'operationId', p_operation_id,
        'serverVersion', v_recipe.content_version,
        'revision', v_recipe.revision,
        'orphanImagePath', v_previous_image_path
      ));
    elsif p_channel = 'favorite' then
      v_current_version := case when v_exists then v_recipe.favorite_version else 0 end;

      if not v_exists
         or v_recipe.deleted_at is not null
         or coalesce(p_base_server_version, 0) <> v_current_version then
        v_result := jsonb_build_object(
          'status', 'conflict',
          'operationId', p_operation_id,
          'serverVersion', v_current_version,
          'revision', case when v_exists then v_recipe.revision else 0 end,
          'remote', case
            when v_exists then jsonb_build_object(
              'value', v_recipe.is_favorite,
              'deletedAt', v_recipe.deleted_at
            )
            else jsonb_build_object('missing', true)
          end
        );
        update public.sync_receipts
        set result = v_result, applied_at = now()
        where owner_id = v_owner_id and operation_id = p_operation_id;
        return v_result;
      end if;

      if jsonb_typeof(v_payload -> 'value') is distinct from 'boolean' then
        raise exception using
          errcode = '22023',
          message = 'Valore preferito non valido';
      end if;
      v_favorite := (v_payload ->> 'value')::boolean;

      update public.recipes
      set
        is_favorite = v_favorite,
        favorite_version = favorite_version + 1
      where owner_id = v_owner_id and recipe_id = p_entity_id
      returning * into v_recipe;

      v_result := jsonb_build_object(
        'status', 'applied',
        'operationId', p_operation_id,
        'serverVersion', v_recipe.favorite_version,
        'revision', v_recipe.revision
      );
    else
      v_current_version := case when v_exists then v_recipe.image_version else 0 end;

      if not v_exists
         or v_recipe.deleted_at is not null
         or coalesce(p_base_server_version, 0) <> v_current_version then
        v_result := jsonb_build_object(
          'status', 'conflict',
          'operationId', p_operation_id,
          'serverVersion', v_current_version,
          'revision', case when v_exists then v_recipe.revision else 0 end,
          'remote', case
            when v_exists then jsonb_build_object(
              'path', v_recipe.image_path,
              'deletedAt', v_recipe.deleted_at
            )
            else jsonb_build_object('missing', true)
          end
        );
        update public.sync_receipts
        set result = v_result, applied_at = now()
        where owner_id = v_owner_id and operation_id = p_operation_id;
        return v_result;
      end if;

      v_previous_image_path := v_recipe.image_path;

      if p_action = 'upsert' then
        v_image_path := v_payload ->> 'path';
        v_image_mime := v_payload ->> 'mimeType';
        v_image_bytes := nullif(v_payload ->> 'bytes', '')::bigint;

        if v_image_path is null
           or length(v_image_path) not between 1 and 1024
           or split_part(v_image_path, '/', 1) <> v_owner_id::text
           or split_part(v_image_path, '/', 2) <> p_entity_id
           or v_image_mime is null
           or v_image_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
           or v_image_bytes is null
           or v_image_bytes not between 1 and 8388608 then
          raise exception using
            errcode = '22023',
            message = 'Metadati fotografia non validi';
        end if;
      else
        v_image_path := null;
      end if;

      update public.recipes
      set
        image_path = v_image_path,
        image_version = image_version + 1
      where owner_id = v_owner_id and recipe_id = p_entity_id
      returning * into v_recipe;

      v_result := jsonb_strip_nulls(jsonb_build_object(
        'status', 'applied',
        'operationId', p_operation_id,
        'serverVersion', v_recipe.image_version,
        'revision', v_recipe.revision,
        'orphanImagePath', case
          when v_previous_image_path is distinct from v_image_path then v_previous_image_path
          else null
        end
      ));
    end if;
  else
    v_categories := v_payload -> 'items';
    if jsonb_typeof(v_categories) is distinct from 'array'
       or jsonb_array_length(v_categories) > 100
       or octet_length(v_categories::text) > 131072 then
      raise exception using
        errcode = '22023',
        message = 'Categorie non valide';
    end if;

    select *
    into v_settings
    from public.user_settings
    where owner_id = v_owner_id
    for update;
    v_exists := found;
    v_current_version := case when v_exists then v_settings.categories_version else 0 end;

    if coalesce(p_base_server_version, 0) <> v_current_version then
      v_result := jsonb_build_object(
        'status', 'conflict',
        'operationId', p_operation_id,
        'serverVersion', v_current_version,
        'revision', case when v_exists then v_settings.revision else 0 end,
        'remote', jsonb_build_object(
          'items', case when v_exists then v_settings.categories else '[]'::jsonb end
        )
      );
      update public.sync_receipts
      set result = v_result, applied_at = now()
      where owner_id = v_owner_id and operation_id = p_operation_id;
      return v_result;
    end if;

    if v_exists then
      update public.user_settings
      set
        categories = v_categories,
        categories_version = categories_version + 1
      where owner_id = v_owner_id
      returning * into v_settings;
    else
      insert into public.user_settings (
        owner_id,
        categories,
        categories_version
      )
      values (
        v_owner_id,
        v_categories,
        1
      )
      returning * into v_settings;
    end if;

    v_result := jsonb_build_object(
      'status', 'applied',
      'operationId', p_operation_id,
      'serverVersion', v_settings.categories_version,
      'revision', v_settings.revision
    );
  end if;

  update public.sync_receipts
  set
    result = v_result,
    applied_revision = (v_result ->> 'revision')::bigint,
    applied_at = now()
  where owner_id = v_owner_id
    and operation_id = p_operation_id;

  return v_result;
end;
$$;

create function public.pull_sync_changes(
  p_after_revision bigint default 0,
  p_batch_limit integer default 100
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_owner_id uuid := auth.uid();
  v_after_revision bigint := greatest(coalesce(p_after_revision, 0), 0);
  v_limit integer := greatest(1, least(coalesce(p_batch_limit, 100), 500));
  v_changes jsonb;
  v_last_revision bigint;
  v_count integer;
begin
  if v_owner_id is null then
    raise exception using
      errcode = '42501',
      message = 'Autenticazione richiesta';
  end if;

  select
    coalesce(jsonb_agg(page.change order by page.revision), '[]'::jsonb),
    coalesce(max(page.revision), v_after_revision),
    count(*)::integer
  into v_changes, v_last_revision, v_count
  from (
    select
      recipe.revision,
      jsonb_build_object(
        'entityType', 'recipe',
        'entityId', recipe.recipe_id,
        'revision', recipe.revision,
        'payload', jsonb_build_object(
          'content', recipe.content,
          'isFavorite', recipe.is_favorite,
          'imagePath', recipe.image_path,
          'contentVersion', recipe.content_version,
          'favoriteVersion', recipe.favorite_version,
          'imageVersion', recipe.image_version,
          'deletedAt', recipe.deleted_at,
          'updatedAt', recipe.updated_at
        )
      ) as change
    from public.recipes as recipe
    where recipe.owner_id = v_owner_id
      and recipe.revision > v_after_revision

    union all

    select
      settings.revision,
      jsonb_build_object(
        'entityType', 'settings',
        'entityId', 'customCategories',
        'revision', settings.revision,
        'payload', jsonb_build_object(
          'items', settings.categories,
          'categoriesVersion', settings.categories_version,
          'updatedAt', settings.updated_at
        )
      ) as change
    from public.user_settings as settings
    where settings.owner_id = v_owner_id
      and settings.revision > v_after_revision

    order by revision
    limit v_limit
  ) as page;

  return jsonb_build_object(
    'changes', v_changes,
    'lastRevision', v_last_revision,
    'hasMore', v_count = v_limit
  );
end;
$$;

revoke execute on function public.apply_sync_operation(
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
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) to authenticated;

revoke execute on function public.pull_sync_changes(bigint, integer) from public, anon;
grant execute on function public.pull_sync_changes(bigint, integer) to authenticated;

comment on function public.apply_sync_operation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  bigint,
  jsonb
) is 'Applica una singola operazione Sapori in modo autenticato, versionato e idempotente.';

comment on function public.pull_sync_changes(bigint, integer) is
  'Restituisce una pagina ordinata di modifiche Sapori successive alla revisione indicata.';
