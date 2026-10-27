/**
 * UNRLVL Orchestrator — api/_mediaTray.ts  (LA BANDEJA DE MEDIOS · bloque puro)
 *
 * LA ÚNICA PUERTA DE SALIDA DE `staging/`, Y ES UNA PUERTA HUMANA.
 *
 * Un agente puede pedir al corredor de medios un permiso para escribir UN objeto, y ese permiso
 * aterriza siempre en `staging/`. Nada mueve un objeto de ahí: el promotor del carril sólo reescribe
 * rutas que empiezan por `temp/`. Esa frontera es la propiedad de seguridad que se compró el
 * 2026-09-15 — lo que sube un agente no puede volverse parte de una publicación por sí solo— y el
 * precio es que hoy lo que sube un agente no sirve para nada: entra y se queda.
 *
 * Esta bandeja es el precio pagado de vuelta. Pone una puerta, y la pone donde tiene que estar:
 *
 *   · NO HAY ENDPOINT QUE UN AGENTE PUEDA LLAMAR. Ni EF, ni RPC, ni cron. Si existiera, un agente
 *     equivocado o manipulado subiría y promovería en el mismo gesto, y la frontera sería
 *     decorativa. UN CONTROL QUE UN AGENTE PUEDE LLAMAR NO ES UN CONTROL.
 *   · LA TARJETA MUESTRA EL ARTEFACTO, NO SU DESCRIPCIÓN. Si lo que se aprueba fuera un texto que
 *     escribió el agente que subió el archivo, se estaría aprobando las palabras del agente. Lo que
 *     acompaña a la imagen es lo único que el agente no puede falsificar: qué principal pidió el
 *     permiso y cuándo.
 *   · EL DESTINO SE DERIVA, NO SE ACEPTA. Igual que en el corredor: el que llama manda qué objeto
 *     decide, jamás a dónde va. Una ruta de destino aceptada del cliente convierte la bandeja en un
 *     escritorio arbitrario sobre el bucket.
 *   · SIN REGISTRO NO HAY PROMOCIÓN. El motivo es obligatorio y se escribe ANTES de tocar el bucket.
 *     Un control cuyo registro se puede perder es decorativo: dentro de tres meses la pregunta «¿por
 *     qué está esta imagen aquí?» se responde con una frase y un nombre, o no se responde.
 *
 * REGLA MULTIMARCA. La marca NO está en el código: se lee del segundo segmento de la ruta, que es
 * como el corredor la deriva al emitir el permiso. Entra una marca nueva de otro rubro y otro país y
 * este archivo no cambia.
 *
 * Sin red, sin reloj propio y sin estado: todo lo que decide se prueba en `_mediaTray.test.ts`.
 */

/** La zona en la que aterriza lo que sube un agente. Prefijo de verdad, con barra. */
export const ZONA_DE_ENTRADA = 'staging/';
/** La zona que el carril ya usa para lo que puede verse. */
export const ZONA_PUBLICA = 'permanent/';
/**
 * La carpeta en la que aterriza lo promovido, DENTRO de la zona pública y de la marca.
 * No se mezcla con `permanent/<marca>/<pieza>/…`, que es lo que compuso el carril para una pieza
 * concreta: un objeto promovido a mano no pertenece a ninguna pieza, y meterlo ahí sería afirmar
 * que sí. La procedencia queda visible en la ruta para siempre.
 */
export const CARPETA_DE_PROMOVIDAS = 'promovidas';

/** Lo que se puede decidir. Dos salidas y ninguna tercera: dejarlo ahí no es una decisión. */
export const DECISIONES = ['promote', 'discard'] as const;
export type Decision = (typeof DECISIONES)[number];

/**
 * UN MOTIVO DE TRES LETRAS NO ES UN MOTIVO. El mínimo no persigue calidad —no se puede—: persigue
 * que escribir «ok» cueste lo mismo que escribir por qué, y entonces no compense mentir.
 */
export const MOTIVO_MINIMO = 10;
export const MOTIVO_MAXIMO = 500;

/** Una fila de la bandeja, tal como la ve quien decide. */
export interface EnBandeja {
  object_path: string;
  brand_id: string;
  /** Qué principal pidió el permiso con el que se subió, si consta. No lo escribe el agente. */
  subido_por: string | null;
  subido_en: string | null;
  bytes: number | null;
  mime: string | null;
  /** La imagen misma. La tarjeta muestra el artefacto, no su descripción. */
  url: string;
  /** Días que lleva esperando una decisión. Nada caduca solo: esto es lo que lo hace visible. */
  dias_esperando: number | null;
}

/** Un segmento de ruta seguro: sin barras, sin `..`, sin control ni espacios a los lados. */
const SEGMENTO_SEGURO = /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/;

/**
 * LA MARCA ES EL SEGUNDO SEGMENTO, y se valida. `null` si la ruta no tiene la forma que el corredor
 * deriva — y entonces no se decide sobre ella: una ruta que no se entiende no se mueve.
 */
export function marcaDeLaRuta(objectPath: unknown): string | null {
  const ruta = String(objectPath ?? '');
  if (!ruta.startsWith(ZONA_DE_ENTRADA)) return null;
  if (ruta.includes('..') || ruta.includes('//') || ruta.includes('\\')) return null;
  const partes = ruta.slice(ZONA_DE_ENTRADA.length).split('/');
  if (partes.length < 2) return null;              // marca + al menos un archivo
  const marca = partes[0];
  if (!SEGMENTO_SEGURO.test(marca)) return null;
  // Todo lo que viene después tiene que ser nombrable; un segmento vacío significa `//`.
  if (!partes.slice(1).every((p) => p.length > 0 && !p.startsWith('.'))) return null;
  return marca;
}

/**
 * EL DESTINO SE DERIVA DE LA RUTA DE ORIGEN, NUNCA SE ACEPTA DEL QUE LLAMA. Devuelve `null` cuando
 * el origen no es una ruta válida de la zona de entrada: sin origen entendido no hay destino.
 */
export function destinoDePromocion(objectPath: unknown): string | null {
  const marca = marcaDeLaRuta(objectPath);
  if (!marca) return null;
  const ruta = String(objectPath);
  const archivo = ruta.slice(ZONA_DE_ENTRADA.length + marca.length + 1);
  if (!archivo) return null;
  return `${ZONA_PUBLICA}${marca}/${CARPETA_DE_PROMOVIDAS}/${archivo}`;
}

/** Lo que pidió quien decide, ya entendido. O el motivo exacto por el que no se entiende. */
export type Pedido =
  | { error: string; detail: string }
  | { object_path: string; brand_id: string; decision: Decision; motive: string; destino: string | null };

/**
 * QUÉ SE PIDIÓ, Y SI SE PUEDE HACER. Falla en voz alta y con el motivo: un 400 sin causa obliga a
 * adivinar, y lo que hay que adivinar se adivina mal.
 */
export function decisionPedida(body: unknown): Pedido {
  const b = (body ?? {}) as Record<string, unknown>;
  const ruta = String(b.object_path ?? '').trim();
  if (!ruta) return { error: 'falta_objeto', detail: 'No se dijo sobre qué objeto se decide.' };

  const marca = marcaDeLaRuta(ruta);
  if (!marca) {
    return {
      error: 'ruta_no_decidible',
      detail: `Sólo se decide sobre objetos de «${ZONA_DE_ENTRADA}», con la forma ` +
              `«${ZONA_DE_ENTRADA}<marca>/<archivo>». Lo demás no pasa por esta bandeja.`,
    };
  }

  const decision = String(b.decision ?? '').trim() as Decision;
  if (!(DECISIONES as readonly string[]).includes(decision)) {
    return {
      error: 'decision_invalida',
      detail: `La decisión es «${DECISIONES.join('» o «')}». Dejarlo donde está no es una decisión: es no decidir.`,
    };
  }

  const motive = String(b.motive ?? '').trim().replace(/\s+/g, ' ');
  if (motive.length < MOTIVO_MINIMO) {
    return {
      error: 'motivo_insuficiente',
      detail: `El motivo es obligatorio y necesita al menos ${MOTIVO_MINIMO} caracteres. ` +
              'Dentro de tres meses es lo único que responde por qué esta imagen está donde está.',
    };
  }
  if (motive.length > MOTIVO_MAXIMO) {
    return { error: 'motivo_demasiado_largo', detail: `El motivo no puede pasar de ${MOTIVO_MAXIMO} caracteres.` };
  }

  // El destino sólo existe para la promoción. Un descarte no va a ninguna parte: se borra.
  return { object_path: ruta, brand_id: marca, decision, motive, destino: decision === 'promote' ? destinoDePromocion(ruta) : null };
}

/**
 * LA FILA QUE SE ESCRIBE ANTES DE TOCAR EL BUCKET. Nace en `pending` a propósito: si el movimiento
 * falla después, queda constancia de que se decidió y de que no se consumó, que es exactamente lo
 * que hay que poder ver. Una fila que sólo se escribe cuando todo sale bien registra los éxitos, y
 * un registro que sólo guarda éxitos no responde la pregunta que se le hace a un control.
 */
export function filaDeDecision(
  pedido: Extract<Pedido, { decision: Decision }>,
  quien: string,
): Record<string, unknown> {
  return {
    object_path: pedido.object_path,
    brand_id: pedido.brand_id,
    decision: pedido.decision,
    motive: pedido.motive,
    decided_by: quien,
    destination_path: pedido.destino,
    outcome: 'pending',
  };
}

/** La URL pública del objeto. La bandeja muestra la imagen; sin esto mostraría su nombre. */
export function urlDelObjeto(base: string, bucket: string, objectPath: string): string {
  const raiz = String(base ?? '').replace(/\/+$/, '');
  return `${raiz}/storage/v1/object/public/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`;
}

/** Días completos que un objeto lleva esperando. `null` si no consta cuándo llegó. */
export function diasEsperando(subidoEn: unknown, ahoraMs: number): number | null {
  const t = Date.parse(String(subidoEn ?? ''));
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((ahoraMs - t) / 86_400_000));
}
