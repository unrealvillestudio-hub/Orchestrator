-- UNRLVL Orchestrator — dual-mode pipeline + approval gate
-- Aditivo, no destructivo. Convive con job_type='copylab' (email sequences).
-- Schema: public.lab_jobs (no usar content.lab_jobs — schema no expuesto via PostgREST)

-- ── 1. Columnas nuevas ──────────────────────────────────────────────────────
ALTER TABLE public.lab_jobs
  ADD COLUMN IF NOT EXISTS parent_job_id    uuid REFERENCES public.lab_jobs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_payload jsonb,
  ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by      text,
  ADD COLUMN IF NOT EXISTS rejected_reason  text,
  ADD COLUMN IF NOT EXISTS decision_notes   text,
  ADD COLUMN IF NOT EXISTS failed_at_stage  text,
  ADD COLUMN IF NOT EXISTS error_msg        text,
  ADD COLUMN IF NOT EXISTS stage_outputs    jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS output_parsed    jsonb;

-- ── 2. Status check — añadir pending_approval / approved / rejected / failed
-- Drop & recreate para incluir los nuevos estados. Mantiene los originales del worker v2.1.
ALTER TABLE public.lab_jobs DROP CONSTRAINT IF EXISTS lab_jobs_status_check;
ALTER TABLE public.lab_jobs
  ADD CONSTRAINT lab_jobs_status_check
  CHECK (status IN (
    'pending',           -- estado original al insertar (worker v2.1 lo claimea)
    'queued',            -- nuevo: insertado por trigger-job antes de pg_net
    'processing',        -- claimed por worker
    'running',           -- pipeline activo (orchestrator)
    'completed',
    'failed',
    'error',
    'pending_approval',  -- nuevo: pipeline esperando decisión de Sam
    'approved',          -- nuevo: Sam aprobó, child publish job disparado
    'rejected'           -- nuevo: Sam rechazó, pipeline cancelado
  ));

-- ── 3. Índice parcial: cola humana ──────────────────────────────────────────
-- Claude lee SELECT * FROM lab_jobs WHERE status='pending_approval' ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_lab_jobs_pending_approval
  ON public.lab_jobs (created_at DESC)
  WHERE status = 'pending_approval';

-- ── 4. Índice para polling de jobs hijo (imagelab/videolab async) ───────────
CREATE INDEX IF NOT EXISTS idx_lab_jobs_parent
  ON public.lab_jobs (parent_job_id)
  WHERE parent_job_id IS NOT NULL;

-- ── 5. Comentarios para documentar el contrato ──────────────────────────────
COMMENT ON COLUMN public.lab_jobs.parent_job_id IS
  'Vincula jobs hijo (imagelab/videolab async, orchestrator_publish) con el job padre orchestrator.';
COMMENT ON COLUMN public.lab_jobs.approval_payload IS
  'Snapshot del contenido generado en stages 1-4. Estructura: {copy_by_platform, image_url, video_url, image_preview_url, stages_completed, brand_id, prompt}.';
COMMENT ON COLUMN public.lab_jobs.output_parsed IS
  'Resultado final estandarizado al cerrar pipeline. Incluye platform_post_ids, published_at, stages_detail.';
COMMENT ON COLUMN public.lab_jobs.stage_outputs IS
  'Buffer intermedio entre stages dentro de un mismo pipeline. No usado por job_type=copylab.';
COMMENT ON COLUMN public.lab_jobs.failed_at_stage IS
  'Identificador del stage que falló — copylab | imagelab | videolab | sociallab | meta. Null si status != failed.';
