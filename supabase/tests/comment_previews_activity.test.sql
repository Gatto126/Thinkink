begin;
select plan(12);
insert into public.topics(id,title) values ('f9100000-0000-4000-8000-000000000001','Preview stats fixture');
insert into public.comments(id,topic_id,body,created_at) values
 ('f9200000-0000-4000-8000-000000000001','f9100000-0000-4000-8000-000000000001','Root','2026-09-20T10:00:00Z');
insert into public.comments(id,topic_id,parent_id,body,created_at) values
 ('f9200000-0000-4000-8000-000000000002','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000001','First reply','2026-09-20T11:00:00Z'),
 ('f9200000-0000-4000-8000-000000000003','f9100000-0000-4000-8000-000000000001','f9200000-0000-4000-8000-000000000002','Nested reply','2026-09-20T12:00:00Z');
insert into public.topic_visits(topic_id,visitor_hash,day) values
 ('f9100000-0000-4000-8000-000000000001',repeat('a',64),current_date),
 ('f9100000-0000-4000-8000-000000000001',repeat('b',64),current_date),
 ('f9100000-0000-4000-8000-000000000001',repeat('a',64),current_date-30);
set local role anon;
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,firstReply,body}','First reply','First chronological reply included with root');
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,firstReply,replyBody}','Root','Preview retains parent context');
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,firstReply,canDelete}','false','Preview has safe anonymous permissions');
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,replyCount}','2','Preview count includes nested replies');
select is((select visits from public.topic_activity(array['f9100000-0000-4000-8000-000000000001']::uuid[])),3::bigint,'Visits include all recorded days');
select is((select comment_count from public.topic_activity(array['f9100000-0000-4000-8000-000000000001']::uuid[])),3::bigint,'Comment count includes root and replies');
select throws_ok($$select visitor_hash from public.topic_visits$$,'42501',null,'Visitor identities remain private');
select throws_ok($$select * from public.topic_activity(array_fill('f9100000-0000-4000-8000-000000000001'::uuid,array[51]))$$,'22023','Invalid topics','Counter requests bounded');
reset role;
delete from public.comments where id='f9200000-0000-4000-8000-000000000003';
set local role anon;
select is((select comment_count from public.topic_activity(array['f9100000-0000-4000-8000-000000000001']::uuid[])),2::bigint,'Deleted comments excluded from counts');
reset role;
delete from public.comments where id='f9200000-0000-4000-8000-000000000002';
set local role anon;
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,firstReply}',null::text,'No stale first reply after deletion');
select is(public.topic_comment_threads('f9100000-0000-4000-8000-000000000001')#>>'{items,0,replyCount}','0','No phantom replies');
reset role;
delete from public.topics where id='f9100000-0000-4000-8000-000000000001';
set local role anon;
select is((select count(*) from public.topic_activity(array['f9100000-0000-4000-8000-000000000001']::uuid[])),0::bigint,'Deleted topics have no counters');
select * from finish();
rollback;
