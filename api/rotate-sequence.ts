/**
 * api/rotate-sequence — LA ROTACIÓN DE SECUENCIA DEJA DE INVOCARSE DESDE EL NAVEGADOR.
 *
 * ── QUÉ CIERRA ─────────────────────────────────────────────────────────────────
 * MEDIDO el 2026-09-24 sobre los 23 repositorios del ecosistema: `public.rotate_sequence_current`
 * es una función `SECURITY DEFINER` —escribe en `content_sequences`— ejecutable por el rol `anon`,
 * y su ÚNICO llamante desde un navegador era `src/services/sequenceBridge.ts:86`, con
 * `VITE_SUPABASE_ANON_KEY`.
 *
 * Una variable `VITE_*` se INCRUSTA en el bundle: no es un secreto, es texto dentro de un archivo
 * JavaScript. Cualquiera que lo tuviera podía rotar secuencias de cualquier marca llamando
 * directamente a `/rest/v1/rpc/rotate_sequence_current`, sin pasar por esta aplicación.
 *
 * El advisor de Supabase lo reporta como
 * `anon_security_definer_function_executable`. Era una de las once; tras
 * `unrlvl-iid-functions#226` quedan cuatro, y ésta es una de ellas — porque revocarla ANTES de
 * mover el llamante habría dejado la rotación muerta. Este archivo es el paso que permite
 * revocarla: CÓDIGO PRIMERO, DDL DESPUÉS.
 *
 * ── PATRÓN CICATRIZ, la de siempre en este repositorio ─────────────────────────
 * Firma Node-native `(req: VercelRequest, res: VercelResponse)`. En el runtime Node de Vercel la
 * firma Web API `(req: Request): Promise<Response>` NO EXISTE: la función cuelga hasta el timeout
 * y devuelve un 504 sin mensaje. Ya está documentado en `trigger-job.ts`, `extract-frames.ts` y
 * `sign-upload.ts`; se repite aquí porque la cicatriz es de quien escribe el archivo siguiente.
 *
 * ── QUIÉN PUEDE LLAMAR A ESTA RUTA ─────────────────────────────────────────────
 * Lo mismo que protege a las otras rutas de `api/` que llevan `service_role` en este proyecto: el
 * SSO de Vercel, activo en todos los despliegues salvo dominios propios. NO se inventa aquí un
 * secreto compartido nuevo: una ruta con una autenticación distinta de las otras treinta da una
 * sensación de refuerzo que el conjunto no tiene, y esconde la decisión real —qué protege a
 * `api/` en este repositorio— detrás de un caso particular. Si esa decisión cambia, cambia para
 * todas a la vez y en su propio PR.
 *
 * Lo que sí cambia, y es el punto: la CREDENCIAL DE BASE deja de viajar al navegador. Antes, quien
 * tuviera el bundle hablaba con Postgres; ahora, como mucho, habla con esta ruta.
 *
 * POST /api/rotate-sequence
 * Body: { brand_id: string, sequence_type: string, language: string }
 * 200 → { sequence_id: string }   ·   4xx/5xx → { error: string }
 *
 * Env (ya existen en este proyecto — las usan approve-job, calibrate y las demás):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { fetchWithTimeout } from './_fetchWithTimeout';

const SB_URL = () => (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SB_KEY = () => process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed — esta ruta sólo acepta POST' });
  }

  const url = SB_URL();
  const key = SB_KEY();
  if (!url || !key) {
    // Fail-loud y nominal: nombra la variable que falta en vez de un 500 mudo.
    const faltan = [!url && 'SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
    return res.status(503).json({ error: `faltan en el entorno: ${faltan.join(', ')}` });
  }

  const body = typeof req.body === 'string' ? safeJson(req.body) : (req.body ?? {});
  const brand_id = String(body.brand_id ?? '');
  const sequence_type = String(body.sequence_type ?? '');
  const language = String(body.language ?? '');

  // Los tres son obligatorios y se comprueban ACÁ, no sólo en la función: un argumento vacío
  // llegaría a Postgres y rotaría algo que nadie quiso rotar.
  const faltan = [
    !brand_id && 'brand_id', !sequence_type && 'sequence_type', !language && 'language',
  ].filter(Boolean);
  if (faltan.length) {
    return res.status(400).json({ error: `faltan en el cuerpo: ${faltan.join(', ')}` });
  }

  // El plazo NO se declara aquí. U-8 lo puso en un solo sitio, por DESTINO y no por endpoint:
  // lo que hace lento a PostgREST es PostgREST, lo llame quien lo llame. Declarar un
  // `AbortController` propio en este archivo sería el mismo número repetido en el sitio 39,
  // divergiendo desde el primer ajuste — y `api/_fetchWithTimeout.test.ts` lo pone rojo, que es
  // exactamente lo que hizo cuando escribí este archivo con su propio temporizador.
  try {
    const r = await fetchWithTimeout('db', `${url}/rest/v1/rpc/rotate_sequence_current`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_brand_id: brand_id, p_sequence_type: sequence_type, p_language: language,
      }),
    });
    const texto = await r.text();
    if (!r.ok) {
      console.error('[rotate-sequence]', r.status, texto.slice(0, 500));
      return res.status(r.status).json({ error: `rotate_sequence_current: ${texto.slice(0, 300)}` });
    }
    // La función RETURNS UUID: PostgREST devuelve la cadena entrecomillada.
    let uuid: unknown = null;
    try { uuid = JSON.parse(texto); } catch { uuid = texto.replace(/^"|"$/g, ''); }
    if (typeof uuid !== 'string' || !uuid) {
      // No se devuelve un 200 sobre algo que no es un identificador: el llamante lo guardaría
      // como si lo fuera, y el fallo aparecería mucho más tarde y en otro sitio.
      return res.status(502).json({ error: `respuesta inesperada: ${texto.slice(0, 200)}` });
    }
    return res.status(200).json({ sequence_id: uuid });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // El envoltorio de U-8 aborta con su propio plazo y el error lo dice; se distingue del
    // fallo de red para que el 504 no se confunda con un 502.
    const porPlazo = e instanceof Error && (e.name === 'AbortError' || /timeout|abort/i.test(msg));
    console.error('[rotate-sequence]', msg);
    return res.status(porPlazo ? 504 : 502).json({
      error: porPlazo ? `la base no respondió a tiempo: ${msg}` : `la base no respondió: ${msg}`,
    });
  }
}

function safeJson(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}
