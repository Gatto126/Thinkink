begin;
select plan(21);
insert into auth.users(id,email,raw_user_meta_data) values
 ('f8000000-0000-4000-8000-000000000001','threadfixture@example.test','{"username":"threadfixture"}');
insert into public.topics(id,title,created_by) values
 ('f8100000-0000-4000-8000-000000000001','threadfixture topic','f8000000-0000-4000-8000-000000000001'),
 ('f8100000-0000-4000-8000-000000000002','threadfixture other topic','f8000000-0000-4000-8000-000000000001');
insert into public.comments(id,topic_id,author_id,body,created_at) values
 ('f8200000-0000-4000-8000-000000000001','f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001','First root','2026-09-20T10:00:00Z'),
 ('f8200000-0000-4000-8000-000000000002','f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001','Second root','2026-09-20T11:00:00Z');
insert into public.comments(id,topic_id,author_id,parent_id,body,created_at) values
 ('f8200000-0000-4000-8000-000000000003','f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000001','First reply','2026-09-20T12:00:00Z'),
 ('f8200000-0000-4000-8000-000000000004','f8100000-0000-4000-8000-000000000001','f8000000-0000-4000-8000-000000000001','f8200000-0000-4000-8000-000000000003','Nested reply','2026-09-20T13:00:00Z');
set local role anon;
select is(jsonb_array_length(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')->'items'),2,'Root list excludes replies');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')#>>'{items,0,body}','Second root','Roots sorted newest first');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')#>>'{items,1,replyCount}','2','Nested replies counted in root conversation');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')->>'total','4','Total includes all comments');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')#>>'{items,0,body}','First reply','Replies sorted chronologically');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')#>>'{items,1,replyBody}','First reply','Nested reply keeps parent excerpt');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')#>>'{items,1,parentId}','f8200000-0000-4000-8000-000000000003','Exact reply target retained');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')#>>'{items,0,canDelete}','false','Anonymous reader cannot delete');
select throws_ok($$select public.topic_comment_threads('f8100000-0000-4000-8000-000000000002',0,'f8200000-0000-4000-8000-000000000001')$$,'P0002','Conversation unavailable','Cannot read a thread from another topic');
select throws_ok($$select public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',-1)$$,'22023','Invalid page','Reject invalid page');
reset role;
insert into public.comments(topic_id,author_id,parent_id,body,created_at)
select 'f8100000-0000-4000-8000-000000000001'::uuid,'f8000000-0000-4000-8000-000000000001'::uuid,'f8200000-0000-4000-8000-000000000001'::uuid,'Paged reply '||n,'2026-09-20T14:00:00Z'::timestamptz+n*interval '1 minute' from generate_series(1,50) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','f8000000-0000-4000-8000-000000000001',true);
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')#>>'{items,0,canDelete}','true','Owner deletion permission preserved');
select is(jsonb_array_length(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')->'items'),50,'Reply page bounded');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')->>'hasMore','true','More replies advertised');
select is(jsonb_array_length(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',50,'f8200000-0000-4000-8000-000000000001')->'items'),2,'Last reply page available without losing root');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',50,'f8200000-0000-4000-8000-000000000001')->>'hasMore','false','End of replies');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')#>>'{items,1,replyCount}','52','Root stays present even with more than 50 replies');
select is(public.delete_own_comment('f8200000-0000-4000-8000-000000000003'),true,'Delete intermediate reply');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')#>>'{items,0,body}','Nested reply','Surviving orphan becomes independent conversation');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001',0,'f8200000-0000-4000-8000-000000000001')->>'total','50','Deleted intermediate reply no longer in thread');
select is(public.delete_own_comment('f8200000-0000-4000-8000-000000000001'),true,'Delete root');
select is(public.topic_comment_threads('f8100000-0000-4000-8000-000000000001')->>'total','52','Deleting root preserves surviving messages');
select * from finish();
rollback;
