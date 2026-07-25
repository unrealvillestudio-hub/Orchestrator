# B4 · Fase 1 — Núcleo de calibración de aprobación (runbook)

**Estado:** código en rama `feat/b4-approval-calibration` (PR abierto, sin merge).
**Live aplicado por CC** (Sam autorizó "todo salvo el merge"): tabla + cron + EF. **Fecha:** 2026-07-25 · **Autor:** CC.

Instrumento que captura el criterio humano (SÍ/NO + prosa) atado al `piece_id`, como corpus de
entrenamiento para la futura aprobación automática. **NO publica nada.** El email y la bandeja son
andamio; lo que persiste es el corpus `intel.approval_calibration`.

---

## 1. Qué se construyó

| Pieza | Artefacto | Tipo |
|---|---|---|
| 1 | `intel.approval_calibration` (tabla del corpus) | migración `20260725120000_approval_calibration.sql` |
| 2 | `api/preview-render.ts` — renderiza el artefacto HTML → `unrlvl-media` (lazy, idempotente) | endpoint Node |
| 3 | `api/calibration-queue.ts` (GET) + `api/calibration-verdict.ts` (POST) | endpoints Node |
| 3 | `api/_calibrationShared.ts` — helpers compartidos (auth HS256, REST, HTML, diff) | módulo |
| 3bis | `src/services/calibrationInbox.ts` + `src/modules/iid/ApprovalCalibrationModule.tsx` + montaje en `App.tsx` | frontend |
| 4 | EF `iid-approval-digest` — despertador 7am ET (Resend) | `supabase/functions/iid-approval-digest/` |
| 5 | cron `iid-approval-digest-daily` (`0 11,12 * * *`) | migración `20260725120500_approval_digest_cron.sql` |

### Decisión de diseño clave (más simple y segura que el plan original)
- **Los endpoints NO usan RPCs SECURITY DEFINER.** PostgREST expone `public, intel, content`, así que
  leen/escriben directo con `Accept-Profile`/`Content-Profile` + service_role. El diff
  "awaiting_approval − corpus" se hace en JS. Cero superficie confused-deputy nueva.
- **El cron REUSA `intel.trigger_iid_agent('iid-approval-digest')`** (el patrón canónico ya existente).
  → **No se creó función SQL nueva, ni secreto en Vault, ni lockdown.** La EF valida el mismo
  `IID_CRON_SECRET` (env project-wide que ya usan content-watcher y 20+ EFs IID).

---

## 2. Estado live (verificado 2026-07-25)

- ✅ Tabla `intel.approval_calibration` creada. Grants `service_role = SELECT, INSERT, UPDATE`.
  `UNIQUE (piece_id)` + índices `(brand_id)`, `(verdict)`, `(created_at)`.
- ✅ EF `iid-approval-digest` desplegada (version 1, `verify_jwt:false`).
- ✅ Cron `iid-approval-digest-daily` activo, schedule `0 11,12 * * *`.
- ✅ Smoke test EF (vía `net.http_post` con `x-cron-secret` real + `{"force":true}`):
  `200 {"sent":false,"reason":"no_pending","total":0}` → auth OK, diff OK, no-email-si-vacío OK.

---

## 3. Pendiente para Sam (manual — CC no lo hace)

1. **Sender verificado en Resend (cuenta UNRLVL).** La EF envía con
   `from: "UNRLVL Calibración <no-reply@unrealvillestudio.com>"` y `RESEND_UNRLVL_KEY`. Si ese
   remitente/dominio NO está verificado en la cuenta UNRLVL de Resend, el envío dará 400. Opciones:
   verificar `unrealvillestudio.com` (o el subdominio) en Resend, **o** override sin redeploy seteando
   el env `DIGEST_FROM` de la EF a un remitente ya verificado. `RESEND_UNRLVL_KEY` ya está validada (200).
2. **(Opcional) Overrides de la EF por env** si hiciera falta: `DIGEST_TO` (default
   `content-approval@unrealvillestudio.com`), `DIGEST_FROM`, `ORCHESTRATOR_URL`.
3. **Merge del PR** + borrado de la rama. CC limpia su worktree al cerrar.
4. **Abrir el grifo de volumen** (Brief 2) para el e2e a escala. Hoy `content.content_pieces` tiene 0
   filas → la bandeja y el email operan correctamente pero vacíos hasta que el carril produzca piezas.

> Nota: NO hace falta setear `IID_CRON_SECRET` ni secreto nuevo — la EF reusa el que ya existe.

---

## 4. Verificación end-to-end (cuando haya piezas reales `awaiting_approval`)

1. **Email:** forzar la EF (7am NY real, o manual):
   ```sql
   select net.http_post(
     url := (select value from intel.iid_scheduler_config where key='supabase_url') || '/functions/v1/iid-approval-digest',
     headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from intel.iid_scheduler_config where key='iid_cron_secret')),
     body := '{"force":true}'::jsonb
   );
   ```
   Con >0 pendientes debe llegar a `content-approval@unrealvillestudio.com` con conteo + desglose +
   botón → `https://orchestrator-unrlvl.vercel.app?view=calibration`.
2. **Bandeja:** abrir Orchestrator → pestaña **Calibración** (o el deep-link `?view=calibration`).
   La pieza aparece con su artefacto embebido (marca + imagen + texto tal como saldría).
3. **Veredicto:** aprobar una (comentario opcional) / rechazar otra (criterio obligatorio).
4. **Corpus:** confirmar la fila:
   ```sql
   select piece_id, brand_id, verdict, criterion, evaluated_by, artifact_url, created_at
   from intel.approval_calibration order by created_at desc;
   ```
   Contexto completo copiado, `piece_id` único, y la pieza ya no aparece en la cola (re-listar).

---

## 5. Lo que esta fase NO hace
- No publica lo aprobado (fase posterior). No toca `content_pieces.status` ni `scheduled_posts`.
- No destila reglas por marca (lo hace Sam en chat leyendo el corpus).
- No genera volumen (Brief 2). No toca `lab_jobs`, `lab_configs` ni el flujo del pipeline.
