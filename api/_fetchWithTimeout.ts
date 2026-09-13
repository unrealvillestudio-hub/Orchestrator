/**
 * _fetchWithTimeout.ts — U-8 · NINGUNA LLAMADA DE RED PUEDE COLGAR UNA FUNCIÓN.
 *
 * ── EL MODO DE FALLO QUE ESTE MÓDULO CIERRA ──────────────────────────────────────
 * En serverless, un `fetch` sin aborto no falla: **espera**. Si el destino no contesta,
 * la función sigue viva consumiendo su presupuesto hasta que la plataforma la mata con
 * `FUNCTION_INVOCATION_TIMEOUT` — un 504 sin cuerpo, sin mensaje y sin línea de log que
 * diga a quién se estaba llamando. El repo ya lo tenía escrito para SocialLab e ImageLab
 * en `PENDING_FIXES.md`; el Orchestrator llamaba a Supabase, a las Edge Functions y a
 * Anthropic sin esa red, salvo en un sitio.
 *
 * Ese sitio —`approve-job.ts`— es el patrón que se generaliza aquí: un `AbortController`,
 * un temporizador que lo aborta y un `clearTimeout` que corre pase lo que pase. **No se
 * rediseña nada: se pone en un solo lugar lo que ya funcionaba en uno.**
 *
 * ── POR QUÉ EL PLAZO ES POR DESTINO Y NO POR ENDPOINT ────────────────────────────
 * Lo que hace lento a un destino es el destino, no quién lo llama. Una lectura a
 * PostgREST que tarda ocho segundos ya falló, la llame quien la llame; un modelo que
 * tarda ocho segundos está trabajando normal. Un plazo por endpoint sería el mismo
 * número repetido en treinta y ocho sitios, divergiendo desde el primer ajuste.
 *
 * Los destinos se nombran por LO QUE SON —base de datos, función de borde, modelo—, no
 * por el endpoint que estrenó cada plazo. Un llamante con una necesidad legítimamente
 * distinta pasa su plazo como argumento; no se le abre una rama.
 *
 * ── LA REGLA DURA: EL PLAZO DEL MODELO VA POR DEBAJO DEL `maxDuration` ───────────
 * Es el punto entero del corte. Si el plazo fuera mayor, la plataforma mataría la función
 * ANTES de que el aborto pudiera devolver un error legible, y volveríamos al 504 mudo. El
 * margen existe para que la función alcance a responder «se cortó esto, a los tantos ms».
 *
 * Por eso las rutas que llaman al modelo declaran `maxDuration` EXPLÍCITO en `vercel.json`
 * y hay una prueba que compara los dos números: si alguien sube el plazo o baja el
 * `maxDuration`, **falla en CI y no en producción**. Un `maxDuration` heredado del plan no
 * sirve para esa comparación — cambia el día que cambia el plan y nadie se entera.
 */

/**
 * Los destinos. Enumerar acá es deliberado y es lo contrario de hardcodear un caso: lo
 * enumerado son clases de red, no marcas ni endpoints, y un destino nuevo (una cola, un
 * proveedor de imagen) entra como entrada nueva con su plazo y su razón.
 */
export type FetchTarget = 'db' | 'edge' | 'model';

/** Cuánto se espera a cada destino, y por qué ese número y no otro. */
export const TIMEOUT_MS: Record<FetchTarget, number> = {
  /**
   * PostgREST y Storage: lecturas y escrituras de milisegundos. Si tardan segundos, ya
   * falló algo aguas abajo y esperar más no lo arregla. Es el valor que `approve-job`
   * venía usando desde antes de este corte — se conserva, no se reestrena.
   */
  db: 8_000,
  /**
   * Edge Functions: hacen trabajo real (publican, arbitran), así que se les da margen.
   * Por debajo de los 30 s que declara `approve-job.ts`, que es quien más las llama.
   */
  edge: 25_000,
  /**
   * El modelo: es el único destino donde tardar es normal, y aun así tiene techo. 50 s
   * contra los 60 s de `maxDuration` de sus dos rutas deja diez segundos para que la
   * función redacte el error y responda.
   */
  model: 50_000,
};

/**
 * Las rutas que llaman al modelo, con su `maxDuration` declarado en `vercel.json`.
 *
 * Vive acá y no sólo en el JSON porque es la mitad de una invariante: el otro lado es
 * `TIMEOUT_MS.model`, y una invariante cuyas dos mitades viven en archivos que nadie
 * compara se rompe sin ruido. La prueba lee ESTA lista, busca cada ruta en `vercel.json`
 * y exige que el `maxDuration` real supere al plazo.
 */
export const MODEL_ROUTES = ['api/calibrate.ts', 'api/interpret-intent.ts'] as const;

/** Código estable del corte por plazo. Se busca por este texto en los logs. */
export const FETCH_TIMEOUT_CODE = 'FETCH_TIMEOUT';

/**
 * EL ERROR DICE QUÉ SE CORTÓ Y A LOS CUÁNTOS MILISEGUNDOS.
 *
 * Un `AbortError` genérico obliga a adivinar cuál de las diez llamadas del archivo fue.
 * Éste nombra destino, plazo y origen, y por eso se puede buscar en un log.
 *
 * **La URL viaja SIN su query.** No es estética: por ahí pasan `apikey`, `token` y filtros
 * con datos de piezas, y un mensaje de error termina en un log que no es un sitio seguro.
 */
export class FetchTimeout extends Error {
  readonly code = FETCH_TIMEOUT_CODE;
  constructor(
    readonly target: FetchTarget,
    readonly timeoutMs: number,
    readonly where: string,
  ) {
    super(`${FETCH_TIMEOUT_CODE}[${target}] sin respuesta tras ${timeoutMs} ms — ${where}`);
    this.name = 'FetchTimeout';
  }
}

/** Origen + camino, nunca la query. Si la URL no se puede parsear, no se adivina. */
function sinQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '(url no parseable)';
  }
}

/**
 * `fetch` con plazo. Sustituto directo: mismos argumentos, más el destino al frente.
 *
 * DISTINGUE VENCER DE FALLAR, y no es un detalle de implementación. Un error de red antes
 * del plazo se propaga TAL CUAL: confundir «la red falló» con «tardó demasiado» manda a
 * quien depura al sitio equivocado, y el segundo diagnóstico lleva a subir un plazo que
 * no era el problema. La bandera `vencido` es lo único que separa los dos casos, porque
 * `fetch` lanza el mismo `AbortError` para los dos.
 *
 * `clearTimeout` va en `finally`: corre en éxito y en error. Un temporizador vivo mantiene
 * despierta a la función que este módulo existe para no colgar — la misma falla, más sutil.
 *
 * ── EL PLAZO MIDE HASTA LA RESPUESTA, NO HASTA EL ÚLTIMO BYTE ────────────────────
 * `fetch` resuelve cuando llegan las CABECERAS; el cuerpo se consume después, con
 * `json()`, `text()` o `arrayBuffer()`. Como el temporizador se limpia al resolver, una
 * descarga larga —un vídeo de Storage, por ejemplo— NO queda cortada por el plazo de su
 * destino: lo que se acota es que el otro extremo conteste, que es donde vive el cuelgue.
 *
 * Es deliberado y conviene saberlo antes de «arreglarlo»: extender el plazo al cuerpo
 * cortaría descargas legítimas, que es exactamente el riesgo que este corte no quiere
 * introducir mientras cierra el otro.
 */
export async function fetchWithTimeout(
  target: FetchTarget,
  url: string,
  init: RequestInit = {},
  timeoutMs: number = TIMEOUT_MS[target],
): Promise<Response> {
  const ctrl = new AbortController();
  let vencido = false;
  const id = setTimeout(() => { vencido = true; ctrl.abort(); }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err) {
    if (vencido) throw new FetchTimeout(target, timeoutMs, sinQuery(url));
    throw err;
  } finally {
    clearTimeout(id);
  }
}
