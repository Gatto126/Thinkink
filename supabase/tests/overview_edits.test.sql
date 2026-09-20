begin;
select plan(15);
insert into auth.users(id,email,raw_user_meta_data) values
 ('e6000000-0000-4000-8000-000000000001','overview-owner@example.test','{"username":"overview_owner"}'),
 ('e6000000-0000-4000-8000-000000000002','overview-admin@example.test','{"username":"overview_admin"}');
insert into public.moderators(user_id) values ('e6000000-0000-4000-8000-000000000002');
insert into public.topics(id,title,created_by) values ('e6100000-0000-4000-8000-000000000001','Overview edit fixture','e6000000-0000-4000-8000-000000000001');
insert into public.topic_content(topic_id,summary,model,input_hash,status) values (
 'e6100000-0000-4000-8000-000000000001',
 '{"id":"e6200000-0000-4000-8000-000000000001","headline":"Original title","text":"Original text","paragraphs":[{"text":"Original text","sourceIds":["source1"]}],"generatedAt":"2026-09-20T10:00:00.000Z","sources":[{"id":"source1","title":"Original source"}]}',
 'original-model:free','immutable-input','ready');
set local role anon;
select throws_ok($$select public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'Changed','[{"text":"Changed","sourceIds":[]}]')$$,'42501',null,'Anonymous edits denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','e6000000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'Changed','[{"text":"Changed","sourceIds":[]}]')$$,'42501','Moderator access required','Topic owner cannot edit AI content');
select set_config('request.jwt.claim.sub','e6000000-0000-4000-8000-000000000002',true);
select throws_ok($$update public.topic_content set summary='{}'$$,'42501',null,'Admin cannot bypass RPC with a direct table update');
select throws_ok($$select public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'','[{"text":"Changed","sourceIds":[]}]')$$,'22023',null,'Blank title rejected');
select throws_ok($$select public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'Changed','[{"text":"Changed","sourceIds":["invented"]}]')$$,'22023',null,'Unknown citations rejected');
select is(public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'Edited title','[{"text":"Edited text","sourceIds":["source1"]}]')->>'revision','1','Admin edit succeeds with new revision');
select is((select summary->>'headline' from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'Edited title','Edited text persists');
select ok((select summary->>'editedAt' is not null from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'Public attribution available');
select throws_ok($$select public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',0,'Stale edit','[{"text":"Stale","sourceIds":[]}]')$$,'40001','Overview changed','Concurrent stale edit rejected');
select is(public.edit_topic_overview('e6100000-0000-4000-8000-000000000001',1,'Second edit','[{"text":"Second text","sourceIds":[]}]')->>'revision','2','Subsequent edit succeeds');
select throws_ok($$select original_summary from public.topic_content$$,'42501',null,'Original audit copy remains private');
reset role;
select is((select original_summary->>'headline' from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'Original title','First AI original survives repeated edits');
select is((select model from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'original-model:free','Generating model preserved');
select is((select input_hash from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'immutable-input','Generation provenance preserved');
select is((select summary#>>'{sources,0,title}' from public.topic_content where topic_id='e6100000-0000-4000-8000-000000000001'),'Original source','Sources preserved');
select * from finish();
rollback;
