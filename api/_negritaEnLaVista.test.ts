import { describe, it, expect } from 'vitest';
import { buildHtml, emphasisToHtml, hasEmphasis, PROVIDERS_WITH_INLINE_EMPHASIS, type ContentPiece } from './_calibrationShared';

/**
 * 2026-10-02 — Sam vio `**texto**` en los copys editoriales de la bandeja y no sabía qué eran. Es
 * la negrita del generador. El blog por API ya la pintaba y el renderizador de blogs no; desde
 * `unrlvl-blog` (rama ccr-c46370b8-vio6sj) los dos la pintan. La bandeja tiene que mostrar lo
 * que publica el CANAL: negrita donde el publicador la pinta, asteriscos y aviso donde no.
 */
const texto = 'Intro.\n\n**Here is the mechanism.** And the rest, rated 4* by readers.';
const pieza = {
  id: 'p1', brand_id: 'MarcaN1', platform: 'canal_bajo_prueba', status: 'awaiting_approval',
  assets: { copy: { title: 'T', aife_filtered: texto } },
} as ContentPiece;

describe('la negrita del generador en la vista previa', () => {
  it('un canal cuyo publicador escribe HTML la muestra en negrita, sin asteriscos', () => {
    for (const provider of PROVIDERS_WITH_INLINE_EMPHASIS) {
      const html = buildHtml(pieza, { provider });
      expect(html).toContain('<strong>Here is the mechanism.</strong> And the rest');
      expect(html).not.toContain('**Here');
      expect(html).not.toContain('saldrían visibles');
    }
  });

  it('un canal de texto plano la muestra literal y avisa que saldría así', () => {
    const html = buildHtml(pieza, { provider: 'proveedor_texto_plano' });
    expect(html).toContain('**Here is the mechanism.**');
    expect(html).not.toContain('<strong>Here');
    expect(html).toContain('los ** de este texto saldrían visibles tal cual');
  });

  it('si el canal no se resolvió, texto sin formato y lo dice', () => {
    const html = buildHtml(pieza, { provider: null });
    expect(html).not.toContain('<strong>Here');
    expect(html).toContain('No se pudo resolver el canal');
  });

  it('sin `**` en el texto no hay aviso, sea cual sea el canal', () => {
    const limpio = { ...pieza, assets: { copy: { title: 'T', aife_filtered: 'Plain text, 5 * 3.' } } } as ContentPiece;
    expect(buildHtml(limpio, { provider: 'proveedor_texto_plano' })).not.toContain('⚠ Este canal publica texto plano');
    expect(buildHtml(limpio, {})).not.toContain('No se pudo resolver el canal');
  });

  it('un asterisco suelto es texto; lo de dentro de la negrita sigue escapado', () => {
    expect(emphasisToHtml('5 * 3 and note* and ** alone')).toBe('5 * 3 and note* and ** alone');
    expect(hasEmphasis('5 * 3 and note*')).toBe(false);
    const html = buildHtml(
      { ...pieza, assets: { copy: { aife_filtered: '**<img src=x onerror=alert(1)>** done' } } } as ContentPiece,
      { provider: [...PROVIDERS_WITH_INLINE_EMPHASIS][0] },
    );
    expect(html).toContain('<strong>&lt;img src=x onerror=alert(1)&gt;</strong>');
    expect(html).not.toContain('<img src=x');
  });

  it('la lista enumera proveedores, nunca marcas', () => {
    for (const p of PROVIDERS_WITH_INLINE_EMPHASIS) {
      expect(p).toMatch(/^[a-z]+_[a-z]+$/);
      expect(p.toLowerCase()).not.toMatch(/neurone|forumphs|unrealville|unrlvl|lucien/);
    }
  });
});
