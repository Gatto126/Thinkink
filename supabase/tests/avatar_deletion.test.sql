begin;
select plan(15);
insert into auth.users(id,email,raw_user_meta_data) values
 ('f2000000-0000-4000-8000-000000000001','deletion-owner@example.test','{"username":"deletion_owner"}'),
 ('f2000000-0000-4000-8000-000000000002','deletion-other@example.test','{"username":"deletion_other"}');
insert into public.avatar_options(id,label,src,available) values ('retired-test','Retired','/avatars/retired-test.svg',false);
insert into public.topics(id,title,created_by) values ('f2000000-0000-4000-8000-000000000010','Retained discussion','f2000000-0000-4000-8000-000000000001');
insert into public.comments(id,topic_id,body,author_id) values
 ('f2000000-0000-4000-8000-000000000011','f2000000-0000-4000-8000-000000000010','A retained comment','f2000000-0000-4000-8000-000000000001'),
 ('f2000000-0000-4000-8000-000000000012','f2000000-0000-4000-8000-000000000010','Another voice','f2000000-0000-4000-8000-000000000002');
insert into auth.audit_log_entries(id,payload) values (gen_random_uuid(),'{"actor_id":"f2000000-0000-4000-8000-000000000001"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','f2000000-0000-4000-8000-000000000001',true);
select throws_ok($$update public.profiles set username='different'$$,'42501','permission denied for table profiles','Username is immutable');
select throws_ok($$update public.profiles set bio='different'$$,'42501','permission denied for table profiles','Biography is no longer editable');
select throws_ok($$update public.profiles set avatar_id='retired-test'$$,'42501',null,'Unavailable avatars cannot be selected');
select throws_ok($$insert into public.avatar_options(id,label,src) values ('uploaded','Uploaded','/avatars/uploaded.svg')$$,'42501','permission denied for table avatar_options','Users cannot add avatars');
select throws_ok($$select author_id from public.comments$$,'42501','permission denied for table comments','Private author identifiers are not public');
reset role;
delete from auth.users where id='f2000000-0000-4000-8000-000000000001';
select is((select count(*)::integer from public.profiles where id='f2000000-0000-4000-8000-000000000001'),0,'Personal profile removed');
select is((select count(*)::integer from auth.audit_log_entries where payload->>'actor_id'='f2000000-0000-4000-8000-000000000001'),0,'Linked audit data removed');
select is((select count(*)::integer from public.topics where id='f2000000-0000-4000-8000-000000000010'),1,'Topic survives deletion');
select is((select created_by from public.topics where id='f2000000-0000-4000-8000-000000000010'),null::uuid,'Topic attribution removed');
select is((select author_id from public.comments where id='f2000000-0000-4000-8000-000000000011'),null::uuid,'Comment attribution removed');
select is((select author_id from public.comments where id='f2000000-0000-4000-8000-000000000012'),'f2000000-0000-4000-8000-000000000002'::uuid,'Other authors are unaffected');
select is((select count(*)::integer from public.profiles where id='f2000000-0000-4000-8000-000000000002'),1,'Other account is unaffected');
set local role anon;
select is((select title from public.topics where id='f2000000-0000-4000-8000-000000000010'),'Retained discussion','Topic remains readable anonymously');
select is((select body from public.comments where id='f2000000-0000-4000-8000-000000000011'),'A retained comment','Comment remains readable anonymously');
select throws_ok($$select created_by from public.topics$$,'42501','permission denied for table topics','Creator identifiers are private');
select * from finish();
rollback;
