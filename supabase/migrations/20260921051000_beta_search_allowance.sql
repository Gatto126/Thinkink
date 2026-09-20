-- Align per-account searches with five topic creations; shared daily/lifetime caps remain unchanged.
create or replace function public.reserve_provider_call(provider_input text, topic_input uuid, job_input uuid, model_input text default null)
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
  if provider_input='serper' and (select count(*) from public.provider_attempts where provider='serper' and actor_id=actor and started_at>=day_start)>=5 then
    return jsonb_build_object('allowed',false,'reason','user_budget');
  end if;
  insert into public.provider_attempts(provider,topic_id,actor_id,job_id,model) values(provider_input,topic_input,actor,job_input,model_input) returning id into call_id;
  return jsonb_build_object('allowed',true,'id',call_id);
end;
$$;

