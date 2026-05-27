# PENDING_FIXES — UNRLVL Orchestrator

Estos fixes **no se aplican en este repo**. Viven en repos separados (`ImageLab`,
`VideoLab`, `SocialLab`) y deben ejecutarse en otra sesión de Claude Code
apuntando a esos worktrees.

> **2026-05-27 — Estado del smoke test end-to-end (modo API):**
> - ✅ Stage 1 PromptBuilder (lab-worker EF v3.0)
> - ✅ Stage 2 CopyLab `/api/execute` — OK
> - ❌ Stage 3 ImageLab `/api/execute` — **FUNCTION_INVOCATION_TIMEOUT >300s**
>   (ver §3 más abajo)
> - ✅ Approval Gate — escribe `pending_approval` con `approval_payload`
> - ✅ POST /api/approve-job — endpoint del Orchestrator OK (tras commit `cd21193`)
> - ❌ Stage 5 SocialLab `/api/execute` — **HANG >300s** (ver §0 más abajo)
> - ❌ Stage 6 Meta MCP `/api/publish` — **HANG igual** (mismo bug raíz)
>
> Bloqueador único para flujo end-to-end: §0 y §3 de este documento. Una vez
> deployados esos fixes, el pipeline completo (copy → imagen → approve →
> publish IG+FB) debe pasar sin tocar nada más en Orchestrator.

---

## 0) SocialLab — env vars VITE_* no existen en server (HANG /api/execute, /api/publish)

### Síntoma
POST a `https://social-lab-flame.vercel.app/api/execute` y
`/api/publish` cuelga indefinidamente (>20s curl timeout local, >300s en Vercel
function — termina con `FUNCTION_INVOCATION_TIMEOUT`). Mismo síntoma para
ambos endpoints.

### Causa raíz
Ambos archivos leen Supabase con env vars que NO existen en runtime serverless:

```typescript
// api/execute.ts (líneas 11-12) y api/publish.ts (líneas 23-24)
const SB_URL = () => process.env.VITE_SUPABASE_URL ?? '';
const SB_KEY = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';
```

El prefijo `VITE_` es **solo para build-time de Vite (cliente browser)**.
En Vercel Functions (Node serverless) esas variables NO se inyectan a
`process.env`. Por lo tanto:

- `SB_URL()` devuelve `''`
- `fetch('/rest/v1/...', {...})` → URL relativa → **Node 18 fetch cuelga
  indefinidamente** intentando resolver el host vacío (no aborta limpio sin
  AbortController)
- Vercel function timeout `maxDuration: 300` → 504 FUNCTION_INVOCATION_TIMEOUT

### Fix — qué hacer

**Repo:** `unrealvillestudio-hub/SocialLab`

1. **`api/execute.ts`** y **`api/publish.ts`** — reemplazar el prefijo VITE
   por el estándar serverless. Las env vars correctas que Orchestrator y
   trigger-job ya usan son:
   - `SUPABASE_URL` (URL completa con `https://`)
   - `SUPABASE_SERVICE_ROLE_KEY` (service role, bypass RLS)

   ```typescript
   // ANTES (roto)
   const SB_URL = () => process.env.VITE_SUPABASE_URL ?? '';
   const SB_KEY = () => process.env.VITE_SUPABASE_ANON_KEY ?? '';

   // DESPUÉS (correcto)
   const SB_URL = () => process.env.SUPABASE_URL ?? '';
   const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY
                     ?? process.env.SUPABASE_ANON_KEY  // fallback si solo anon disponible
                     ?? '';
   ```

2. **Añadir defensa contra env vars vacías** al inicio del handler:

   ```typescript
   if (!SB_URL() || !SB_KEY()) {
     return new Response(JSON.stringify({
       error: 'env_missing',
       missing: [!SB_URL() && 'SUPABASE_URL', !SB_KEY() && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean),
     }), { status: 500, headers: CORS });
   }
   ```

3. **Añadir AbortController timeout** a TODOS los `fetch` (`sb`, `sbInsert`,
   `sbGet`, `sbUpdate`, `adaptForPlatform` que llama Anthropic, llamadas a
   Meta MCP). Sin esto, cualquier red lenta cuelga la function.

   ```typescript
   const ctrl = new AbortController();
   const t = setTimeout(() => ctrl.abort(), 8_000);
   const res = await fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
   ```

4. **Configurar las env vars en Vercel dashboard** del proyecto `social-lab`:
   - `SUPABASE_URL` (production + preview + development)
   - `SUPABASE_SERVICE_ROLE_KEY`
   - Quitar las `VITE_SUPABASE_*` para que no causen confusión (o
     dejarlas marcadas solo para client-side si el repo tiene SPA).

### Smoke test post-fix
```bash
# Después del deploy:
curl -X POST https://social-lab-flame.vercel.app/api/execute \
  -H "Content-Type: application/json" \
  -d '{"brandId":"UnrealvilleStudio","stage":{"labId":"sociallab","label":"smoke","description":"test","order":1},"params":{"platforms":["INSTAGRAM"]},"previousOutputs":{"copylab":"test copy"}}'
# Esperado: response en <60s con scheduled_posts insertado
```

---

## 1) ImageLab UI — "API Key must be set when running in a browser"

### Síntoma
La UI standalone de ImageLab (la SPA `src/`) llama directamente a Google
Generative AI desde el browser. El SDK Gemini lanza el error:

```
Error: API key must be set when running in a browser.
```

### Causa
El SDK `@google/generative-ai` o `@google/genai` está siendo instanciado en el
cliente con la API key. Gemini bloquea ese patrón por motivos de seguridad.

### Fix — qué hacer

**Repo:** `ImageLab` (Vercel deploy: `imagelab-…vercel.app` o similar)

1. **Localizar la llamada cliente-side a Gemini.** Patrones a buscar:
   ```
   import { GoogleGenerativeAI } from '@google/generative-ai'
   import { GoogleGenAI } from '@google/genai'
   new GoogleGenerativeAI(
   new GoogleGenAI(
   import.meta.env.VITE_GEMINI_API_KEY
   import.meta.env.VITE_GOOGLE_API_KEY
   ```
   Probablemente está en `src/` (componente React) o en algún `lib/gemini.ts`
   client-side.

2. **Verificar que `api/execute` (o `api/execute.ts`) ya hace la llamada
   server-side a Gemini con `process.env.GEMINI_API_KEY` (o equivalente).** Si
   no existe esa ruta, créala — debe aceptar el mismo payload que actualmente
   espera el browser y delegar a Gemini con la key del servidor.

3. **Reemplazar la llamada directa por `fetch('/api/execute', …)`** desde el
   componente que actualmente instancia el SDK Gemini:

   ```ts
   // ANTES
   const ai = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
   const result = await ai.models.generateContent({ … });

   // DESPUÉS
   const res = await fetch('/api/execute', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ prompt, brandId, params /* etc */ }),
   });
   if (!res.ok) throw new Error(`ImageLab ${res.status}: ${await res.text()}`);
   const data = await res.json(); // { image_data_url, output, ... }
   ```

4. **Eliminar el env var `VITE_GEMINI_API_KEY`** del entorno de Vercel (settings
   → environment variables) y de `.env.example`. La key Gemini ahora solo vive
   server-side como `GEMINI_API_KEY` (o nombre equivalente que use
   `api/execute`).

5. **Smoke test:** abrir el deploy en el browser, ejecutar una generación de
   imagen estándar, confirmar que no aparece el error y la imagen se devuelve.

### Por qué no se hace aquí
El repo `Orchestrator` no contiene el código de ImageLab. Cualquier edición a
ese fix requiere ese worktree.

---

## 3) ImageLab — `/api/execute` FUNCTION_INVOCATION_TIMEOUT

### Síntoma
POST a `https://image-lab-unrlvl.vercel.app/api/execute` (o el deploy
equivalente) tarda >300s y termina con `FUNCTION_INVOCATION_TIMEOUT`. Log de
Vercel solo muestra `WARN: default export return...` sin status code — la
function no responde nunca.

### Causa raíz probable
Misma clase de bug que SocialLab (§0): env vars con prefijo `VITE_` y/o
fetch sin AbortController a Gemini API. El smoke test del 2026-05-27 confirmó
timeout de 343s (más del maxDuration=300 declarado).

### Fix — qué hacer

**Repo:** `unrealvillestudio-hub/ImageLab`

1. **Verificar `api/execute.ts`**:
   - Si lee env vars con prefijo VITE_, cambiar como en §0.
   - Si llama Gemini con SDK síncrono sin timeout, envolver en AbortController
     (timeout 250s — debe ser < maxDuration=300 para que la function termine
     limpio).

2. **Considerar usar `maxDuration: 800`** (límite Vercel Pro) si el
   modelo de Gemini realmente tarda >300s para imágenes complejas. Pero
   primero verificar con un prompt simple cuánto tarda realmente — el timeout
   actual sugiere que cuelga, no que tarda.

3. **Logging**: añadir `console.log` después de cada paso (instantiate SDK,
   send request, receive response, write to storage) para que cuando vuelva
   a colgar, los logs de Vercel digan dónde se atascó.

### Smoke test post-fix
```bash
curl -X POST https://image-lab-unrlvl.vercel.app/api/execute \
  -H "Content-Type: application/json" \
  -d '{"brandId":"UnrealvilleStudio","stage":{"labId":"imagelab","label":"smoke","description":"minimal gold/black post","order":1},"params":{"aspect_ratio":"4:5"},"previousOutputs":{}}' \
  --max-time 200
# Esperado: response en <180s con image_data_url base64
```

### Ya documentado en §1 abajo
El bug "API Key must be set when running in a browser" en la **UI** de
ImageLab (`src/`) es un problema separado, NO bloquea el pipeline API. El
pipeline API usa `/api/execute` server-side. Sin embargo, el fix de §1 también
es necesario para que la UI funcione.

---

## 2) VideoLab UI — verificar mismo patrón y aplicar si aplica

### Tarea
**Repo:** `VideoLab` (Vercel deploy del lab de video).

1. **Verificar si VideoLab tiene el mismo problema.** Patrones a buscar
   (cubren los SDKs comunes de generación de video):
   ```
   import { GoogleGenerativeAI } from '@google/generative-ai'
   import { GoogleGenAI } from '@google/genai'
   import Replicate from 'replicate'
   import { fal } from '@fal-ai/client'
   import.meta.env.VITE_*_API_KEY
   ```

2. **Si la UI hace llamadas cliente-side a la API de generación de video:**
   aplicar el mismo patrón que ImageLab — server-side `api/execute` +
   `fetch('/api/execute', …)` desde el browser.

3. **Si VideoLab ya hace las llamadas server-side:** no toca nada. Reportar
   "verified clean" en la PR.

### Smoke test
Generar un video de prueba desde la UI y confirmar que no hay errores de "API
key in browser".

---

## 3) Cómo lanzar estos fixes desde Claude Code

En otra sesión, dentro del worktree del repo correspondiente:

```
cd ~/GitHub/ImageLab    # o ~/GitHub/VideoLab
claude
# luego dentro de Claude Code:
# "Aplica el fix de PENDING_FIXES.md sección 1 del repo Orchestrator.
#  La causa es que la UI llama a Gemini directamente desde el browser.
#  Mueve esa llamada a api/execute server-side y reemplázala por fetch('/api/execute', …)."
```

Pega secciones de este archivo si necesitas que Claude tenga el contexto exacto.

---

## 4) Contrato que NO debe romperse

El Orchestrator espera que ImageLab y VideoLab sigan exponiendo:

- **POST** `<lab>/api/execute`
- **Request body:** `{ brandId, stage, params, previousOutputs, meta }`
- **Response (200):** `{ output?, image_data_url?, video_url?, status?, error? }`
  - ImageLab devuelve `image_data_url` (base64 data URL) — el Orchestrator se
    encarga de subirla a Storage via Meta MCP.
  - VideoLab devuelve `video_url` (URL pública) — el Orchestrator la pasa
    directamente a SocialLab.
- **Errores:** retornar `status: 'error'` o `error: <msg>` en el JSON. El
  pipeline tiene fail-fast y aborta sin llamar a stages posteriores.

Cualquier cambio de contrato debe coordinarse con cambios en:
- `api/trigger-job.ts` (insertOrchestratorJob payload)
- `supabase/functions/lab-worker/index.ts` (processImagelabJob /
  processVideolabJob)
- `src/services/orchestratorEngine.ts` (executeStage imagelab branch)
