begin;
select plan(3);
-- Keep ranking assertions independent of locally browsed topics.
delete from public.topic_visits;
insert into public.topics(id,title,created_at) values
 ('fc100000-0000-4000-8000-000000000001','Ranking one','2026-01-01'),
 ('fc100000-0000-4000-8000-000000000002','Ranking two','2026-01-02'),
 ('fc100000-0000-4000-8000-000000000003','Ranking three','2026-01-03'),
 ('fc100000-0000-4000-8000-000000000004','Ranking four','2026-01-04');
insert into public.topic_visits(topic_id,visitor_hash,day)
select ('fc100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,lpad(v::text,64,'0'),current_date-30
from generate_series(1,4) n cross join lateral generate_series(1,5-n) v;
set local role anon;
select is((select count(*) from public.popular_topics()),3::bigint,'Returns exactly the three most visited topics');
select is((select array_agg(title) from public.popular_topics()),array['Ranking one','Ranking two','Ranking three'],'Lifetime visits determine descending order');
select is((select array_agg(visits) from public.popular_topics()),array[4,3,2]::bigint[],'Counts include older visits');
select * from finish();
rollback;
