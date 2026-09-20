-- Rate limits can be temporary even while daily free quota remains available.
-- Keep a 15-minute provider cooldown for unknown 429s, with explicit retries only.
create or replace function public.record_provider_result(call_input uuid, outcome_input text, cooldown_input boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare provider_name text;
begin
  update public.provider_attempts set outcome=left(outcome_input,60) where id=call_input returning provider into provider_name;
  if cooldown_input then
    update public.provider_limits set cooldown_until=greatest(coalesce(cooldown_until,now()),now()+
      case when outcome_input='http_429' then interval '15 minutes' else interval '24 hours' end)
      where provider=provider_name;
  end if;
end;
$$;

create or replace function public.finish_topic_content(topic_input uuid, job_input uuid, status_input text,
  summary_input jsonb default null, model_input text default null, hash_input text default null, error_input text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if status_input not in ('ready','partial','empty','paused','error') then raise exception 'Invalid status'; end if;
  update public.topic_content set
    input_snapshot=case when summary is null and summary_input is not null then
      jsonb_build_object('articles',news,'retrievedAt',news_checked_at) else input_snapshot end,
    summary=coalesce(summary,summary_input),status=status_input,
    model=coalesce(model,model_input),input_hash=coalesce(input_hash,hash_input),error_code=error_input,
    lease_until=null,job_id=null,next_attempt_at=case
      when status_input='ready' then null
      when status_input='paused' and error_input='http_429' then now()+interval '15 minutes'
      when status_input in ('empty','paused') then now()+interval '24 hours'
      else now()+interval '15 minutes' end
    where topic_id=topic_input and job_id=job_input and lease_until>now() and status='preparing';
  return found;
end;
$$;

-- Correct existing pauses only when the most recent failure was the old generic 429.
update public.provider_limits l set cooldown_until=a.started_at+interval '15 minutes'
from (select distinct on (provider) provider,outcome,started_at from public.provider_attempts order by provider,started_at desc) a
where l.provider=a.provider and a.outcome='http_429'
  and l.cooldown_until>a.started_at+interval '15 minutes';
update public.topic_content c set next_attempt_at=a.started_at+interval '15 minutes'
from (select topic_id,max(started_at) started_at from public.provider_attempts where outcome='http_429' group by topic_id) a
where c.topic_id=a.topic_id and c.status='paused' and c.error_code='http_429'
  and c.next_attempt_at>a.started_at+interval '15 minutes';
