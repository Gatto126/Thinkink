-- Match any meaningful query word as well as the full phrase. Keep literal
-- wildcard handling, public projections, deterministic ranking and the cap.
create or replace function public.search_topics(query_input text)
returns table(id uuid, title text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with query as (
    select lower(public.clean_topic_title(query_input)) as value
    where char_length(query_input) <= 1000
      and char_length(public.clean_topic_title(query_input)) between 2 and 160
  ), words as (
    select distinct word from query,
      lateral regexp_split_to_table(value, '[[:space:]]+') as word
    where char_length(word) >= 2
      and word not in ('in','on','at','to','of','for','the','and','or','an','with','from',
        'di','da','il','lo','la','le','gli','un','una','uno','per','con','su','del','della','dei','delle')
  ), terms as (
    select value as term, 0 as weight from query
    union all
    select word, char_length(word) from words
  ), patterns as (
    select weight,
      replace(replace(replace(term, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') as literal
    from terms
  ), matches as (
    select t.id, t.title, t.created_at, t.normalized_key,
      bool_or(p.weight = 0) as phrase_match,
      count(*) filter (where p.weight > 0) as matched_words,
      sum(p.weight) as matched_length
    from patterns p join public.topics t
      on t.normalized_key like '%' || p.literal || '%' escape E'\\'
    group by t.id, t.title, t.created_at, t.normalized_key
  )
  select m.id, m.title, m.created_at from matches m cross join query q
  order by (m.normalized_key = q.value) desc,
    m.phrase_match desc,
    (left(m.normalized_key, char_length(q.value)) = q.value) desc,
    m.matched_words desc, m.matched_length desc,
    m.created_at desc, m.id desc
  limit 8;
$$;
revoke all on function public.search_topics(text) from public;
grant execute on function public.search_topics(text) to anon, authenticated, service_role;
