-- Predictive title search is lexical, not semantic identity: a related title
-- must never prevent creating a distinct, more specific topic.
create extension if not exists fuzzystrmatch with schema extensions;

create function public.topic_search_words(value text)
returns text[] language sql immutable strict set search_path = '' as $$
  select coalesce(array_agg(distinct word), '{}'::text[])
  from regexp_split_to_table(lower(public.clean_topic_title(value)), '[^[:alnum:]%_]+') word
  where char_length(word) >= 2
    and word not in ('in','on','at','to','of','for','the','and','or','an','with','from',
      'di','da','il','lo','la','le','gli','un','una','uno','per','con','su','del','della','dei','delle');
$$;

-- Prefixes work in both directions, so a short existing title can be suggested
-- from a longer query too. Stemming is language-wide; no topic-specific aliases.
-- Typo tolerance is bounded by edit distance, not shared trigrams alone.
create function public.topic_word_score(query_word text, title_word text)
returns integer language sql immutable strict set search_path = '' as $$
  select case
    when query_word = title_word then 100
    when query_word ~ '[^[:alnum:]]' or title_word ~ '[^[:alnum:]]' then 0
    when char_length(query_word) >= 3 and char_length(title_word) >= 3 and (
      ts_lexize('pg_catalog.english_stem'::regdictionary, query_word) &&
        ts_lexize('pg_catalog.english_stem'::regdictionary, title_word)
      or ts_lexize('pg_catalog.italian_stem'::regdictionary, query_word) &&
        ts_lexize('pg_catalog.italian_stem'::regdictionary, title_word)
    ) then 90
    when starts_with(title_word, query_word) then 75
    when char_length(title_word) >= 4 and starts_with(query_word, title_word)
      and char_length(title_word)::numeric / char_length(query_word) >= 0.5 then 70
    when least(char_length(query_word), char_length(title_word)) >= 4
      and abs(char_length(query_word) - char_length(title_word)) <= 1
      and extensions.levenshtein_less_equal(query_word, title_word, 1) <= 1 then 50
    else 0
  end;
$$;
revoke all on function public.topic_search_words(text), public.topic_word_score(text,text) from public;
grant execute on function public.topic_search_words(text), public.topic_word_score(text,text) to anon, authenticated, service_role;

create or replace function public.search_topics(query_input text)
returns table(id uuid, title text, created_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with query as (
    select lower(public.clean_topic_title(query_input)) as value,
      public.topic_search_words(query_input) as words
    where char_length(query_input) <= 1000
      and char_length(public.clean_topic_title(query_input)) between 2 and 160
  ), matches as (
    select t.id, t.title, t.created_at, t.normalized_key,
      strpos(t.normalized_key, q.value) > 0 as phrase_match,
      scores.matched_words, scores.quality
    from public.topics t cross join query q
    cross join lateral (
      select count(*) filter (where best.score > 0) as matched_words,
        coalesce(sum(best.score), 0) as quality
      from unnest(q.words) qw
      cross join lateral (
        select max(public.topic_word_score(qw, tw)) as score
        from unnest(public.topic_search_words(t.title)) tw
      ) best
    ) scores
    where strpos(t.normalized_key, q.value) > 0 or scores.matched_words > 0
  )
  select m.id, m.title, m.created_at from matches m cross join query q
  order by (m.normalized_key = q.value) desc, m.phrase_match desc,
    m.matched_words desc, m.quality desc,
    starts_with(m.normalized_key, q.value) desc,
    m.created_at desc, m.id desc
  limit 8;
$$;
