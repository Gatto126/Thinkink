begin;
select plan(24);
insert into auth.users(id,email,raw_user_meta_data) values
 ('fa000000-0000-4000-8000-000000000001','notice1@example.test','{"username":"notice1"}'),
 ('fa000000-0000-4000-8000-000000000002','notice2@example.test','{"username":"notice2"}'),
 ('fa000000-0000-4000-8000-000000000003','notice3@example.test','{"username":"notice3"}');
insert into public.topics(id,title,created_by) values
 ('fa100000-0000-4000-8000-000000000001','Notification fixture','fa000000-0000-4000-8000-000000000001');
insert into public.comments(id,topic_id,author_id,body,created_at) values
 ('fa200000-0000-4000-8000-000000000001','fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000001','Own comment','2026-09-20T10:00:00Z'),
 ('fa200000-0000-4000-8000-000000000002','fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002','Another comment','2026-09-20T11:00:00Z');
select is((select count(*) from public.notifications where recipient_id in ('fa000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002')),1::bigint,'No self notification');
insert into public.comments(id,topic_id,author_id,parent_id,body,created_at) values
 ('fa200000-0000-4000-8000-000000000003','fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002','fa200000-0000-4000-8000-000000000001','Reply to owner','2026-09-20T12:00:00Z'),
 ('fa200000-0000-4000-8000-000000000004','fa100000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000003','fa200000-0000-4000-8000-000000000002','Reply to visitor','2026-09-20T13:00:00Z');
select is((select count(*) from public.notifications where comment_id='fa200000-0000-4000-8000-000000000003'),1::bigint,'Owner and parent deduplicated');
select is((select kind from public.notifications where comment_id='fa200000-0000-4000-8000-000000000003'),'reply','Reply kind takes priority');
select is((select count(*) from public.notifications where comment_id='fa200000-0000-4000-8000-000000000004'),2::bigint,'Distinct parent author and topic owner notified');
set local role anon;
select throws_ok($$select public.my_notifications()$$,'42501',null,'Guests cannot read inbox');
select throws_ok($$select * from public.notifications$$,'42501',null,'Guests cannot read table');
set local role authenticated;
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000002',true);
select is(public.my_notifications()->>'unreadCount','1','Recipient only sees own unread count');
select is(jsonb_array_length(public.my_notifications()->'items'),1,'Recipient only sees own inbox');
select is(public.my_notifications()#>>'{items,0,preview}','Reply to visitor','Preview comes from source comment');
select throws_ok($$select * from public.notifications$$,'42501',null,'Clients cannot bypass inbox RPC');
select throws_ok($$select public.my_notifications(-1)$$,'22023','Invalid page','Bounded pagination');
select is(public.read_notifications((public.my_notifications()#>>'{items,0,id}')::uuid),true,'Can mark own notification read');
select is(public.my_notifications()->>'unreadCount','0','Read count persists');
select is(public.my_notifications()#>>'{items,0,read}','true','Read notification stays in list');
select set_config('request.jwt.claim.sub','fa000000-0000-4000-8000-000000000001',true);
select is(public.my_notifications()->>'unreadCount','3','Other recipient unaffected');
select is(public.read_notifications(),true,'Mark all read');
select is(public.my_notifications()->>'unreadCount','0','All own notifications read');
select is(public.comment_location('fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000004')->>'rootId','fa200000-0000-4000-8000-000000000002','Reply resolves root');
reset role;
insert into public.comments(topic_id,author_id,body,created_at)
select 'fa100000-0000-4000-8000-000000000001'::uuid,'fa000000-0000-4000-8000-000000000001'::uuid,'New root '||n,'2026-09-21T10:00:00Z'::timestamptz+n*interval '1 minute' from generate_series(1,51) n;
insert into public.comments(topic_id,author_id,parent_id,body,created_at)
select 'fa100000-0000-4000-8000-000000000001'::uuid,'fa000000-0000-4000-8000-000000000001'::uuid,'fa200000-0000-4000-8000-000000000002'::uuid,'Early reply '||n,'2026-09-20T11:00:00Z'::timestamptz+n*interval '1 minute' from generate_series(1,51) n;
select is(public.comment_location('fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000004')->>'rootOffset','50','Finds older root page');
select is(public.comment_location('fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000004')->>'replyOffset','50','Finds later reply page');
delete from public.comments where id='fa200000-0000-4000-8000-000000000002';
select is(public.comment_location('fa100000-0000-4000-8000-000000000001','fa200000-0000-4000-8000-000000000004')->>'rootId','fa200000-0000-4000-8000-000000000004','Promoted replies remain reachable');
select is((select count(*) from public.notifications where comment_id='fa200000-0000-4000-8000-000000000002'),0::bigint,'Deleted comments remove notifications');
delete from auth.users where id='fa000000-0000-4000-8000-000000000003';
select is((select count(*) from public.notifications where actor_id='fa000000-0000-4000-8000-000000000003'),0::bigint,'Deleted actor removes notices');
delete from public.topics where id='fa100000-0000-4000-8000-000000000001';
select is((select count(*) from public.notifications where recipient_id in ('fa000000-0000-4000-8000-000000000001','fa000000-0000-4000-8000-000000000002')),0::bigint,'Topic cascade removes notifications');
select * from finish();
rollback;
