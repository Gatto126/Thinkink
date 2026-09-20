begin;
select plan(11);
insert into auth.users (id, email, raw_user_meta_data) values
 ('f1000000-0000-4000-8000-000000000001', 'rls-one@example.test', '{"username":"rls_one_test"}'),
 ('f1000000-0000-4000-8000-000000000002', 'rls-two@example.test', '{"username":"rls_two_test"}');
select is((select count(*)::integer from public.profiles where username in ('rls_one_test','rls_two_test')), 2, 'Auth trigger creates profiles');
set local role anon;
select throws_ok('select * from public.profiles', '42501', 'permission denied for table profiles', 'Anonymous reads denied');
select throws_ok($$insert into public.profiles(id,username) values ('f1000000-0000-4000-8000-000000000003','anon_test')$$, '42501', 'permission denied for table profiles', 'Anonymous inserts denied');
select throws_ok($$update public.profiles set bio='anonymous'$$, '42501', 'permission denied for table profiles', 'Anonymous updates denied');
select throws_ok('delete from public.profiles', '42501', 'permission denied for table profiles', 'Anonymous deletes denied');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f1000000-0000-4000-8000-000000000001', true);
select is((select count(*)::integer from public.profiles), 1, 'Users see only their profile');
update public.profiles set avatar_id='iris' where id='f1000000-0000-4000-8000-000000000001';
select is((select avatar_id from public.profiles), 'iris', 'Owner can edit profile');
with updated as (update public.profiles set avatar_id='orbit' where id='f1000000-0000-4000-8000-000000000002' returning id)
select is((select count(*)::integer from updated), 0, 'Another profile cannot be changed');
select throws_ok($$update public.profiles set id='f1000000-0000-4000-8000-000000000002'$$, '42501', 'permission denied for table profiles', 'Ownership cannot be changed');
select throws_ok($$insert into public.profiles(id,username) values ('f1000000-0000-4000-8000-000000000003','injected_test')$$, '42501', 'permission denied for table profiles', 'Profiles cannot be created directly');
select throws_ok('delete from public.profiles', '42501', 'permission denied for table profiles', 'Users cannot delete profiles directly');
select * from finish();
rollback;
