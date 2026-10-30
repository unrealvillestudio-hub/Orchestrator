import { describe, it, expect } from 'vitest';
import {
  ZONA_DE_ENTRADA, ZONA_PUBLICA, CARPETA_DE_PROMOVIDAS, DECISIONES, MOTIVO_MINIMO, MOTIVO_MAXIMO,
  marcaDeLaRuta, destinoDePromocion, decisionPedida, filaDeDecision, urlDelObjeto, diasEsperando,
  bucketsDeclarados,
} from './_mediaTray.js';

// Identificadores ficticios A PROPÓSITO: si algo de esto dependiera de una marca real, estas
// pruebas fallarían. Es la comprobación de la regla multimarca hecha ejecutable.
const MARCA = 'BrandAlpha';
const OBJETO = `${ZONA_DE_ENTRADA}${MARCA}/8f2c1a90-0000-4000-8000-000000000001.png`;
const pedir = (over: Record<string, unknown> = {}) =>
  decisionPedida({ object_path: OBJETO, decision: 'promote', motive: 'la portada aprobada para el lanzamiento', ...over });

describe('marcaDeLaRuta — la marca es dato de la ruta, no constante del código', () => {
  it('la lee del segundo segmento', () => {
    expect(marcaDeLaRuta(OBJETO)).toBe(MARCA);
    expect(marcaDeLaRuta(`${ZONA_DE_ENTRADA}OtraMarca/sub/carpeta/x.webp`)).toBe('OtraMarca');
  });

  it('rechaza todo lo que no esté en la zona de entrada', () => {
    // La bandeja decide sobre `staging/` y sobre nada más. Aceptar otra zona la convertiría en un
    // escritorio arbitrario sobre el bucket.
    expect(marcaDeLaRuta(`${ZONA_PUBLICA}${MARCA}/x.png`)).toBeNull();
    expect(marcaDeLaRuta(`temp/${MARCA}/x.png`)).toBeNull();
    expect(marcaDeLaRuta(`/${ZONA_DE_ENTRADA}${MARCA}/x.png`)).toBeNull();
    expect(marcaDeLaRuta('staging-publico/Otra/x.png')).toBeNull();
  });

  it('rechaza la travesía de rutas en cualquiera de sus formas', () => {
    for (const malo of [
      `${ZONA_DE_ENTRADA}../${ZONA_PUBLICA}${MARCA}/x.png`,
      `${ZONA_DE_ENTRADA}${MARCA}/../../x.png`,
      `${ZONA_DE_ENTRADA}${MARCA}//x.png`,
      `${ZONA_DE_ENTRADA}${MARCA}\\x.png`,
      `${ZONA_DE_ENTRADA}${MARCA}/.oculto`,
    ]) expect(marcaDeLaRuta(malo)).toBeNull();
  });

  it('rechaza una marca que no es nombrable, y la ruta sin archivo', () => {
    expect(marcaDeLaRuta(`${ZONA_DE_ENTRADA}${MARCA}`)).toBeNull();
    expect(marcaDeLaRuta(`${ZONA_DE_ENTRADA}${MARCA}/`)).toBeNull();
    expect(marcaDeLaRuta(`${ZONA_DE_ENTRADA}/x.png`)).toBeNull();
    expect(marcaDeLaRuta(`${ZONA_DE_ENTRADA}.secreta/x.png`)).toBeNull();
    expect(marcaDeLaRuta(null)).toBeNull();
  });
});

describe('destinoDePromocion — el destino se DERIVA, nunca se acepta', () => {
  it('aterriza en la zona pública, bajo la marca y en su propia carpeta', () => {
    expect(destinoDePromocion(OBJETO))
      .toBe(`${ZONA_PUBLICA}${MARCA}/${CARPETA_DE_PROMOVIDAS}/8f2c1a90-0000-4000-8000-000000000001.png`);
  });

  it('no se mezcla con lo que el carril compuso para una pieza', () => {
    // `permanent/<marca>/<pieza>/…` es lo del carril. Meter aquí un objeto sin pieza afirmaría que
    // pertenece a una, y la procedencia se perdería para siempre.
    const destino = destinoDePromocion(OBJETO)!;
    expect(destino.split('/')[2]).toBe(CARPETA_DE_PROMOVIDAS);
  });

  it('conserva las subcarpetas del origen', () => {
    expect(destinoDePromocion(`${ZONA_DE_ENTRADA}${MARCA}/2026/10/x.webp`))
      .toBe(`${ZONA_PUBLICA}${MARCA}/${CARPETA_DE_PROMOVIDAS}/2026/10/x.webp`);
  });

  it('sin origen entendido no hay destino', () => {
    expect(destinoDePromocion(`${ZONA_PUBLICA}${MARCA}/x.png`)).toBeNull();
    expect(destinoDePromocion(`${ZONA_DE_ENTRADA}${MARCA}/../x.png`)).toBeNull();
  });
});

describe('decisionPedida — sin motivo no hay decisión', () => {
  it('entiende una promoción completa y deriva su destino', () => {
    const p = pedir();
    expect('error' in p).toBe(false);
    if ('error' in p) return;
    expect(p.brand_id).toBe(MARCA);
    expect(p.decision).toBe('promote');
    expect(p.destino).toBe(destinoDePromocion(OBJETO));
  });

  it('un descarte no tiene destino: no va a ninguna parte', () => {
    const p = pedir({ decision: 'discard', motive: 'no corresponde a nada en curso, se borra' });
    if ('error' in p) throw new Error(p.detail);
    expect(p.destino).toBeNull();
  });

  it('IGNORA cualquier destino que mande el cliente', () => {
    // Si la bandeja aceptara el destino, quien llame podría escribir donde quisiera dentro del
    // bucket. Es la misma regla del corredor: deriva la ruta, no la acepta.
    const p = pedir({ destination_path: `${ZONA_PUBLICA}OtraMarca/colado.png`, destino: 'cualquiera' });
    if ('error' in p) throw new Error(p.detail);
    expect(p.destino).toBe(destinoDePromocion(OBJETO));
    expect(p.destino).not.toContain('OtraMarca');
    expect(p.destino).not.toContain('colado');
  });

  it('rechaza un motivo corto, vacío o de relleno, y dice por qué', () => {
    for (const motive of ['', '   ', 'ok', 'sí', 'x'.repeat(MOTIVO_MINIMO - 1)]) {
      const p = pedir({ motive });
      expect('error' in p).toBe(true);
      if (!('error' in p)) continue;
      expect(p.error).toBe('motivo_insuficiente');
      expect(p.detail.length).toBeGreaterThan(30);
    }
  });

  it('acepta justo el mínimo y rechaza pasarse del máximo', () => {
    expect('error' in pedir({ motive: 'a'.repeat(MOTIVO_MINIMO) })).toBe(false);
    const largo = pedir({ motive: 'a'.repeat(MOTIVO_MAXIMO + 1) });
    expect('error' in largo && largo.error).toBe('motivo_demasiado_largo');
  });

  it('normaliza el motivo sin alterar lo que dice', () => {
    const p = pedir({ motive: '  la   portada\n\ndel lanzamiento  ' });
    if ('error' in p) throw new Error(p.detail);
    expect(p.motive).toBe('la portada del lanzamiento');
  });

  it('rechaza una decisión que no es ninguna de las dos', () => {
    for (const decision of ['', 'keep', 'later', 'PROMOTE', 'delete']) {
      const p = pedir({ decision });
      expect('error' in p && p.error).toBe('decision_invalida');
    }
    expect(DECISIONES).toEqual(['promote', 'discard']);
  });

  it('rechaza decidir sobre algo que no está en la zona de entrada', () => {
    const p = pedir({ object_path: `${ZONA_PUBLICA}${MARCA}/ya-publicada.png` });
    expect('error' in p && p.error).toBe('ruta_no_decidible');
  });

  it('dice cuándo no se dijo sobre qué se decide', () => {
    expect('error' in pedir({ object_path: '' }) && (pedir({ object_path: '' }) as { error: string }).error)
      .toBe('falta_objeto');
  });
});

describe('filaDeDecision — el registro se escribe antes de tocar el bucket', () => {
  it('nace en pending: una fila que sólo se escribe si todo sale bien registra los éxitos', () => {
    const p = pedir();
    if ('error' in p) throw new Error(p.detail);
    const fila = filaDeDecision(p, 'quien.decide');
    expect(fila.outcome).toBe('pending');
    expect(fila.decided_by).toBe('quien.decide');
    expect(fila.motive).toBe('la portada aprobada para el lanzamiento');
    expect(fila.brand_id).toBe(MARCA);
    expect(fila.destination_path).toBe(destinoDePromocion(OBJETO));
  });

  it('no se puede escribir una fila sin firma ni sin motivo', () => {
    const p = pedir();
    if ('error' in p) throw new Error(p.detail);
    const fila = filaDeDecision(p, 'alguien');
    for (const campo of ['object_path', 'brand_id', 'decision', 'motive', 'decided_by'])
      expect(String(fila[campo] ?? '')).not.toBe('');
  });
});

describe('urlDelObjeto — la tarjeta muestra el artefacto, no su nombre', () => {
  it('construye la URL pública del bucket', () => {
    expect(urlDelObjeto('https://ejemplo.supabase.co', 'un-bucket', `${ZONA_DE_ENTRADA}${MARCA}/x.png`))
      .toBe(`https://ejemplo.supabase.co/storage/v1/object/public/un-bucket/${ZONA_DE_ENTRADA}${MARCA}/x.png`);
  });
  it('tolera la barra final de la base y escapa cada segmento sin comerse las barras', () => {
    const u = urlDelObjeto('https://ejemplo.supabase.co/', 'b', `${ZONA_DE_ENTRADA}Marca Con Espacio/a b.png`);
    expect(u).toContain('/storage/v1/object/public/b/staging/Marca%20Con%20Espacio/a%20b.png');
    expect(u).not.toContain('.co//storage');
  });
});

describe('diasEsperando — nada caduca solo, así que la espera se ve', () => {
  const ahora = Date.parse('2026-10-27T12:00:00.000Z');
  it('cuenta días completos', () => {
    expect(diasEsperando('2026-10-27T11:00:00.000Z', ahora)).toBe(0);
    expect(diasEsperando('2026-10-26T11:00:00.000Z', ahora)).toBe(1);
    expect(diasEsperando('2026-09-27T12:00:00.000Z', ahora)).toBe(30);
  });
  it('no inventa una espera cuando no consta cuándo llegó', () => {
    expect(diasEsperando(null, ahora)).toBeNull();
    expect(diasEsperando('no es una fecha', ahora)).toBeNull();
  });
  it('nunca devuelve negativo', () => {
    expect(diasEsperando('2026-10-28T12:00:00.000Z', ahora)).toBe(0);
  });
});

describe('regla multimarca — ejecutable, no declarativa', () => {
  it('ninguna marca real aparece en el módulo', async () => {
    const { readFileSync } = await import('node:fs');
    const fuente = readFileSync(new URL('./_mediaTray.ts', import.meta.url), 'utf8');
    for (const m of ['ForumPHs', 'NeuroneSCF', 'LucienSael', 'UnrealvilleStudio', 'VizosSalon'])
      expect(fuente).not.toContain(m);
    // Y tampoco un principal: quién sube es dato de la fila del corredor, no de este eje.
    for (const p of ['chat-assistant', 'repo-agent']) expect(fuente).not.toContain(p);
  });
});

// ── EL ORDEN DE LOS PASOS ES EL CONTROL ────────────────────────────────────────────────────────
// `media-decide.ts` no se puede ejecutar sin red, pero su ORDEN sí se puede fijar, y es justo lo
// que hace que el registro valga: si el bucket se tocara antes de escribir la fila, una fila
// perdida dejaría un objeto promovido que nadie puede explicar. Estas pruebas leen el handler.
describe('media-decide — la secuencia que hace que el registro no sea decorativo', () => {
  const fuente = () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    return readFileSync(new URL('./media-decide.ts', import.meta.url), 'utf8') as string;
  };

  it('escribe la decisión ANTES de tocar el bucket', () => {
    const s = fuente();
    const registro = s.indexOf('return=representation');
    const copia = s.indexOf('await copiar(');
    const borrado = s.indexOf('await borrar(');
    expect(registro).toBeGreaterThan(0);
    expect(copia).toBeGreaterThan(registro);
    expect(borrado).toBeGreaterThan(registro);
  });

  it('verifica el destino antes de borrar el origen', () => {
    const s = fuente();
    // Borrar tras una copia que no llegó pierde el objeto, y lo pierde justo después de que
    // alguien decidiera conservarlo.
    // La llamada lleva el bucket de destino desde el 2026-10-30 —la promoción cruza de bucket—,
    // así que el ancla es la verificación del destino, no su forma anterior de un solo argumento.
    const verifica = s.indexOf('await existe(BUCKET_PUBLICO, pedido.destino');
    expect(verifica).toBeGreaterThan(s.indexOf('await copiar('));
    expect(s.indexOf('await borrar(')).toBeGreaterThan(verifica);
  });

  it('si el registro no existe todavía, NO toca el bucket y lo dice', () => {
    const s = fuente();
    expect(s).toContain('bandeja_no_habilitada');
    expect(s.indexOf('bandeja_no_habilitada')).toBeLessThan(s.indexOf('await copiar('));
    expect(s).toContain('42P01');
  });

  it('exige la vista de la bandeja y el alcance de la marca', () => {
    const s = fuente();
    expect(s).toContain("['media_promotion']");
    expect(s).toContain('inReviewScope');
    expect(s).toContain('denyOutOfScope');
  });

  it('no existe vía para un agente: ni secreto de cron ni llave de servicio del llamante', () => {
    // UN CONTROL QUE UN AGENTE PUEDE LLAMAR NO ES UN CONTROL. Si alguien añade una puerta por
    // secreto a este endpoint, esta prueba lo obliga a declararlo en vez de colarlo.
    const s = fuente();
    for (const puerta of ['CRON_SECRET', 'x-cron-secret', 'IID_CRON_SECRET', 'x-principal-secret'])
      expect(s).not.toContain(puerta);
    expect(s).toContain('requireReviewer');
  });

  it('el destino que decide es el derivado, nunca uno del cuerpo de la petición', () => {
    const s = fuente();
    expect(s).not.toContain('body.destination_path');
    expect(s).not.toContain('body.destino');
    expect(s).toContain('pedido.destino');
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// LA ZONA DE ENTRADA VIVE EN UN BUCKET PRIVADO (2026-10-30)
//
// `unrlvl-iid-functions#537` movió el aterrizaje al bucket privado que declara la fila del
// principal. Lo que estas pruebas protegen no es el nombre del bucket —es dato y puede cambiar—:
// protegen que el nombre NO esté en el código, que la tarjeta reciba una URL firmada en vez de una
// pública, y que la promoción cruce de bucket sin suponer el de origen.
// ════════════════════════════════════════════════════════════════════════════════════════════

/** La fuente SIN COMENTARIOS. Un nombre citado en una explicación no es un valor cableado. */
const codigoDe = async (archivo: string): Promise<string> => {
  const { readFileSync } = await import('node:fs');
  return readFileSync(new URL(`./${archivo}`, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
};

describe('bucketsDeclarados — el bucket de aterrizaje es dato de la fila', () => {
  it('devuelve los distintos, en el orden en que aparecen', () => {
    expect(bucketsDeclarados(
      [{ allowed_bucket: 'zona-a', active: true }, { allowed_bucket: 'zona-b', active: true },
       { allowed_bucket: 'zona-a', active: true }], 'por-defecto',
    )).toEqual(['zona-a', 'zona-b']);
  });

  it('ignora los principales desactivados: su bucket no es zona de entrada viva', () => {
    expect(bucketsDeclarados(
      [{ allowed_bucket: 'viva', active: true }, { allowed_bucket: 'apagada', active: false }],
      'por-defecto',
    )).toEqual(['viva']);
  });

  it('cae al valor por defecto cuando ninguna fila lo declara, nunca a lista vacía', () => {
    // Una lista vacía haría que la bandeja no mirase a ninguna parte, y eso se lee igual que
    // «no hay nada pendiente»: el fallo silencioso que esta bandeja existe para no tener.
    for (const filas of [[], null, undefined, [{ active: true }], [{ allowed_bucket: '   ' }]])
      expect(bucketsDeclarados(filas, 'por-defecto')).toEqual(['por-defecto']);
  });

  it('recorta el valor de la fila: un espacio no crea un bucket nuevo', () => {
    expect(bucketsDeclarados([{ allowed_bucket: '  zona-a  ' }, { allowed_bucket: 'zona-a' }], 'd'))
      .toEqual(['zona-a']);
  });
});

describe('el bucket de entrada no está en el código de la bandeja', () => {
  it('ni la lectura ni la decisión nombran un bucket de aterrizaje', async () => {
    // El bucket PÚBLICO sí es eje del ecosistema y vive en `_mediaStore.ts` como constante; el de
    // ATERRIZAJE es instancia y sólo puede venir de la fila. Si alguien lo cablea, esto falla.
    for (const archivo of ['media-tray.ts', 'media-decide.ts', '_mediaTray.ts']) {
      const s = await codigoDe(archivo);
      expect(s).not.toContain('unrlvl-media');
    }
  });

  it('la bandeja resuelve los buckets y lista sobre ellos', async () => {
    const s = await codigoDe('media-tray.ts');
    expect(s).toContain('bucketsDeAterrizaje');
    expect(s).toContain('objetosBajo(b, ZONA_DE_ENTRADA)');
  });
});

describe('la tarjeta recibe una URL firmada, no una pública', () => {
  it('la bandeja firma y no construye URLs públicas', async () => {
    const s = await codigoDe('media-tray.ts');
    expect(s).toContain('urlesFirmadas');
    // `object/public/…` contra un bucket privado devuelve 400 y el navegador pinta un hueco.
    expect(s).not.toContain('object/public');
    expect(s).not.toContain('urlDelObjeto');
  });

  it('lo que no se pudo firmar se cuenta, no se inventa', async () => {
    const s = await codigoDe('media-tray.ts');
    expect(s).toContain('sin_url');
    expect(s).toMatch(/url:\s*firmas\.get\([^)]*\)\s*\?\?\s*null/);
  });
});

describe('la promoción cruza de bucket sin suponer el de origen', () => {
  it('busca el bucket donde el objeto existe', async () => {
    const s = await codigoDe('media-decide.ts');
    expect(s).toContain('bucketsDeAterrizaje');
    expect(s).toMatch(/if\s*\(await existe\(b,\s*pedido\.object_path\)\)/);
  });

  it('copia al bucket público y verifica EN EL DESTINO antes de borrar el origen', async () => {
    const s = await codigoDe('media-decide.ts');
    expect(s).toContain('copiar(bucketOrigen, pedido.object_path, BUCKET_PUBLICO, pedido.destino!)');
    const copia = s.indexOf('copiar(bucketOrigen');
    const verifica = s.indexOf('existe(BUCKET_PUBLICO, pedido.destino!)');
    const borra = s.indexOf('borrar(bucketOrigen, pedido.object_path)');
    expect(copia).toBeGreaterThan(-1);
    expect(verifica).toBeGreaterThan(copia);
    expect(borra).toBeGreaterThan(verifica);
  });

  it('el bucket de origen queda escrito en el desenlace, también cuando todo fue bien', async () => {
    // La tabla guarda la ruta y no el bucket; una ruta sin bucket ya no identifica un objeto.
    const s = await codigoDe('media-decide.ts');
    expect(s).toContain('bucket_origen=${bucketOrigen}');
  });
});
