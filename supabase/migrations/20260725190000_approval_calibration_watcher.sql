-- B4 · Fase 1 — la bandeja ve TODO (aprobadas + rechazadas por watcher)
--
-- El corpus registra AMBOS veredictos: el de Sam (verdict/criterion, ya existentes) y el
-- del watcher (primera opinión). Así cada muestra sirve para dos corpus a la vez:
--   · "qué es una buena pieza" (para el futuro aprobador)
--   · "dónde el watcher se equivoca" (para ajustar los gates MÁS ADELANTE — no en esta fase)
--
-- Columnas ADITIVAS, NULLABLE, sin backfill. Las filas existentes quedan NULL (no había
-- ninguna: el corpus nació vacío en el Brief 1).
--
-- GRANT: service_role ya tiene SELECT/INSERT/UPDATE sobre la tabla (Brief 1); las columnas
-- nuevas quedan cubiertas por el grant a nivel tabla.
--
-- Aditiva. NO toca el pipeline. Ejecutar una sentencia por llamada si se aplica vía MCP.

ALTER TABLE intel.approval_calibration ADD COLUMN IF NOT EXISTS watcher_result text;
ALTER TABLE intel.approval_calibration ADD COLUMN IF NOT EXISTS watcher_gate text;

-- Dominios esperados (validados a nivel de aplicación, no en la DB):
--   watcher_result : 'PASS' | 'REJECT' | NULL   (de assets.watcher.result)
--   watcher_gate   : gate que falló (de assets.watcher.failed_gate), o NULL si PASS
