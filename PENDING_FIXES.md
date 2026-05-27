# PENDING_FIXES — UNRLVL Orchestrator

Estos fixes **no se aplican en este repo**. Viven en repos separados (`ImageLab`,
`VideoLab`) y deben ejecutarse en otra sesión de Claude Code apuntando a esos
worktrees.

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
