begin;
select plan(6);
insert into auth.users(id,email,raw_user_meta_data) values
('f4000000-0000-4000-8000-000000000001','card@example.test','{"username":"card_author"}');
insert into public.topics(id,title,created_at,created_by) values
('f4000000-0000-4000-8000-000000000010','Card test','2099-01-01','f4000000-0000-4000-8000-000000000001');
insert into public.topic_content(topic_id,summary,news_checked_at) values
('f4000000-0000-4000-8000-000000000010','{"paragraphs":[{"text":"First paragraph"},{"text":"Second paragraph"}],"generatedAt":"2099-01-02T00:00:00Z","editedAt":"2099-01-04T00:00:00Z"}','2099-01-03');
set local role anon;
select is((select creator_username from public.home_topics() where title='Card test'),'card_author','Public username is returned');
select is((select excerpt from public.home_topics() where title='Card test'),'First paragraph','Only first paragraph is returned');
select is((select updated_at from public.home_topics() where title='Card test'),'2099-01-04'::timestamptz,'Latest edit determines update time');
select throws_ok($$select created_by from public.topics$$,'42501',null,'Creator ID remains private');
reset role;
delete from auth.users where id='f4000000-0000-4000-8000-000000000001';
update public.topic_content set summary=null,news_checked_at=null where topic_id='f4000000-0000-4000-8000-000000000010';
set local role anon;
select is((select creator_username from public.home_topics() where title='Card test'),null::text,'Deleted author is not retained');
select is((select updated_at from public.home_topics() where title='Card test'),'2099-01-01'::timestamptz,'Unprepared topic uses creation date');
select * from finish();
rollback;
