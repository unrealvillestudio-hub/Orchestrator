-- CALIB-UI-01 — intel.pipeline_cutoffs: los cortes del flujo, en DATO, no en código
--
-- La bandeja de calibración necesita responder "¿esta pieza es del flujo corregido?"
-- sin que nadie reconstruya la cronología a mano. Ese cálculo necesita saber CUÁNDO
-- cambió el flujo. Esas fechas son INSTANCIA (cambian cada vez que se arregla algo),
-- no EJE: no pueden vivir en un `.ts`. Un arreglo futuro entra sembrando una fila acá,
-- sin tocar ni redeployar código.
--
--   effective_at : momento (UTC) desde el cual rige el corte.
--   label        : nombre humano del corte (lo que la tarjeta muestra).
--   scope        : ALCANCE del corte.
--                    NULL  → alcance de ECOSISTEMA: aplica a toda marca.
--                    texto → el `brand_id` al que el corte se limita.
--                  Se resuelve por comparación contra `content_pieces.brand_id`; no hay
--                  enumeración de marcas ni centinela de texto. Sembrar un corte de
--                  ecosistema es dejar `scope` en NULL — NO escribir la palabra
--                  "ecosistema", que el runtime leería como un brand_id inexistente y
--                  el corte no aplicaría a ninguna pieza.
--   notes        : contexto libre (PR, EF, versión que introdujo el corte).
--
-- Cómo lo lee el runtime (api/_calibrationShared.ts → generationOf):
--   cortes aplicables a una pieza = scope IS NULL OR scope = piece.brand_id
--   corte de referencia            = el aplicable con effective_at más alto
--   pieza `current`  si created_at >= corte de referencia
--   pieza `previous` si created_at <  corte de referencia
--   pieza `unknown`  si no hay ningún corte aplicable (tabla vacía o ausente)
-- La ausencia de la tabla NO rompe la bandeja: el endpoint degrada a `unknown`.
--
-- Esta migración crea la tabla VACÍA. La siembra de los cortes vigentes es una unidad
-- aparte (ver el cuerpo del PR). CC no aplica esta migración: la aplica Sam.
--
-- NO toca lab_jobs, lab_configs, Edge Functions ni el flujo del pipeline. Aditiva.
--
-- Ejecutar UNA sentencia por llamada si se aplica vía el MCP de Supabase
-- (el parser rompe con multi-statement; ver 20260718120000_calibration_craft_columns.sql).

CREATE TABLE IF NOT EXISTS intel.pipeline_cutoffs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label         text        NOT NULL,
  effective_at  timestamptz NOT NULL,
  scope         text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN intel.pipeline_cutoffs.scope IS
  'Alcance del corte. NULL = ecosistema (aplica a toda marca); texto = brand_id al que se limita. Nunca la palabra "ecosistema".';

-- Consulta del runtime: todos los cortes, ordenados por vigencia.
CREATE INDEX IF NOT EXISTS pipeline_cutoffs_effective_at_idx
  ON intel.pipeline_cutoffs (effective_at DESC);

-- service_role corre los endpoints Node. GRANT explícito (en este ecosistema el grant
-- NO se hereda automáticamente — learning 2026-07-25).
GRANT SELECT ON intel.pipeline_cutoffs TO service_role;
