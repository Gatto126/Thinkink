-- Account identities are exposed only through this moderator-checked projection.
create function public.moderation_users(query_input text default '', offset_input integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if query_input is null or char_length(query_input) > 160
    or offset_input is null or offset_input < 0 or offset_input > 100000 then
    raise exception 'Invalid filters' using errcode = '22023';
  end if;
  with page as (
    select u.id, u.email, u.created_at, p.username
    from auth.users u left join public.profiles p on p.id = u.id
    where strpos(lower(coalesce(u.email, '')), lower(btrim(query_input))) > 0
      or strpos(lower(coalesce(p.username, '')), lower(btrim(query_input))) > 0
    order by u.created_at desc, u.id desc limit 51 offset offset_input
  ), visible as (
    select * from page order by created_at desc, id desc limit 50
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'username', v.username, 'email', v.email, 'createdAt', v.created_at,
      'isModerator', exists(select 1 from public.moderators m where m.user_id = v.id),
      'isCurrentUser', v.id = auth.uid(),
      'topicCount', (select count(*) from public.topics t where t.created_by = v.id),
      'commentCount', (select count(*) from public.comments c where c.author_id = v.id)
    ) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'hasMore', (select count(*) > 50 from page)) into result;
  return result;
end;
$$;

-- This explicit admin action differs from self-service account deletion, which
-- retains anonymized discussions. Everything here commits or rolls back together.
create function public.moderate_user(user_input uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  if user_input = auth.uid() then
    raise exception 'Cannot delete your own account from moderation' using errcode = '22023';
  end if;
  -- Block concurrent writes referencing the target before collecting their content.
  perform 1 from auth.users where id = user_input for update;
  if not found then
    raise exception 'User unavailable' using errcode = 'P0002';
  end if;
  delete from public.topics where created_by = user_input;
  delete from public.comments where author_id = user_input;
  delete from auth.users where id = user_input;
  -- Foreign keys remove profiles, identities, sessions and usage rows; the
  -- existing Auth deletion trigger also removes refresh tokens and audit traces.
  return true;
end;
$$;
revoke all on function public.moderation_users(text,integer), public.moderate_user(uuid) from public, anon, authenticated;
grant execute on function public.moderation_users(text,integer), public.moderate_user(uuid) to authenticated;
