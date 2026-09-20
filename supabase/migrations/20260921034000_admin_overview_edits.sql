-- Original generation and editor identity remain private; public attribution lives in summary.
alter table public.topic_content add column original_summary jsonb;
alter table public.topic_content add column overview_edited_by uuid references auth.users(id) on delete set null;

create or replace function public.edit_topic_overview(
  topic_input uuid, revision_input integer, headline_input text, paragraphs_input jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  content public.topic_content%rowtype;
  paragraph jsonb;
  reference jsonb;
  revised jsonb;
  body_text text;
begin
  if not public.is_moderator() then
    raise exception 'Moderator access required' using errcode = '42501';
  end if;
  select * into content from public.topic_content where topic_id = topic_input for update;
  if not found or content.summary is null then
    raise exception 'Overview unavailable' using errcode = 'P0002';
  end if;
  if revision_input is null or revision_input <> coalesce((content.summary->>'revision')::integer, 0) then
    raise exception 'Overview changed' using errcode = '40001';
  end if;
  if headline_input is null or length(btrim(headline_input)) not between 1 and 300
    or paragraphs_input is null or jsonb_typeof(paragraphs_input) <> 'array' then
    raise exception 'Invalid overview' using errcode = '22023';
  end if;
  if jsonb_array_length(paragraphs_input) not between 1 and 12 then
    raise exception 'Invalid paragraphs' using errcode = '22023';
  end if;
  for paragraph in select value from jsonb_array_elements(paragraphs_input) loop
    if jsonb_typeof(paragraph) <> 'object'
      or jsonb_typeof(paragraph->'text') is distinct from 'string'
      or length(btrim(paragraph->>'text')) not between 1 and 5000
      or jsonb_typeof(paragraph->'sourceIds') is distinct from 'array' then
      raise exception 'Invalid paragraph' using errcode = '22023';
    end if;
    if jsonb_array_length(paragraph->'sourceIds') > 6 then
      raise exception 'Invalid references' using errcode = '22023';
    end if;
    for reference in select value from jsonb_array_elements(paragraph->'sourceIds') loop
      if jsonb_typeof(reference) <> 'string' or not exists (
        select 1 from jsonb_array_elements(content.summary->'sources') source
        where source->'id' = reference
      ) then
        raise exception 'Invalid reference' using errcode = '22023';
      end if;
    end loop;
  end loop;
  select string_agg(value->>'text', E'\n\n' order by ordinal) into body_text
    from jsonb_array_elements(paragraphs_input) with ordinality p(value, ordinal);
  revised := content.summary || jsonb_build_object(
    'headline', btrim(headline_input), 'paragraphs', paragraphs_input, 'text', body_text,
    'revision', revision_input + 1,
    'editedAt', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
  update public.topic_content set summary = revised,
    original_summary = coalesce(original_summary, content.summary), overview_edited_by = auth.uid()
    where topic_id = topic_input;
  return revised || jsonb_build_object('model', content.model);
end;
$$;
revoke all on function public.edit_topic_overview(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.edit_topic_overview(uuid, integer, text, jsonb) to authenticated;
