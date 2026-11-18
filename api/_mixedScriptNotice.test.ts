import { describe, it, expect } from 'vitest';
import { mixedScriptNoticesOf, textAfterMixedScript } from './_mixedScriptNotice';

// El caso medido: título de la pieza 95385260 con la «\u0435» cirílica (U+0435) en «pid\u0435».
const PIDE_CIRILICO = 'pid\u0435';
const RESP = { mixed_script: { fixed: [{ field: 'title', before: PIDE_CIRILICO, after: 'pide' }], unresolved: [] } };

describe('letras de otro alfabeto al guardar', () => {
  it('avisa de «pid\u0435» → «pide»', () => {
    expect(mixedScriptNoticesOf(RESP)).toEqual([`Letra de otro alfabeto corregida en title: «${PIDE_CIRILICO}» → «pide»`]);
  });
  it('el editor queda con lo guardado, no con lo enviado', () => {
    const enviado = `Tu cabello no ${PIDE_CIRILICO} más agua`;
    const quedo = textAfterMixedScript(enviado, 'title', RESP);
    expect(quedo).toBe('Tu cabello no pide más agua');
    expect(/[\u0400-\u04ff]/.test(quedo)).toBe(false);
  });
  it('una corrección de otro campo no toca éste', () => {
    expect(textAfterMixedScript(`x ${PIDE_CIRILICO}`, 'body', RESP)).toBe(`x ${PIDE_CIRILICO}`);
  });
  it('respuesta de una EF anterior (sin mixed_script): ni avisos ni cambios', () => {
    expect(mixedScriptNoticesOf({})).toEqual([]);
    expect(textAfterMixedScript('hola', 'body', null)).toBe('hola');
  });
  it('lo no resuelto también se dice', () => {
    expect(mixedScriptNoticesOf({ mixed_script: { unresolved: [{ field: 'body', word: '\u0436abc' }] } })).toHaveLength(1);
  });
});
