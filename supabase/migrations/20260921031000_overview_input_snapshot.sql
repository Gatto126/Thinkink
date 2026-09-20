-- Keep the exact excerpts supplied to AI alongside the public linked sources.
alter table public.topic_content add column input_snapshot jsonb;
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
      when status_input in ('empty','paused') then now()+interval '24 hours'
      else now()+interval '15 minutes' end
    where topic_id=topic_input and job_id=job_input and lease_until>now() and status='preparing';
  return found;
end;
$$;
