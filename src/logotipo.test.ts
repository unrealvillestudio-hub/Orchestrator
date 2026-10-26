import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tramosDeCaja } from './logotipo';

/** LOGOTIPO DE LA APP — el nombre conserva su caja con una display sin minúsculas (Sam, 2026-10-26). */
const CSS = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

describe('logotipo', () => {
  it('parte el nombre en tramos de caja sin perder ni duplicar letras', () => {
    expect(tramosDeCaja('Orchestrator')).toEqual([{ texto: 'O', minuscula: false }, { texto: 'rchestrator', minuscula: true }]);
    expect(tramosDeCaja('SocialLab').map((t) => t.texto).join('')).toBe('SocialLab');
    expect(tramosDeCaja('IID')).toEqual([{ texto: 'IID', minuscula: false }]);
  });

  it('usa el bloque de la marca: Bebas Neue cargada y chevron que parpadea', () => {
    expect(CSS).toMatch(/\.lt-logotype \{[^}]*font-family: 'Bebas Neue'/);
    expect(CSS).toMatch(/\.lt-chevron \{[^}]*animation: prompt-blink 1\.1s step-end infinite/);
    expect(HTML).toMatch(/family=Bebas\+Neue/);
  });
});
