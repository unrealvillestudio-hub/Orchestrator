-- B4 · Fase 1 — Núcleo de calibración de aprobación
-- Tabla del CORPUS: veredictos humanos (SÍ/NO + criterio en prosa) atados al código
-- de cada pieza (piece_id). NO publica nada; solo captura para entrenar la futura
-- aprobación automática (loop Boids/Buckle). El vínculo
--   {piece_id ↔ contexto ↔ artifact_url ↔ verdict ↔ criterion}
-- es el activo que persiste cuando el email y la bandeja se jubilen.
--
-- Diseño:
--  · piece_id UNIQUE → una pieza se evalúa una vez (re-evaluar = UPDATE vía UPSERT).
--  · criterion nullable en DB (approved puede ir sin comentario); la obligatoriedad
--    cuando verdict='rejected' la impone la app (api/calibration-verdict.ts), no la DB.
--  · evaluated_by DEFAULT 'sam' → preparado para crecer (Ayra / otros evaluadores).
--  · Sin RLS/policies para anon|authenticated: la tabla se toca SOLO server-side con
--    service_role (los endpoints Node). GRANT explícito a service_role (learning
--    2026-07-25: verificar el grant, no asumir que se hereda).
--
-- NO toca lab_jobs, lab_configs ni el flujo del pipeline. Aditiva.
--
-- Ejecutar UNA sentencia por llamada si se aplica vía el MCP de Supabase
-- (el parser rompe con multi-statement; ver 20260718120000_calibration_craft_columns.sql).

CREATE TABLE IF NOT EXISTS intel.approval_calibration (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  piece_id        uuid NOT NULL,
  brand_id        text NOT NULL,
  voice           text,
  domain          text,
  platform        text,
  format          text,
  psycho_preset   text,
  audience_frame  text,
  artifact_url    text NOT NULL,
  verdict         text NOT NULL CHECK (verdict IN ('approved', 'rejected')),
  criterion       text,
  evaluated_by    text DEFAULT 'sam',
  created_at      timestamptz DEFAULT now()
);

-- piece_id es la clave del corpus: una fila por pieza (UPSERT re-evalúa).
CREATE UNIQUE INDEX IF NOT EXISTS approval_calibration_piece_id_key
  ON intel.approval_calibration (piece_id);

CREATE INDEX IF NOT EXISTS approval_calibration_brand_id_idx
  ON intel.approval_calibration (brand_id);

CREATE INDEX IF NOT EXISTS approval_calibration_verdict_idx
  ON intel.approval_calibration (verdict);

CREATE INDEX IF NOT EXISTS approval_calibration_created_at_idx
  ON intel.approval_calibration (created_at);

-- Los endpoints corren como service_role. GRANT explícito (no se asume herencia).
GRANT SELECT, INSERT, UPDATE ON intel.approval_calibration TO service_role;
