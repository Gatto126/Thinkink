begin;
select plan(17);
insert into public.topics(id,title) values
 ('f5000000-0000-4000-8000-000000000001','predictivetestfixture Iran'),
 ('f5000000-0000-4000-8000-000000000002','predictivetestfixture War in Iran'),
 ('f5000000-0000-4000-8000-000000000003','predictivetestfixture Electric vehicles'),
 ('f5000000-0000-4000-8000-000000000004','predictivetestfixture Climate change'),
 ('f5000000-0000-4000-8000-000000000005','predictivetestfixture Cambiamenti climatici'),
 ('f5000000-0000-4000-8000-000000000006','predictivetestfixture Technology');
set local role anon;
select ok(exists(select 1 from public.search_topics('Iranian war') where id='f5000000-0000-4000-8000-000000000001'),'Longer morphological query suggests shorter existing topic');
select ok(exists(select 1 from public.search_topics('Iranian war') where id='f5000000-0000-4000-8000-000000000002'),'Reordered and inflected words suggest the fuller topic');
select ok(exists(select 1 from public.search_topics('war in iran') where id='f5000000-0000-4000-8000-000000000001'),'Partial related topic remains a suggestion');
select ok(exists(select 1 from public.search_topics('vehicle electric') where id='f5000000-0000-4000-8000-000000000003'),'Reordering and singular/plural work beyond the Iran example');
select ok(exists(select 1 from public.search_topics('changing climate') where id='f5000000-0000-4000-8000-000000000004'),'English word forms are recognized');
select ok(exists(select 1 from public.search_topics('cambiamento climatico') where id='f5000000-0000-4000-8000-000000000005'),'Italian word forms are recognized');
select ok(exists(select 1 from public.search_topics('technolgy') where id='f5000000-0000-4000-8000-000000000006'),'One missing character is tolerated');
select ok(exists(select 1 from public.search_topics('technoloxy') where id='f5000000-0000-4000-8000-000000000006'),'One mistyped character is tolerated');
select ok(exists(select 1 from public.search_topics('techno') where id='f5000000-0000-4000-8000-000000000006'),'Incomplete words predict existing topics');
select ok(exists(select 1 from public.search_topics('electric-vehicle') where id='f5000000-0000-4000-8000-000000000003'),'Punctuation separates meaningful terms');
select is(public.topic_word_score('iranian','iran'),70,'Reverse prefix recognizes a longer variant');
select is(public.topic_word_score('korean','korea'),70,'Spelling variants work without country-specific aliases');
select is(public.topic_word_score('art','earth'),0,'Short incidental substrings are not related terms');
select is(public.topic_word_score('tsneedleabsent','tsneedleiran'),0,'A long common fragment alone is insufficient');
select is(public.topic_word_score('iran','iraq'),50,'Fuzzy neighbors are suggestions only, not canonical identity');
select is(public.topic_word_score('50%','50X'),0,'Wildcard characters remain literal');
select ok(not exists(select 1 from public.search_topics('zzqjxvwk') where id::text like 'f5000000-%'),'Unrelated queries do not manufacture results');
select * from finish();
rollback;
