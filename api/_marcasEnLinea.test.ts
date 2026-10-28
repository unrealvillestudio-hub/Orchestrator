import { describe, it, expect } from 'vitest';
import { hasInlineMarks, inlineMarksToHtml, stripInlineMarks } from './_marcasEnLinea.js';
import { editorialToHtml } from './_calibrationShared.js';
import { articleBodyHtml, articleBodyText } from './_manualShared.js';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

describe('la cursiva del cuerpo (Sam, 2026-10-28): `*así*` → <em>, la misma regla en las tres puntas', () => {
  it('pinta la cursiva y la anida con la negrita en los dos sentidos', () => {
    expect(inlineMarksToHtml('Una *idea* aquí')).toBe('Una <em>idea</em> aquí');
    expect(inlineMarksToHtml('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
    expect(inlineMarksToHtml('*a **b** c*')).toBe('<em>a <strong>b</strong> c</em>');
    expect(inlineMarksToHtml('**sólo negrita**')).toBe('<strong>sólo negrita</strong>');
  });

  it('un asterisco suelto o pegado a una palabra es texto', () => {
    for (const t of ['Rated 4* by readers.', '5 * 3', 'a*b*c', 'acción*x*', '* con espacio *', '** alone **']) {
      expect(inlineMarksToHtml(t)).toBe(t);
      expect(hasInlineMarks(t)).toBe(false);
    }
  });

  it('el texto plano y el subtítulo van sin marcas', () => {
    expect(stripInlineMarks('Una *idea* y **algo**')).toBe('Una idea y algo');
    expect(hasInlineMarks('Una *idea*')).toBe(true);
    const html = editorialToHtml('## Un *subtítulo*\n\nUno con *cursiva*.', esc);
    expect(html).toContain('<h2 class="sec">Un subtítulo</h2>');
    expect(html).toContain('<p>Uno con <em>cursiva</em>.</p>');
  });

  it('el artículo de la pestaña Manual la pinta en HTML y la quita en el texto plano', () => {
    expect(articleBodyHtml('Uno con *cursiva* y **negrita**.', null, [], 'imagen'))
      .toContain('Uno con <em>cursiva</em> y <strong>negrita</strong>.');
    expect(articleBodyText('> Una *cita*\n\nUno con *cursiva*.')).toBe('Una cita\n\nUno con cursiva.');
  });

  it('lo que va dentro sigue escapado', () => {
    expect(inlineMarksToHtml(esc('*<img src=x onerror=alert(1)>*'))).toBe('<em>&lt;img src=x onerror=alert(1)&gt;</em>');
  });
});
