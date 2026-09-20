-- Expose only public attribution and preview text, never private creator IDs.
create function public.home_topics()
returns table (
  id uuid, title text, created_at timestamptz,
  creator_username text, excerpt text, updated_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select t.id, t.title, t.created_at, p.username,
    coalesce(nullif(btrim(c.summary->'paragraphs'->0->>'text'), ''),
      nullif(btrim(split_part(c.summary->>'text', E'\n\n', 1)), '')),
    greatest(t.created_at, c.news_checked_at,
      (c.summary->>'generatedAt')::timestamptz,
      (c.summary->>'editedAt')::timestamptz)
  from public.topics t
  left join public.profiles p on p.id = t.created_by
  left join public.topic_content c on c.topic_id = t.id
  order by t.created_at desc, t.id desc
  limit 30;
$$;
revoke all on function public.home_topics() from public;
grant execute on function public.home_topics() to anon, authenticated, service_role;
