import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { tramosDe, verificarCuerpo, verificarTextoImagen } from './_verificarFormato';
import { overlayMarkupOf } from './_overlayText';
import { subMarkupOf } from './_textStyle';

describe('«Verificar formato» del texto de la imagen (Sam, 2026-10-28, pieza 23698205)', () => {
  it('la bajada de la pieza: resaltado y cursiva en el mismo tramo, sin el espacio antes del punto', () => {
    const r = verificarTextoImagen('El administrador no responde ni civil ni penalmente. *_El contrato sí_ *.', 'bajada');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toBe('El administrador no responde ni civil ni penalmente. El contrato sí.');
    expect(r.emphasis).toEqual(['El contrato sí']);
    expect(r.italic_spans).toEqual(['El contrato sí']);
    expect(r.markup).toBe('El administrador no responde ni civil ni penalmente. *_El contrato sí_*.');
    expect(r.cambios).toContain('Se quitó el espacio antes de un signo de cierre.');
    expect(r.tramos.at(-2)).toEqual({ text: 'El contrato sí', resaltado: true, cursiva: true, sombra: false });
  });

  it('el titular de la pieza sale igual, con sus tramos', () => {
    const r = verificarTextoImagen('*Protegido por ley*. Pero _no de usted_.', 'titular');
    expect(r.ok && r.markup).toBe('*Protegido por ley*. Pero _no de usted_.');
    expect(r.ok && r.cambios).toEqual([]);
    expect(r.ok && r.tramos.map((t) => [t.text, t.resaltado, t.cursiva])).toEqual([
      ['Protegido por ley', true, false], ['. Pero ', false, false], ['no de usted', false, true], ['.', false, false],
    ]);
  });

  it('una marca sin pareja es un error que se dice antes de mandar', () => {
    const r = verificarTextoImagen('Pero *_no de usted*.', 'titular');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/guion bajo/);
  });

  it('las marcas pegadas al texto que marcan', () => {
    const r = verificarTextoImagen('Una * idea * clave', 'titular');
    expect(r.ok && r.markup).toBe('Una *idea* clave');
  });

  it('la bajada vacía es válida: no lleva bajada', () => {
    const r = verificarTextoImagen('   ', 'bajada');
    expect(r.ok && r.text).toBe('');
  });

  it('tramosDe parte el texto por lo que lleva cada trozo', () => {
    expect(tramosDe('abc', [], ['b'], [])).toEqual([
      { text: 'a', resaltado: false, cursiva: false, sombra: false },
      { text: 'b', resaltado: false, cursiva: false, sombra: true },
      { text: 'c', resaltado: false, cursiva: false, sombra: false },
    ]);
  });
});

describe('al reabrir el editor, las marcas se anidan y no se cruzan', () => {
  it('resaltado y cursiva en el mismo tramo vuelven como se escribieron', () => {
    expect(overlayMarkupOf('El contrato sí.', ['El contrato sí'], [], ['El contrato sí'])).toBe('*_El contrato sí_*.');
    expect(subMarkupOf('a b c', { sub: { emphasis: ['b c'], italic_spans: ['b'] } } as any)).toBe('a *_b_ c*');
    // Dos tramos que de verdad se cruzan siguen cruzados: eso sí lo escribió así quien escribe.
    expect(overlayMarkupOf('a b c', ['a b'], ['b c'], [])).toBe('*a ~b* c~');
  });
});

describe('«Verificar formato» del cuerpo', () => {
  it('enseña la negrita y la cursiva y avisa de los asteriscos que saldrán tal cual', () => {
    const r = verificarCuerpo('Una *idea* y **algo**.\nPrecio 5 * 3');
    expect(r.html).toContain('<em>idea</em>');
    expect(r.html).toContain('<strong>algo</strong>');
    expect(r.avisos[0]).toMatch(/asteriscos que no forman/);
    expect(r.avisos[1]).toMatch(/en las redes saldrían con los asteriscos/);
  });

  it('el texto sigue escapado', () => {
    expect(verificarCuerpo('<b>x</b> *y*').html).toBe('&lt;b&gt;x&lt;/b&gt; <em>y</em>');
  });
});

describe('el cableado', () => {
  const MOD = readFileSync(new URL('../src/modules/iid/pieceActions.tsx', import.meta.url), 'utf8');
  it('el envío usa lo mismo que el botón, y el botón «Cursiva» se retiró', () => {
    expect(MOD).toContain("const parsed = verificarTextoImagen(overlayMarkup, 'titular');");
    expect(MOD).toContain("const subP = verificarTextoImagen(overlaySub, 'bajada');");
    expect(MOD).toContain("const subP = verificarTextoImagen(slideDraft.subheadline, 'bajada');");
    expect(MOD).not.toMatch(/BotonCursiva|alternarCursiva/);
    expect(MOD.match(/<CampoConVerificacion /g)?.length).toBe(3);
    expect(MOD).toContain('<VerificarCuerpo valor={note} />');
  });
});
