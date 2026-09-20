-- Literal, case-insensitive substring search over canonical titles.
-- Trigram indexing keeps partial-title lookups separate from provider work.
create extension if not exists pg_trgm with schema extensions;
create index topics_title_search on public.topics using gin (normalized_key extensions.gin_trgm_ops);

create function public.search_topics(query_input text)
returns table(id uuid, title text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with query as (
    select lower(public.clean_topic_title(query_input)) as value
    where char_length(query_input) <= 1000
  ), pattern as (
    select value, replace(replace(replace(value, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as literal
    from query where char_length(value) between 2 and 160
  )
  select t.id, t.title, t.created_at from public.topics t cross join pattern p
  where t.normalized_key like '%' || p.literal || '%' escape E'\\'
  order by (t.normalized_key = p.value) desc,
    (t.normalized_key like p.literal || '%' escape E'\\') desc,
    t.created_at desc, t.id desc
  limit 8;
$$;
revoke all on function public.search_topics(text) from public;
grant execute on function public.search_topics(text) to anon, authenticated, service_role;
