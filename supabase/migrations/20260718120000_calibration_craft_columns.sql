-- Sprint CRAFT-01 · Orchestrator — inyección del arsenal al runtime de calibración
--
-- 3 columnas nuevas en intel.calibration_sessions: ADITIVAS, NULLABLE, SIN BACKFILL.
-- No rompen ninguna sesión existente — las filas actuales quedan NULL y operan en modo
-- degradado (core+structure), ver api/_craftModules.ts §5.
--
-- SIN CHECK constraint en este sprint (§3 del brief): voice_type admite 4 valores pero 3
-- de los 4 perfiles aún no existen; un CHECK los bloquearía al crearlos. La validación de
-- dominio vive en el endpoint (api/calibrate.ts handleStart), no en la DB. NULL siempre
-- es válido (modo degradado).
--
-- Ejecutar UNA sentencia por llamada (el parser MCP de Supabase rompe con multi-statement).

ALTER TABLE intel.calibration_sessions ADD COLUMN voice_type text;
ALTER TABLE intel.calibration_sessions ADD COLUMN target_artifact jsonb;
ALTER TABLE intel.calibration_sessions ADD COLUMN psy_family text;

-- Dominios esperados (validados en el endpoint, no acá):
--   voice_type      : 'conversion' | 'editorial' | 'educative' | 'professional'
--   target_artifact : { "channel": "...", "format": "...", "length_hint": "...", "mode": "written"|"oral" }
--   psy_family      : 'CONVERSION' | 'COMMUNITY' | 'AUTHORITY' | 'BRIDGE'
