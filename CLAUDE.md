# CLAUDE.md — Orchestrator
_Contexto persistente para Claude Code. No editar manualmente._

---

## ⚠️ GOBERNANZA CC — NIVEL ALTA COMPLEJIDAD (leer ANTES de tocar nada)

Antes de cualquier acción en este repositorio, Claude Code DEBE cargar y obedecer el protocolo central:
**`https://unrlvl-context.vercel.app/protocols/CC_PROTOCOL.md`** (cargar con `Vercel:web_fetch_vercel_url` o `curl`).

**Este repo es parte del pipeline de contenido — un error rompe el flujo de varias marcas. Reglas:**

1. **CONTEXT FILES NUNCA SE REEMPLAZAN.** Se actualizan preservando historia: lo nuevo al tope, lo anterior archivado debajo, nunca borrado. Aplica a todo `.json`/`.md` de contexto. Antes de commitear: verificar que el diff no BORRA historia.

2. **PUSH:** `unrlvl-context` → nunca push directo, nunca por CC (solo Sam vía GitHub Desktop). Este repo y demás repos de código → branch + PR, nunca merge propio. CC nunca mergea por su cuenta. CC limpia sus worktrees al cerrar un PR.

3. **VERIFICACIÓN REFORZADA POR COMPLEJIDAD:** cambios que afecten `lab_jobs`, `lab_configs`, Edge Functions, o el flujo del pipeline requieren mensaje de verificación EXPLÍCITO a Sam antes de commitear (objetivo, pasos, archivos, repos y EFs afectados), porque un error se propaga aguas abajo a CopyLab/ImageLab/Meta y a todas las marcas. Reportar al final con el formato de CC_PROTOCOL (incluida PRESERVACIÓN DE CONTEXTO).

Ante cualquier duda → preguntar a Sam, no asumir.

---

## Qué es este repo
El Orchestrator es el cerebro del pipeline de contenido UNRLVL. Recibe un `brand_id` + `prompt`, inserta un job en `public.lab_jobs`, y el trigger pg_net despierta a `lab-worker` EF que ejecuta el pipeline completo en Supabase.

**URL producción:** https://orchestrator-unrlvl.vercel.app  
**Vercel project:** prj_93AJfDiY1pcktG7b7fDStBqONYWy  
**Framework:** Vite + React (UI) + Vercel Edge Functions (API)  
**Versión actual:** v4.1

---

## Stack técnico

### API routes (verificado contra el código)
- **`api/trigger-job.ts`** (v4.1, Node runtime) — `POST /api/trigger-job` — valida input, INSERT en `public.lab_jobs` vía REST (`Prefer: return=representation`), retorna 202 `{ job_id, status: 'queued' }`. `normalizeSupabaseUrl()` tolera 3 formatos de `SUPABASE_URL`. Auth opcional vía header `x-trigger-secret` (si `TRIGGER_SECRET` está set).
- **`api/approve-job.ts`** (v3.1, **Node runtime** — migrado de Edge porque el Edge bundle no capturaba las env vars de Supabase → 401) — **dual-mode**:
  - `GET ?token=&action=approve|reject` → flujo legacy HTML (email approvals), delega a la EF `approve-piece`.
  - `POST { job_id, decision, notes?, approved_by? }` → flujo Claude/Ayra. UPDATE del job padre; si `approved`, **INSERT de un job hijo `orchestrator_publish`** (parent_job_id + approval_payload) que despierta a lab-worker para Stage 5+6. **La publicación a Meta NO ocurre aquí** — ocurre en lab-worker (EF). Distingue errores: `env_missing` / `supabase_error` / `job_not_found` / `invalid_state`.
- **`api/interpret-intent.ts`** — `POST /api/interpret-intent` — Claude haiku interpreta intent de Sam en lenguaje natural.

### Variables de entorno (Vercel)
```
SUPABASE_URL                 ← https://amlvyycfepwhiindxgzw.supabase.co
SUPABASE_SERVICE_ROLE_KEY    ← service_role key
ANTHROPIC_API_KEY            ← Para interpret-intent (haiku)
TRIGGER_SECRET               ← Opcional — auth header x-trigger-secret
```

### Supabase (proyecto amlvyycfepwhiindxgzw)
- **`public.lab_jobs`** — tabla destino. INSERT aquí despierta lab-worker vía pg_net trigger
- **`public.lab_configs`** — registro dinámico de endpoints de labs (Orchestrator la lee para descubrir labs — NO hardcoded)
- **`content.orchestrator_jobs`** — jobs del Orchestrator UI

---

## Flujo completo del pipeline

```
1. Sam → POST /api/trigger-job { brand_id, prompt, job_type, language, canal, ... }
2. trigger-job.ts → INSERT public.lab_jobs (status: 'queued')
3. pg_net trigger → despierta lab-worker EF en Supabase
4. lab-worker EF:
   a. Fetch brand_context desde brand_cache_snapshots
   b. POST CopyLab /api/execute (literal o sync según job_type)
   c. POST ImageLab /api/execute (con preset injection via imagelab_presets)
   d. Upload imagen → Supabase Storage (unrlvl-media bucket)
   e. UPDATE lab_jobs (status: 'pending_approval', approval_payload)
5. Sam aprueba en Orchestrator UI o vía Claude → POST /api/approve-job (Node runtime)
6. approve-job UPDATE job padre → INSERT job hijo 'orchestrator_publish' → pg_net despierta lab-worker → lab-worker publica vía Meta MCP (ig_create_container + ig_publish_container + fb_publish_post)
7. UPDATE lab_jobs (status: 'completed', output_parsed)
```

---

## Parámetros de trigger-job

```typescript
{
  brand_id:     string,              // REQUERIDO
  prompt:       string,              // REQUERIDO
  platforms?:   string[],            // default: ['INSTAGRAM', 'FACEBOOK']
  aspect_ratio?: string,             // default: '4:5' (lab-worker mapea a Vertex ratios)
  auto_publish?: boolean,            // default: false (true salta approval gate)
  job_type?:    'content' | 'teaser' | 'announcement',  // default: 'content'
  language?:    'EN' | 'ES' | 'EN+ES',  // default: 'EN'
  canal?:        string,             // default: 'INSTAGRAM_FEED' (UPPERCASE)
}
```

**Aspect ratio mapping** (ocurre en lab-worker, no aquí):
- `4:5` → `3:4` (Instagram feed estándar)
- `5:4` → `4:3`
- otros → `1:1`

**Job types:**
- `content` → CopyLab interpretativo + ImageLab + publicación
- `teaser` → CopyLab literal mode (prompt = copy inamovible, solo caption + hashtags)
- `announcement` → idéntico a teaser

**Language:**
- `EN` → inglés
- `ES` → español  
- `EN+ES` → bilingual (literal mode genera ambas versiones)

---

## Lab discovery dinámico
El Orchestrator NO tiene labs hardcodeados. Lee `public.lab_configs` para descubrir endpoints:
```sql
SELECT lab_id, endpoint_url, active FROM lab_configs WHERE active = true
```
Esto es crítico — si `lab_configs` está vacía o down, el pipeline falla silenciosamente.

---

## Estados de lab_jobs
| Status | Descripción |
|---|---|
| `queued` | INSERT inicial, esperando lab-worker |
| `processing` | lab-worker en ejecución |
| `pending_approval` | Pipeline completado, esperando aprobación de Sam |
| `completed` | Publicado en Meta |
| `failed` | Error — ver `error_msg` + `failed_at_stage` |
| `rejected` | Sam rechazó — ver `rejected_reason` |

> ⚠️ **Pendiente:** `lab_jobs.status` CHECK constraint no incluye `'published'` — fix pendiente Sprint 0

---

## Estructura del repo
```
api/
  trigger-job.ts        ← INSERT lab_jobs + 202 inmediato
  approve-job.ts        ← Approval gate → Meta MCP publish
  interpret-intent.ts   ← Claude haiku intent parser
src/
  modules/
    executor/FlowExecutorModule.tsx  ← UI del pipeline (editor visual)
    hub/HubModule.tsx                ← Dashboard principal
    intel/EcosystemIntelModule.tsx   ← Vista del ecosistema
    planner/FlowPlannerModule.tsx    ← Planificador de flujos
    monitor/JobMonitorModule.tsx     ← Monitor de jobs
  services/
    orchestratorEngine.ts            ← Lógica del motor
    sequenceBridge.ts                ← Bridge secuencias
  config/
    brands.ts           ← Brands config UI
    labs.ts             ← Labs config UI
    humanizeConfig.ts   ← Humanize profiles config
supabase/
  migrations/           ← Migraciones SQL
PENDING_FIXES.md        ← Bugs y fixes pendientes documentados
```

---

## Conexiones con el ecosistema
- **Escribe en:** `public.lab_jobs` (trigger pg_net → lab-worker)
- **Lee de:** `public.lab_configs` (discovery dinámico), `content.orchestrator_jobs`
- **Llama a:** Claude API haiku (interpret-intent)
- **Downstream:** lab-worker EF → CopyLab + ImageLab → Meta MCP
- **Approval gate:** Sam aprueba → `api/approve-job` → Meta MCP publica

---

## Reglas de trabajo
1. **`normalizeSupabaseUrl()`** — ya implementado en `trigger-job.ts`. Siempre mantener.
2. **No hardcodear lab endpoints** — siempre vía `lab_configs` tabla
3. `trigger-job` retorna 202 inmediato — el pipeline es 100% async desde ese punto
4. Al agregar un nuevo `job_type`, actualizarlo también en `lab-worker` EF y en `CopyLab`
5. `canal` siempre UPPERCASE cuando llega a ImageLab (ya normalizado en trigger-job)

---

## Estado actual (2026-05-29)
- ✅ OPERACIONAL — pipeline end-to-end funcionando
- ✅ Primer post publicado: UnrealvilleStudio IG + FB (2026-05-29)
- ✅ v4.1 — `TriggerBody.canal` + `TriggerBody.language` + `normalizeSupabaseUrl`
- ⏳ `lab_jobs.status` CHECK constraint — agregar `'published'` (fix pendiente)
- ⏳ meta_accounts NeuroneSCF — sin esto, pipeline no publica para NSCF
