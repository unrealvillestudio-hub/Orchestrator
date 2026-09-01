import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * LAS TRES BANDEJAS EXPLICAN EL ERROR IGUAL.
 *
 * `error` es un código para la máquina (`verdict_failed`, `history_failed`) y no le dice nada al
 * operador; `detail` y `message` son la frase que explica qué pasó y qué hacer. Los tres clientes
 * tienen su propio `req` —cada uno con su contrato— y por eso el orden de preferencia se puede
 * desincronizar sin que nada falle: es exactamente la divergencia que se vuelve permanente en el
 * primer cambio, y ya ocurrió una vez (calibración se corrigió, publicación se quedó atrás).
 *
 * Esta prueba no comprueba comportamiento: fija una CONVENCIÓN entre archivos hermanos, que es lo
 * que ningún tipo puede fijar por sí solo.
 */

const CLIENTES = ['calibrationInbox', 'publishInbox', 'evaluatedHistory'] as const;

describe('el mensaje del server no se colapsa en ninguna bandeja', () => {
  for (const nombre of CLIENTES) {
    it(`${nombre} prefiere la explicación al código de la máquina`, () => {
      const src = readFileSync(new URL(`./${nombre}.ts`, import.meta.url), 'utf8');
      // El acceso admite las dos formas que conviven (`data.x` y `d?.x`): lo que se fija es el
      // ORDEN de preferencia, no cómo se llega a cada campo.
      expect(src).toMatch(/detail\s*\|\|\s*[\w?.]*message\s*\|\|\s*[\w?.]*error/);
    });

    it(`${nombre} conserva el cuerpo crudo para diagnosticar`, () => {
      const src = readFileSync(new URL(`./${nombre}.ts`, import.meta.url), 'utf8');
      expect(src).toMatch(/new CalibrationError\(String\(msg\), res\.status, data\)/);
    });
  }
});
