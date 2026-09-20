-- First preparation only. Reads never schedule providers. Budgets survive topic deletion.
create table public.topic_content (
  topic_id uuid primary key references public.topics(id) on delete cascade,
  news jsonb not null default '[]' check (jsonb_typeof(news) = 'array' and jsonb_array_length(news) <= 6),
  news_checked_at timestamptz,
  news_revision integer not null default 0,
  summary jsonb,
  status text not null default 'idle' check (status in ('idle','preparing','ready','partial','empty','paused','error')),
  job_id uuid,
  lease_until timestamptz,
  requested_by uuid references auth.users(id) on delete set null,
  attempts_day date,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  error_code text,
  input_hash text,
  model text
);
alter table public.topic_content enable row level security;
revoke all on public.topic_content from public, anon, authenticated;
grant select(topic_id,news,news_checked_at,news_revision,summary,status,lease_until,next_attempt_at) on public.topic_content to anon, authenticated;
create policy content_public_read on public.topic_content for select to anon, authenticated using (true);
grant all on public.topic_content to service_role;

create table public.provider_limits (
  provider text primary key check (provider in ('serper','openrouter')),
  daily_limit integer not null check (daily_limit between 0 and 20),
  total_limit integer not null check (total_limit between 0 and 200),
  paused boolean not null default false,
  cooldown_until timestamptz
);
insert into public.provider_limits(provider,daily_limit,total_limit) values ('serper',10,100),('openrouter',20,200);
create table public.provider_attempts (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.provider_limits(provider),
  topic_id uuid references public.topics(id) on delete set null,
  actor_id uuid references auth.users(id) on delete set null,
  job_id uuid not null,
  started_at timestamptz not null default now(),
  outcome text not null default 'reserved',
  model text
);
create index provider_attempts_budget on public.provider_attempts(provider,started_at);
create index provider_attempts_actor on public.provider_attempts(actor_id,started_at);
alter table public.provider_limits enable row level security;
alter table public.provider_attempts enable row level security;
revoke all on public.provider_limits, public.provider_attempts from public, anon, authenticated;
grant all on public.provider_limits, public.provider_attempts to service_role;

create function public.claim_topic_content(topic_input uuid, actor_input uuid, manual_input boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.topic_content; claim uuid; today date := (now() at time zone 'UTC')::date;
begin
  -- Called only with the verified identity from the Worker, never from the browser.
  if not exists(select 1 from public.topics t where t.id=topic_input and
    (t.created_by=actor_input or exists(select 1 from public.moderators where user_id=actor_input))) then
    return jsonb_build_object('claimed',false);
  end if;
  insert into public.topic_content(topic_id) values(topic_input) on conflict do nothing;
  select * into item from public.topic_content where topic_id=topic_input for update;
  if item.status='ready' or (item.lease_until > now())
    or (item.status <> 'idle' and not manual_input)
    or (item.next_attempt_at > now())
    or (item.attempts_day=today and item.attempts >= 2) then
    return jsonb_build_object('claimed',false);
  end if;
  claim := gen_random_uuid();
  update public.topic_content set status='preparing',job_id=claim,lease_until=now()+interval '3 minutes',
    requested_by=actor_input,error_code=null,next_attempt_at=null,attempts_day=today,
    attempts=case when attempts_day=today then attempts+1 else 1 end where topic_id=topic_input;
  return jsonb_build_object('claimed',true,'jobId',claim,'news',item.news,'newsCheckedAt',item.news_checked_at);
end;
$$;

create function public.reserve_provider_call(provider_input text, topic_input uuid, job_input uuid, model_input text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare limits public.provider_limits; actor uuid; call_id uuid;
  day_start timestamptz := date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
begin
  -- A topic lock makes each claim single-use per search and bounds model attempts.
  select requested_by into actor from public.topic_content where topic_id=topic_input
    and job_id=job_input and status='preparing' and lease_until>now() for update;
  if not found then return jsonb_build_object('allowed',false,'reason','expired'); end if;
  select * into limits from public.provider_limits where provider=provider_input for update;
  if not found or limits.paused then return jsonb_build_object('allowed',false,'reason','paused'); end if;
  if limits.cooldown_until>now() then return jsonb_build_object('allowed',false,'reason','cooldown'); end if;
  if (select count(*) from public.provider_attempts where provider=provider_input and started_at>=day_start)>=limits.daily_limit
    or (select count(*) from public.provider_attempts where provider=provider_input)>=limits.total_limit then
    return jsonb_build_object('allowed',false,'reason','budget');
  end if;
  if (select count(*) from public.provider_attempts where provider=provider_input and started_at>now()-interval '1 minute')>=4 then
    return jsonb_build_object('allowed',false,'reason','rate');
  end if;
  if (select count(*) from public.provider_attempts where provider=provider_input and job_id=job_input)>=
    (case when provider_input='serper' then 1 else 2 end) then
    return jsonb_build_object('allowed',false,'reason','attempts');
  end if;
  if provider_input='serper' and (select count(*) from public.provider_attempts where provider='serper' and actor_id=actor and started_at>=day_start)>=3 then
    return jsonb_build_object('allowed',false,'reason','user_budget');
  end if;
  insert into public.provider_attempts(provider,topic_id,actor_id,job_id,model) values(provider_input,topic_input,actor,job_input,model_input) returning id into call_id;
  return jsonb_build_object('allowed',true,'id',call_id);
end;
$$;

create function public.record_provider_result(call_input uuid, outcome_input text, cooldown_input boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare provider_name text;
begin
  update public.provider_attempts set outcome=left(outcome_input,60) where id=call_input returning provider into provider_name;
  if cooldown_input then
    update public.provider_limits set cooldown_until=greatest(coalesce(cooldown_until,now()),now()+interval '24 hours') where provider=provider_name;
  end if;
end;
$$;
create function public.save_topic_news(topic_input uuid, job_input uuid, news_input jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.topic_content set news=news_input,news_checked_at=now(),news_revision=news_revision+1
    where topic_id=topic_input and job_id=job_input and lease_until>now() and status='preparing';
  return found;
end;
$$;
create function public.finish_topic_content(topic_input uuid, job_input uuid, status_input text,
  summary_input jsonb default null, model_input text default null, hash_input text default null, error_input text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if status_input not in ('ready','partial','empty','paused','error') then raise exception 'Invalid status'; end if;
  update public.topic_content set summary=coalesce(summary,summary_input),status=status_input,
    model=coalesce(model,model_input),input_hash=coalesce(input_hash,hash_input),error_code=error_input,
    lease_until=null,job_id=null,next_attempt_at=case
      when status_input='ready' then null
      when status_input in ('empty','paused') then now()+interval '24 hours'
      else now()+interval '15 minutes' end
    where topic_id=topic_input and job_id=job_input and lease_until>now() and status='preparing';
  return found;
end;
$$;
revoke all on function public.claim_topic_content(uuid,uuid,boolean), public.reserve_provider_call(text,uuid,uuid,text),
 public.record_provider_result(uuid,text,boolean),public.save_topic_news(uuid,uuid,jsonb),public.finish_topic_content(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_topic_content(uuid,uuid,boolean), public.reserve_provider_call(text,uuid,uuid,text),
 public.record_provider_result(uuid,text,boolean),public.save_topic_news(uuid,uuid,jsonb),public.finish_topic_content(uuid,uuid,text,jsonb,text,text,text) to service_role;

create function public.content_budget_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required' using errcode='42501'; end if;
  return jsonb_build_object('providers',(select jsonb_agg(jsonb_build_object('provider',l.provider,
    'dailyLimit',l.daily_limit,'totalLimit',l.total_limit,'paused',l.paused,'cooldownUntil',l.cooldown_until,
    'dailyUsed',(select count(*) from public.provider_attempts a where a.provider=l.provider and a.started_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'),
    'totalUsed',(select count(*) from public.provider_attempts a where a.provider=l.provider)) order by l.provider) from public.provider_limits l));
end;
$$;
create function public.pause_content_providers(paused_input boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_moderator() then raise exception 'Moderator access required' using errcode='42501'; end if;
  update public.provider_limits set paused=paused_input;
end;
$$;
revoke all on function public.content_budget_status(), public.pause_content_providers(boolean) from public,anon;
grant execute on function public.content_budget_status(), public.pause_content_providers(boolean) to authenticated;
