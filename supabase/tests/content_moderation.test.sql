begin;
select plan(24);
insert into auth.users(id,email,raw_user_meta_data) values
 ('f6000000-0000-4000-8000-000000000001','owner-moderation@example.test','{"username":"modfixture_owner","isModerator":true}'),
 ('f6000000-0000-4000-8000-000000000002','other-moderation@example.test','{"username":"modfixture_other"}'),
 ('f6000000-0000-4000-8000-000000000003','admin-moderation@example.test','{"username":"modfixture_admin"}');
insert into public.moderators(user_id) values ('f6000000-0000-4000-8000-000000000003');
insert into public.topics(id,title,created_by) values
 ('f6100000-0000-4000-8000-000000000001','modfixture owner topic','f6000000-0000-4000-8000-000000000001'),
 ('f6100000-0000-4000-8000-000000000002','modfixture other topic','f6000000-0000-4000-8000-000000000002');
insert into public.comments(id,topic_id,body,author_id) values
 ('f6200000-0000-4000-8000-000000000001','f6100000-0000-4000-8000-000000000001','Owner comment','f6000000-0000-4000-8000-000000000001'),
 ('f6200000-0000-4000-8000-000000000002','f6100000-0000-4000-8000-000000000001','Someone else replied','f6000000-0000-4000-8000-000000000002'),
 ('f6200000-0000-4000-8000-000000000003','f6100000-0000-4000-8000-000000000002','Moderator can remove me','f6000000-0000-4000-8000-000000000002');
set local role anon;
select throws_ok($$select public.delete_topic('f6100000-0000-4000-8000-000000000001')$$,'42501','permission denied for function delete_topic','Anonymous deletion denied');
select throws_ok($$select public.owned_topics()$$,'42501','permission denied for function owned_topics','Anonymous owner listing denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000001',true);
select is(public.is_moderator(),false,'Editable metadata does not grant moderator rights');
select is(jsonb_array_length(public.owned_topics()->'items'),1,'Owner list only includes own topics');
select is(public.owned_topics()#>>'{items,0,id}','f6100000-0000-4000-8000-000000000001','Owner sees the correct card');
select ok(not (public.owned_topics()#>'{items,0}' ? 'created_by'),'Owner list does not leak private author IDs');
select throws_ok($$insert into public.moderators(user_id) values ('f6000000-0000-4000-8000-000000000001')$$,'42501','permission denied for table moderators','Users cannot promote themselves');
select throws_ok($$select public.moderation_list('topics')$$,'42501','Moderator access required','Dashboard denied for regular users');
select throws_ok($$select public.moderate_comment('f6200000-0000-4000-8000-000000000003')$$,'42501','Moderator access required','Single comment moderation denied for regular users');
select throws_ok($$select public.delete_topic('f6100000-0000-4000-8000-000000000002')$$,'42501','Topic unavailable or deletion not allowed','Cannot delete another user topic');
select is(public.delete_topic('f6100000-0000-4000-8000-000000000001'),true,'Owner deletes own topic');
select is((select count(*)::integer from public.comments where topic_id='f6100000-0000-4000-8000-000000000001'),0,'All comments cascade, including other authors');
select is((select count(*)::integer from public.comments where topic_id='f6100000-0000-4000-8000-000000000002'),1,'Unrelated comments retained');
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000003',true);
select is(public.is_moderator(),true,'Provisioned moderator recognized');
select is(jsonb_array_length(public.moderation_list('topics','modfixture')->'items'),1,'Moderator sees other users topics');
select is(jsonb_array_length(public.moderation_list('comments','modfixture')->'items'),1,'Moderator can find comments by topic title');
select is(public.moderate_comment('f6200000-0000-4000-8000-000000000003'),true,'Moderator removes a single comment');
select is((select count(*)::integer from public.topics where id='f6100000-0000-4000-8000-000000000002'),1,'Single comment deletion preserves topic');
select is(public.delete_topic('f6100000-0000-4000-8000-000000000002'),true,'Moderator deletes another user topic');
select is(jsonb_array_length(public.moderation_list('topics','modfixture')->'items'),0,'Deleted content disappears from dashboard');
reset role;
insert into public.topics(title,created_by)
select 'modfixture pagination ' || n, 'f6000000-0000-4000-8000-000000000001'::uuid from generate_series(1,52) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','f6000000-0000-4000-8000-000000000001',true);
select is(jsonb_array_length(public.owned_topics()->'items'),50,'Owner cards are bounded per page');
select is(public.owned_topics()->>'hasMore','true','Next page is advertised');
select is(jsonb_array_length(public.owned_topics(50)->'items'),2,'All remaining own topics are accessible');
select is(public.owned_topics(50)->>'hasMore','false','Last page has no next page');
select * from finish();
rollback;
