begin;
select plan(30);
insert into auth.users(id,email,raw_user_meta_data) values
 ('f7000000-0000-4000-8000-000000000001','usersfixture_owner@example.test','{"username":"usersfixture_owner","isModerator":true}'),
 ('f7000000-0000-4000-8000-000000000002','usersfixture_other@example.test','{"username":"usersfixture_other"}'),
 ('f7000000-0000-4000-8000-000000000003','usersfixture_admin@example.test','{"username":"usersfixture_admin"}');
insert into public.moderators(user_id) values ('f7000000-0000-4000-8000-000000000003');
insert into public.topics(id,title,created_by) values
 ('f7100000-0000-4000-8000-000000000001','usersfixture owner topic','f7000000-0000-4000-8000-000000000001'),
 ('f7100000-0000-4000-8000-000000000002','usersfixture other topic','f7000000-0000-4000-8000-000000000002');
insert into public.comments(id,topic_id,body,author_id) values
 ('f7200000-0000-4000-8000-000000000001','f7100000-0000-4000-8000-000000000001','Other user in deleted topic','f7000000-0000-4000-8000-000000000002'),
 ('f7200000-0000-4000-8000-000000000002','f7100000-0000-4000-8000-000000000002','Deleted user in retained topic','f7000000-0000-4000-8000-000000000001');
insert into public.comments(id,topic_id,body,author_id,parent_id) values
 ('f7200000-0000-4000-8000-000000000003','f7100000-0000-4000-8000-000000000002','Retained reply','f7000000-0000-4000-8000-000000000002','f7200000-0000-4000-8000-000000000002');
set local role anon;
select throws_ok($$select public.moderation_users()$$,'42501','permission denied for function moderation_users','Anonymous user list denied');
select throws_ok($$select public.moderate_user('f7000000-0000-4000-8000-000000000001')$$,'42501','permission denied for function moderate_user','Anonymous user deletion denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.moderation_users()$$,'42501','Moderator access required','Ordinary users cannot enumerate accounts despite forged metadata');
select throws_ok($$select public.moderate_user('f7000000-0000-4000-8000-000000000002')$$,'42501','Moderator access required','Ordinary users cannot delete other accounts');
select set_config('request.jwt.claim.sub','f7000000-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(public.moderation_users('usersfixture')->'items'),3,'Admin sees registered accounts');
select is(public.moderation_users('USERSFIXTURE_OWNER')#>>'{items,0,email}','usersfixture_owner@example.test','Username search is case insensitive');
select is(public.moderation_users('usersfixture_other@example.test')#>>'{items,0,username}','usersfixture_other','Email search works');
select is(public.moderation_users('usersfixture_owner')#>>'{items,0,topicCount}','1','Topic count');
select is(public.moderation_users('usersfixture_owner')#>>'{items,0,commentCount}','1','Comment count');
select is(public.moderation_users('usersfixture_admin')#>>'{items,0,isCurrentUser}','true','Own account identified');
select is(public.moderation_users('usersfixture_admin')#>>'{items,0,isModerator}','true','Admin role identified');
select throws_ok($$select public.moderation_users('',-1)$$,'22023','Invalid filters','Invalid page rejected');
select throws_ok($$select public.moderate_user('f7000000-0000-4000-8000-000000000003')$$,'22023','Cannot delete your own account from moderation','Self deletion denied');
reset role;
create function pg_temp.reject_fixture_deletion() returns trigger language plpgsql as $$
begin raise exception 'Simulated account deletion failure'; end;
$$;
create trigger reject_fixture_deletion before delete on auth.users
  for each row execute function pg_temp.reject_fixture_deletion();
set local role authenticated;
select throws_ok($$select public.moderate_user('f7000000-0000-4000-8000-000000000001')$$,'P0001','Simulated account deletion failure','Deletion failure is reported');
select is(public.moderation_users('usersfixture_owner')#>>'{items,0,topicCount}','1','Failed account deletion rolls back topic deletion');
select is(public.moderation_users('usersfixture_owner')#>>'{items,0,commentCount}','1','Failed account deletion rolls back comment deletion');
reset role;
drop trigger reject_fixture_deletion on auth.users;
set local role authenticated;
select is(public.moderate_user('f7000000-0000-4000-8000-000000000001'),true,'Admin deletes user and content');
select is(jsonb_array_length(public.moderation_users('usersfixture_owner')->'items'),0,'User removed from list');
reset role;
select is((select count(*)::integer from auth.users where id='f7000000-0000-4000-8000-000000000001'),0,'Auth account removed');
select is((select count(*)::integer from public.profiles where id='f7000000-0000-4000-8000-000000000001'),0,'Profile removed');
select is((select count(*)::integer from public.topics where id='f7100000-0000-4000-8000-000000000001'),0,'Owned topic removed');
select is((select count(*)::integer from public.comments where id in ('f7200000-0000-4000-8000-000000000001','f7200000-0000-4000-8000-000000000002')),0,'Other comments on owned topics and own comments elsewhere removed');
select is((select count(*)::integer from public.comments where id='f7200000-0000-4000-8000-000000000003'),1,'Other users replies on retained topics preserved');
select is((select parent_id from public.comments where id='f7200000-0000-4000-8000-000000000003'),null::uuid,'Reply reference safely detached');
select is((select count(*)::integer from public.topics where id='f7100000-0000-4000-8000-000000000002'),1,'Unrelated topic retained');
insert into auth.users(id,email,raw_user_meta_data)
select gen_random_uuid(),'userspage_'||n||'@example.test',jsonb_build_object('username','userspage_'||n) from generate_series(1,52) n;
set local role authenticated;
select is(jsonb_array_length(public.moderation_users('userspage_')->'items'),50,'User list bounded to 50');
select is(public.moderation_users('userspage_')->>'hasMore','true','Next page advertised');
select is(jsonb_array_length(public.moderation_users('userspage_',50)->'items'),2,'Remaining users accessible');
select is(public.moderation_users('userspage_',50)->>'hasMore','false','Last page has no next page');
select throws_ok($$select public.moderate_user('f7000000-0000-4000-8000-000000000001')$$,'P0002','User unavailable','Missing user reported accurately');
select * from finish();
rollback;
