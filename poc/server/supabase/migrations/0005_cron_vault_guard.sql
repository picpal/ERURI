-- vault(worker_url, service_role_key)가 없으면 워커 호출을 건너뛴다.
-- 0002는 vault 등록 전부터 매분 net.http_post(url null) 오류를 냈다. 같은 이름으로 다시 등록하면 명령이 교체된다
select cron.schedule('worker-every-minute', '* * * * *', $$
  select net.http_post(
    url := s.url,
    headers := jsonb_build_object('Authorization', 'Bearer ' || s.key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 5000)
  from (select (select decrypted_secret from vault.decrypted_secrets where name = 'worker_url') as url,
               (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key') as key) s
  where s.url is not null and s.key is not null;
$$);
