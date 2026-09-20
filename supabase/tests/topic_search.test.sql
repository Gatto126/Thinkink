begin;
select plan(14);
insert into public.topics(id,title,created_at) values
 ('f4000000-0000-4000-8000-000000000001','tsneedleiran','2026-09-20T01:00:00Z'),
 ('f4000000-0000-4000-8000-000000000002','tsneedleiran news','2026-09-20T02:00:00Z'),
 ('f4000000-0000-4000-8000-000000000003','Latest tsneedleiran news','2026-09-20T03:00:00Z'),
 ('f4000000-0000-4000-8000-000000000004','tsneedle50% change','2026-09-20T04:00:00Z'),
 ('f4000000-0000-4000-8000-000000000005','tsneedle50X change','2026-09-20T05:00:00Z');
insert into public.topics(title) select 'tsneedlemany ' || n from generate_series(1,12) n;
set local role anon;
select is((select count(*)::integer from public.search_topics('tsneedleiran')),3,'Public substring matching');
select is((select title from public.search_topics('tsneedleiran') limit 1),'tsneedleiran','Exact match first');
select is((select title from public.search_topics('tsneedleiran') offset 1 limit 1),'tsneedleiran news','Prefix ahead of contained match');
select is((select count(*)::integer from public.search_topics('  ＴＳＮＥＥＤＬＥＩＲＡＮ  ')),3,'Normalized case, whitespace and Unicode');
select is((select count(*)::integer from public.search_topics('tsneedle50%')),1,'Percent is literal, not a wildcard');
select is((select count(*)::integer from public.search_topics('tsneedle50_')),0,'Underscore is literal, not a wildcard');
select is((select count(*)::integer from public.search_topics('tsneedleabsent')),0,'No fabricated suggestions');
select is((select count(*)::integer from public.search_topics('tsneedlemany')),8,'Results bounded to eight');
select is((select count(*)::integer from public.search_topics('i')),0,'Short query cannot enumerate all topics');
select is((select count(*)::integer from public.search_topics('war in tsneedleiran') where id in ('f4000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000002','f4000000-0000-4000-8000-000000000003')),3,'A word inside a longer query finds shorter topic titles');
select is((select count(*)::integer from public.search_topics('tsneedleiran war') where id in ('f4000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000002','f4000000-0000-4000-8000-000000000003')),3,'Query word order does not prevent matches');
select is((select count(*)::integer from public.search_topics('tsneedleiran tsneedleiran')),3,'Repeated terms do not duplicate results');
select is((select count(*)::integer from public.search_topics('tsneedleabsent in')),0,'Common connecting words do not generate irrelevant suggestions');
select is((select title from public.search_topics('news tsneedleiran') limit 1),'Latest tsneedleiran news','Titles matching more query words rank first');
select * from finish();
rollback;
