-- 워커를 매분 호출한다. URL·키는 vault(worker_url, service_role_key)에서 읽는다(마이그레이션에 값 없음)
select cron.schedule('worker-every-minute', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='worker_url'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key'), 'Content-Type','application/json'),
    body := '{}'::jsonb, timeout_milliseconds := 5000);
$$);
