-- B4 · Fase 1 — Pieza 5: cron del email despertador (7am ET)
--
-- Reusa el patrón canónico intel.trigger_iid_agent(slug): SECURITY DEFINER que lee
-- supabase_url + iid_cron_secret de intel.iid_scheduler_config y hace net.http_post a
-- /functions/v1/<slug> con el header x-cron-secret. NO se crea función nueva ni secreto
-- nuevo: la EF iid-approval-digest valida ese mismo IID_CRON_SECRET (env project-wide).
--
-- DST: el cron corre a las 11:00 y 12:00 UTC. En EDT (verano, UTC-4) las 11:00 UTC son
-- las 7am NY; en EST (invierno, UTC-5) las 12:00 UTC son las 7am NY. La EF trae una guarda
-- "hora local America/New_York == 7" → actúa UNA sola vez por día en cualquier estación.
-- (Además, si hay 0 pendientes la EF no envía nada.)
--
-- Aditiva. NO toca el pipeline, lab_jobs ni lab_configs.

select cron.schedule(
  'iid-approval-digest-daily',
  '0 11,12 * * *',
  $$select intel.trigger_iid_agent('iid-approval-digest');$$
);
