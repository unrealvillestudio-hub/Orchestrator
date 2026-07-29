-- B4 · Fase 1 — códigos de regla en el corpus
--
-- El corpus ya guarda la primera opinión del watcher a nivel de GATE (watcher_result,
-- watcher_gate — migración 20260725190000). Falta el nivel de REGLA: qué códigos
-- concretos dispararon y contra cuántas reglas enumeradas se juzgó la pieza. Sin esto,
-- cada muestra registra "rechazada en hard_rules" sin decir CUÁL regla — y la etiqueta
-- no se recupera salvo re-etiquetando (paso irreversible).
--
--   watcher_rules           : códigos bloqueantes del gate que falló
--                             (de assets.watcher.failed_rules). El activo del corpus.
--   watcher_rules_evaluated : contra cuántas reglas enumeradas se juzgó la pieza
--                             (de assets.watcher.rules_evaluated).
--
-- Por qué DESNORMALIZAR (copiar) en vez de JOIN contra content_pieces: content_pieces se
-- limpia periódicamente y el corpus tiene que sobrevivir a esas limpiezas. Es la misma
-- razón por la que watcher_gate ya vive aquí y no se resuelve por JOIN.
--
-- Columnas ADITIVAS, NULLABLE, SIN DEFAULT (un default inventaría datos). Las filas
-- existentes quedan NULL. NULL y array vacío NO son lo mismo:
--   NULL  = no se registró (pieza pre-v56; la app guarda NULL cuando el campo está ausente)
--   {}    = se registró y no disparó ninguna regla
-- Esa distinción la preserva la ruta de escritura (api/calibration-verdict.ts); la DB solo
-- debe permitir ambos, por eso nullable y sin default.
--
-- GRANT: explícito a service_role. En este ecosistema el grant NO se hereda automáticamente
-- (learning 2026-07-25); aunque el grant a nivel tabla ya cubre columnas nuevas, se re-emite
-- por seguridad (idempotente).
--
-- NO toca lab_jobs, lab_configs, Edge Functions ni el flujo del pipeline. Aditiva.
--
-- Ejecutar UNA sentencia por llamada si se aplica vía el MCP de Supabase
-- (el parser rompe con multi-statement; ver 20260718120000_calibration_craft_columns.sql).

ALTER TABLE intel.approval_calibration ADD COLUMN IF NOT EXISTS watcher_rules text[];

ALTER TABLE intel.approval_calibration ADD COLUMN IF NOT EXISTS watcher_rules_evaluated int;

-- service_role corre los endpoints Node. GRANT explícito (no se asume herencia).
GRANT SELECT, INSERT, UPDATE ON intel.approval_calibration TO service_role;
