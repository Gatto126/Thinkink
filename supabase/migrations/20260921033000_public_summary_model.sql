-- The generating model is public attribution, not a secret or an account identity.
grant select(model) on public.topic_content to anon, authenticated;
