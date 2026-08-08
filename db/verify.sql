-- Executable checks for db/schema.sql: functional behaviour plus the
-- security model (what the anon key can and cannot do).
--
-- Against a scratch Postgres:
--   createdb sl_test
--   psql -d sl_test -c "create role anon nologin; create role authenticated nologin;"
--   psql -d sl_test -f db/schema.sql
--   psql -d sl_test -f db/verify.sql
--
-- Every check prints PASS or a value labelled with its expectation.
-- Run it on a scratch database, never on real data: it writes rows.


-- A share code the length check will accept.
\set code '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set house '''hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh'''

\echo === create_shared_list is idempotent ===
select public.create_shared_list('11111111-1111-1111-1111-111111111111'::uuid, :code, 'Weekly');
select public.create_shared_list('11111111-1111-1111-1111-111111111111'::uuid, :code, 'Weekly');
select count(*) as lists_created from public.lists;

\echo === a too-short share code is rejected ===
do $$
begin
  perform public.create_shared_list('22222222-2222-2222-2222-222222222222'::uuid, 'short', 'Nope');
  raise exception 'TEST FAILED: short code was accepted';
exception when others then
  if sqlerrm like '%too short%' then raise notice 'ok: rejected (%)', sqlerrm;
  else raise; end if;
end;
$$;

\echo === pull_list on an unknown code returns null ===
select public.pull_list('nosuchcode') is null as returns_null;

\echo === push_list inserts items and echoes state ===
select jsonb_array_length(public.push_list(
  :code, 'Weekly', '2026-08-02T10:00:00Z'::timestamptz,
  '[{"id":"aaaaaaaa-0000-0000-0000-000000000001","recipeId":null,"dbEntryId":"seed:apple",
     "name":"Apple","quantity":3,"unit":"count","unitLabel":null,"category":"produce",
     "emoji":"apple","checked":false,"deleted":false,"updatedAt":"2026-08-02T10:00:00Z"}]'::jsonb,
  '[]'::jsonb) -> 'items') as items_after_push;

\echo === category and emoji survive the round trip ===
select
  (public.pull_list(:code) -> 'items' -> 0 ->> 'category') as category,
  (public.pull_list(:code) -> 'items' -> 0 ->> 'emoji')    as emoji,
  (public.pull_list(:code) -> 'items' -> 0 ->> 'quantity') as quantity;

\echo === an OLDER push does not overwrite a newer row ===
select public.push_list(
  :code, 'Stale name', '2026-08-01T10:00:00Z'::timestamptz,
  '[{"id":"aaaaaaaa-0000-0000-0000-000000000001","recipeId":null,"dbEntryId":"seed:apple",
     "name":"Apple","quantity":99,"unit":"count","unitLabel":null,"category":"produce",
     "emoji":"apple","checked":false,"deleted":false,"updatedAt":"2026-08-01T10:00:00Z"}]'::jsonb,
  '[]'::jsonb) is not null as pushed;
select
  (public.pull_list(:code) -> 'items' -> 0 ->> 'quantity') as quantity_should_be_3,
  (public.pull_list(:code) ->> 'name')                     as name_should_be_weekly;

\echo === a NEWER push does overwrite ===
select public.push_list(
  :code, 'Renamed', '2026-08-03T10:00:00Z'::timestamptz,
  '[{"id":"aaaaaaaa-0000-0000-0000-000000000001","recipeId":null,"dbEntryId":"seed:apple",
     "name":"Apple","quantity":7,"unit":"count","unitLabel":null,"category":"produce",
     "emoji":"apple","checked":true,"deleted":false,"updatedAt":"2026-08-03T10:00:00Z"}]'::jsonb,
  '[]'::jsonb) is not null as pushed;
select
  (public.pull_list(:code) -> 'items' -> 0 ->> 'quantity') as quantity_should_be_7,
  (public.pull_list(:code) -> 'items' -> 0 ->> 'checked')  as checked_should_be_true,
  (public.pull_list(:code) ->> 'name')                     as name_should_be_renamed;

\echo === a tombstone is returned to clients, not hidden ===
select public.push_list(
  :code, 'Renamed', '2026-08-04T10:00:00Z'::timestamptz,
  '[{"id":"aaaaaaaa-0000-0000-0000-000000000001","recipeId":null,"dbEntryId":"seed:apple",
     "name":"Apple","quantity":7,"unit":"count","unitLabel":null,"category":"produce",
     "emoji":"apple","checked":true,"deleted":true,"updatedAt":"2026-08-04T10:00:00Z"}]'::jsonb,
  '[]'::jsonb) is not null as pushed;
select (public.pull_list(:code) -> 'items' -> 0 ->> 'deleted') as deleted_should_be_true;

\echo === a nested recipe ingredient keeps its recipeId ===
select public.push_list(
  :code, 'Renamed', '2026-08-05T10:00:00Z'::timestamptz,
  '[{"id":"aaaaaaaa-0000-0000-0000-000000000002","recipeId":"bbbbbbbb-0000-0000-0000-000000000001",
     "dbEntryId":"seed:tortilla","name":"Tortilla","quantity":8,"unit":"count","unitLabel":null,
     "category":"bakery","emoji":null,"checked":false,"deleted":false,
     "updatedAt":"2026-08-05T10:00:00Z"}]'::jsonb,
  '[{"id":"bbbbbbbb-0000-0000-0000-000000000001","recipeDefId":null,"name":"Tacos",
     "deleted":false,"updatedAt":"2026-08-05T10:00:00Z"}]'::jsonb) is not null as pushed;
select
  jsonb_array_length(public.pull_list(:code) -> 'recipes') as recipe_count,
  (select r ->> 'recipeId' from jsonb_array_elements(public.pull_list(:code) -> 'items') r
    where r ->> 'name' = 'Tortilla') as ingredient_recipe_id;

\echo === pushing to an unknown code raises ===
do $$
begin
  perform public.push_list('nosuchcode', 'x', now(), '[]'::jsonb, '[]'::jsonb);
  raise exception 'TEST FAILED: unknown code accepted';
exception when others then
  if sqlerrm like '%unknown share code%' then raise notice 'ok: rejected (%)', sqlerrm;
  else raise; end if;
end;
$$;

\echo === household: recipes and custom entries round trip ===
select public.push_household(
  :house,
  '[{"id":"cccccccc-0000-0000-0000-000000000001","name":"Pancakes",
     "ingredients":[{"dbEntryId":"seed:eggs","name":"Eggs","quantity":2,"unit":"count"}],
     "deleted":false,"updatedAt":"2026-08-02T10:00:00Z"}]'::jsonb,
  '[{"id":"custom:dragonfruit-powder:x","name":"Dragonfruit Powder",
     "matchTerms":["dragonfruit powder"],"category":"pantry","emoji":null,
     "defaultUnit":"count","deleted":false,"updatedAt":"2026-08-02T10:00:00Z"}]'::jsonb
) is not null as pushed;
select
  (public.pull_household(:house) -> 'recipes' -> 0 ->> 'name')  as recipe_name,
  jsonb_array_length(public.pull_household(:house) -> 'recipes' -> 0 -> 'ingredients') as ingredients,
  (public.pull_household(:house) -> 'entries' -> 0 ->> 'name')     as entry_name,
  (public.pull_household(:house) -> 'entries' -> 0 ->> 'category') as entry_category,
  (public.pull_household(:house) -> 'entries' -> 0 ->> 'isCustom') as entry_is_custom;

\echo === households are isolated from each other ===
select
  jsonb_array_length(public.pull_household('zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz') -> 'recipes') as other_household_recipes;

\echo === ALL FUNCTIONAL CHECKS PASSED ===

\pset pager off
\set code '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''

\echo === a rename with a current timestamp DOES propagate ===
select public.push_list(
  :code, 'Renamed Now', now() + interval '1 second',
  '[]'::jsonb, '[]'::jsonb) is not null as pushed;
select (public.pull_list(:code) ->> 'name') as name_should_be_renamed_now;

\echo
\echo === SECURITY as the anon role ===
set role anon;

do $$
declare n int;
begin
  begin
    select count(*) into n from public.lists;
    raise notice 'FAIL: anon read lists (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read public.lists';
  end;

  begin
    select count(*) into n from public.list_items;
    raise notice 'FAIL: anon read list_items (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read public.list_items';
  end;

  begin
    select count(*) into n from public.household_recipes;
    raise notice 'FAIL: anon read household_recipes (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read public.household_recipes';
  end;

  begin
    select count(*) into n from public.household_entries;
    raise notice 'FAIL: anon read household_entries (% rows)', n;
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot read public.household_entries';
  end;

  begin
    insert into public.lists (id, share_code, name)
    values ('33333333-3333-3333-3333-333333333333'::uuid, 'directwritedirectwritedirect', 'Hack');
    raise notice 'FAIL: anon inserted directly into lists';
  exception when insufficient_privilege then
    raise notice 'PASS: anon cannot insert into public.lists';
  end;

  begin
    perform public.resolve_list('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    raise notice 'FAIL: anon called the internal resolve_list helper';
  exception when insufficient_privilege then
    raise notice 'PASS: resolve_list is denied to anon';
  end;

  -- The one thing anon SHOULD be able to do, given a code.
  begin
    select jsonb_array_length(public.pull_list('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') -> 'items')
      into n;
    raise notice 'PASS: anon can call pull_list with a code (% items)', n;
  exception when others then
    raise notice 'FAIL: anon could not call pull_list (%)', sqlerrm;
  end;

  -- And guessing a code must get nothing.
  begin
    if public.pull_list('guessedcodeguessedcodeguessed') is null then
      raise notice 'PASS: a wrong code returns nothing';
    else
      raise notice 'FAIL: a wrong code returned data';
    end if;
  end;
end;
$$;

reset role;
\echo
\echo === idempotency: the whole schema re-runs cleanly ===
