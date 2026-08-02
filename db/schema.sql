-- Shopping List — shared-list backend (Supabase / Postgres)
--
-- Paste this whole file into the Supabase SQL editor and run it once.
--
-- Security model
-- --------------
-- The anon key shipped in the client grants NOTHING on its own. Row-level
-- security is on with no policies, so direct table access is denied to
-- everyone; all access goes through the SECURITY DEFINER functions below,
-- each of which requires the list's share code.
--
-- The share code is therefore the credential — a 128-bit random string, so
-- guessing one is not feasible. Treat a share link like a house key: anyone
-- who has it can read and edit that one list, and nothing else.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.lists (
  id          uuid primary key,
  share_code  text unique not null,
  name        text not null,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.list_recipes (
  id             uuid primary key,
  list_id        uuid not null references public.lists (id) on delete cascade,
  recipe_def_id  uuid,
  name           text not null,
  deleted        boolean not null default false,
  updated_at     timestamptz not null default now()
);

create table if not exists public.list_items (
  id           uuid primary key,
  list_id      uuid not null references public.lists (id) on delete cascade,
  recipe_id    uuid,
  db_entry_id  text,
  name         text not null,
  quantity     numeric not null default 1,
  unit         text not null default 'count',
  unit_label   text,
  checked      boolean not null default false,
  deleted      boolean not null default false,
  updated_at   timestamptz not null default now()
);

create index if not exists list_items_list_id_idx on public.list_items (list_id);
create index if not exists list_recipes_list_id_idx on public.list_recipes (list_id);

-- Deny-by-default: RLS on, zero policies. Only the functions below can read
-- or write, and they check the share code first.
alter table public.lists         enable row level security;
alter table public.list_recipes  enable row level security;
alter table public.list_items    enable row level security;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.resolve_list(p_share_code text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from public.lists where share_code = p_share_code;
$$;

-- ---------------------------------------------------------------------------
-- API
-- ---------------------------------------------------------------------------

-- Claim a share code for a list. Called once, when a list is first shared.
-- The client generates both the id and the code.
create or replace function public.create_shared_list(
  p_list_id     uuid,
  p_share_code  text,
  p_name        text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(p_share_code) < 20 then
    raise exception 'share code too short';
  end if;

  insert into public.lists (id, share_code, name)
  values (p_list_id, p_share_code, p_name)
  on conflict (id) do nothing;
end;
$$;

-- Full snapshot of a shared list, tombstones included — the client needs to
-- see deletions, not just survivors.
create or replace function public.pull_list(p_share_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list_id uuid;
  v_result  jsonb;
begin
  v_list_id := public.resolve_list(p_share_code);
  if v_list_id is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', l.id,
    'name', l.name,
    'updatedAt', to_char(l.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'recipeId', i.recipe_id,
        'dbEntryId', i.db_entry_id,
        'name', i.name,
        'quantity', i.quantity,
        'unit', i.unit,
        'unitLabel', i.unit_label,
        'checked', i.checked,
        'deleted', i.deleted,
        'updatedAt', to_char(i.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
      from public.list_items i where i.list_id = l.id
    ), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'recipeDefId', r.recipe_def_id,
        'name', r.name,
        'deleted', r.deleted,
        'updatedAt', to_char(r.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
      from public.list_recipes r where r.list_id = l.id
    ), '[]'::jsonb)
  )
  into v_result
  from public.lists l
  where l.id = v_list_id;

  return v_result;
end;
$$;

-- Push local changes. Every row is last-write-wins on updated_at, decided in
-- SQL so a slow client can't overwrite a newer change it never saw. The client
-- merges too; this is the backstop for a race between the pull and the push.
create or replace function public.push_list(
  p_share_code  text,
  p_name        text,
  p_updated_at  timestamptz,
  p_items       jsonb,
  p_recipes     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_list_id uuid;
begin
  v_list_id := public.resolve_list(p_share_code);
  if v_list_id is null then
    raise exception 'unknown share code';
  end if;

  update public.lists
     set name = p_name, updated_at = p_updated_at
   where id = v_list_id
     and p_updated_at > updated_at;

  insert into public.list_recipes (id, list_id, recipe_def_id, name, deleted, updated_at)
  select
    (r ->> 'id')::uuid,
    v_list_id,
    nullif(r ->> 'recipeDefId', '')::uuid,
    r ->> 'name',
    coalesce((r ->> 'deleted')::boolean, false),
    (r ->> 'updatedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) as r
  on conflict (id) do update
    set name          = excluded.name,
        recipe_def_id = excluded.recipe_def_id,
        deleted       = excluded.deleted,
        updated_at    = excluded.updated_at
    where excluded.updated_at > public.list_recipes.updated_at;

  insert into public.list_items (
    id, list_id, recipe_id, db_entry_id, name,
    quantity, unit, unit_label, checked, deleted, updated_at
  )
  select
    (i ->> 'id')::uuid,
    v_list_id,
    nullif(i ->> 'recipeId', '')::uuid,
    nullif(i ->> 'dbEntryId', ''),
    i ->> 'name',
    coalesce((i ->> 'quantity')::numeric, 1),
    coalesce(i ->> 'unit', 'count'),
    nullif(i ->> 'unitLabel', ''),
    coalesce((i ->> 'checked')::boolean, false),
    coalesce((i ->> 'deleted')::boolean, false),
    (i ->> 'updatedAt')::timestamptz
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  on conflict (id) do update
    set recipe_id   = excluded.recipe_id,
        db_entry_id = excluded.db_entry_id,
        name        = excluded.name,
        quantity    = excluded.quantity,
        unit        = excluded.unit,
        unit_label  = excluded.unit_label,
        checked     = excluded.checked,
        deleted     = excluded.deleted,
        updated_at  = excluded.updated_at
    where excluded.updated_at > public.list_items.updated_at;

  -- Return the post-write state so the caller ends the round-trip in sync.
  return public.pull_list(p_share_code);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants: the anon role may call these functions and nothing else.
-- ---------------------------------------------------------------------------

revoke all on public.lists        from anon, authenticated;
revoke all on public.list_items   from anon, authenticated;
revoke all on public.list_recipes from anon, authenticated;

revoke all on function public.resolve_list(text) from anon, authenticated;

grant execute on function public.create_shared_list(uuid, text, text) to anon, authenticated;
grant execute on function public.pull_list(text)                      to anon, authenticated;
grant execute on function public.push_list(text, text, timestamptz, jsonb, jsonb) to anon, authenticated;
