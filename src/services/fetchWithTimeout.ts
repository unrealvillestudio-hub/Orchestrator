/**
 * fetchWithTimeout.ts — U-8 bis · EL MISMO PLAZO, DEL LADO DEL NAVEGADOR.
 *
 * ── POR QUÉ ESTO ES UN CORTE APARTE, Y NO LA SEGUNDA MITAD DE U-8 ────────────────
 * U-8 cerró las 38 llamadas de `api/` porque allí un `fetch` sin aborto **cuelga una
 * función serverless** hasta que la plataforma la mata, y deja un 504 sin mensaje. Acá el
 * daño es otro y menor: un `fetch` colgado en el navegador **deja un spinner girando**. No
 * consume una función, no cuesta dinero y no rompe nada aguas abajo.
 *
 * Pero sí rompe algo: **la pantalla deja de poder decir la verdad.** Un spinner eterno no
 * se distingue de «está tardando», y quien mira acaba recargando la página —que en medio de
 * una acción es justo lo que no hay que hacer—. Ése es el defecto que este corte cierra.
 *
 * ── LA REGLA DURA, Y ES LA INVERSA DE LA DE U-8 ──────────────────────────────────
 * En el servidor el plazo va POR DEBAJO del `maxDuration`, para que la función alcance a
 * responder antes de que la maten.
 *
 * **Acá va POR ENCIMA.** Si el navegador abortara a los diez segundos una llamada a un
 * endpoint que tiene sesenta para contestar, mataría una petición que el servidor estaba a
 * punto de responder — y el operador vería «se agotó el tiempo» sobre un trabajo que sí se
 * hizo. Es peor que el spinner: el spinner confunde, esto miente.
 *
 * Por eso `own-api` supera al `maxDuration` más largo de `vercel.json` con margen, y hay
 * una prueba que compara los dos números. Las dos reglas son la misma idea mirada desde los
 * dos lados: **el que espera siempre espera un poco más que el que trabaja.**
 */

/**
 * A quién se está llamando. Enumerar acá es enumerar CLASES DE DESTINO, no marcas ni
 * pantallas: lo que hace lento a un destino es el destino, no quién lo llama.
 */
export type FetchTarget = 'db' | 'edge' | 'own-api' | 'lab';

/** Cuánto espera el navegador a cada destino, y por qué ese número. */
export const TIMEOUT_MS: Record<FetchTarget, number> = {
  /**
   * PostgREST directo desde el navegador. Más generoso que los 8 s del servidor porque la
   * red de quien mira la pantalla es peor que la del centro de datos, pero sigue siendo una
   * lectura: si tarda quince segundos, no va a llegar.
   */
  db: 15_000,
  /** Edge Functions: hacen trabajo real —arbitran, despliegan, leen OCR—, así que esperan. */
  edge: 60_000,
  /**
   * Las rutas `/api/*` de este mismo repo. **Por encima del `maxDuration` más largo que
   * declara `vercel.json`** (60 s), con quince segundos de margen para la red de ida y
   * vuelta. Ver la regla dura de arriba: abortar antes mataría una respuesta en camino.
   */
  'own-api': 75_000,
  /**
   * Los labs, que generan copy e imágenes. Es el único destino donde tardar minutos es
   * normal, y aun así tiene techo: sin él, un lab caído deja la pantalla girando para
   * siempre, que es exactamente lo que este corte viene a impedir.
   */
  lab: 180_000,
};

/** Código estable del corte por plazo. Se busca por este texto. */
export const REQUEST_TIMEOUT_CODE = 'REQUEST_TIMEOUT';

/**
 * EL PLAZO VENCIDO TIENE IDENTIDAD PROPIA, Y NO ES UN CAPRICHO.
 *
 * Todos los servicios de este repo atrapan el fallo de `fetch` y lo convierten en «No se
 * pudo contactar el servidor (red)». Sin esta clase, un plazo vencido se disfrazaría de
 * caída de red — la misma confusión que U-8 separó del lado del servidor, reintroducida del
 * lado del cliente. Y lleva a la reparación equivocada: se mira la red cuando lo que hay
 * que mirar es por qué el otro extremo tarda tanto.
 */
export class RequestTimeout extends Error {
  readonly code = REQUEST_TIMEOUT_CODE;
  constructor(readonly target: FetchTarget, readonly timeoutMs: number) {
    super(`La petición superó los ${Math.round(timeoutMs / 1000)} s de espera y se canceló.`);
    this.name = 'RequestTimeout';
  }
}

/**
 * `fetch` con plazo. Sustituto directo: mismos argumentos, más el destino al frente.
 *
 * Distingue VENCER de FALLAR con la misma bandera que el envoltorio del servidor, porque
 * `fetch` lanza el mismo `AbortError` para los dos casos. Y `clearTimeout` va en `finally`:
 * corre en éxito y en error.
 *
 * Igual que en el servidor, **el plazo mide hasta la RESPUESTA, no hasta el último byte**:
 * `fetch` resuelve con las cabeceras y el cuerpo se consume después. Una descarga grande no
 * queda cortada por llegar tarde.
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
    if (vencido) throw new RequestTimeout(target, timeoutMs);
    throw err;
  } finally {
    clearTimeout(id);
  }
}

/**
 * LA FRASE QUE VE EL OPERADOR CUANDO ALGO NO LLEGÓ.
 *
 * Vive acá y no en cada servicio para que todas las pantallas digan lo mismo ante lo mismo
 * — y, sobre todo, para que **no vuelvan a decir «red» cuando fue «tiempo»**. Un plazo
 * vencido y un cable caído se arreglan mirando sitios distintos.
 *
 * `esEscritura` NO es un adorno: es la única diferencia que cambia qué debe hacer quien
 * lee el aviso. **Reintentar una lectura es gratis; reintentar una escritura puede
 * aplicarla dos veces**, porque un plazo vencido en el navegador no cancela el trabajo que
 * el servidor ya estaba haciendo. Decir «reintenta» sin distinguirlo es dar un consejo que
 * a veces duplica un veredicto.
 */
export function mensajeDeFallo(err: unknown, esEscritura = false): string {
  if (err instanceof RequestTimeout) {
    return esEscritura
      ? `${err.message} La acción PUEDE HABERSE APLICADO igual —el servidor sigue con ella—, `
        + 'así que conviene refrescar y comprobar antes de repetirla.'
      : `${err.message} Volver a intentarlo es seguro: no se escribió nada.`;
  }
  return 'No se pudo contactar el servidor (red).';
}
