/**
 * RUEDA, RELOJ, «FIJAR» Y ROL EN VARIAS LÍNEAS (Sam, 2026-11-18): «hacer scroll con el mouse sobre el preview y moverme
 * cuadro a cuadro, el reloj al lado del check de zonas; lo mismo con el zoom»; «el "fijar" en la parte superior»;
 * «poder aplicar "siguiente línea" en los roles».
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { pasoDeRueda, relojDe, FPS_POR_DEFECTO } from '../src/modules/iid/TextoVisual';
import { valorPorRueda } from '../src/modules/iid/OnScreenTextEditor';
import { validateTextLayers, groupPresets, type PresetsByLayer } from './_pieceText';

describe('la rueda sobre la vista: cuadro a cuadro', () => {
  it('un golpe = un cuadro; hacia delante si la rueda baja', () => {
    expect(pasoDeRueda(100, 30)).toBeCloseTo(1 / 30);
    expect(pasoDeRueda(-3, 25)).toBeCloseTo(-1 / 25);
    expect(pasoDeRueda(0, 30)).toBe(0);
    expect(pasoDeRueda(100, 0)).toBeCloseTo(1 / FPS_POR_DEFECTO);
  });
  it('el reloj dice segundos con dos decimales y el cuadro', () => {
    expect(relojDe(2.1, 30)).toBe('2.10 s · c 63');
    expect(relojDe(Number.NaN, 30)).toBe('0.00 s · c 0');
  });
});

describe('la rueda sobre un deslizador: paso a paso, dentro del rango', () => {
  it('sube un paso si la rueda sube, baja si baja, y no sale del rango', () => {
    expect(valorPorRueda(1, -100, 0.05, 0.7, 1.3)).toBeCloseTo(1.05);
    expect(valorPorRueda(1, 100, 0.05, 0.7, 1.3)).toBeCloseTo(0.95);
    expect(valorPorRueda(1.3, -100, 0.05, 0.7, 1.3)).toBeCloseTo(1.3);
    expect(valorPorRueda(0.7, 100, 0.05, 0.7, 1.3)).toBeCloseTo(0.7);
    expect(valorPorRueda(1, 0, 0.05, 0.7, 1.3)).toBe(1);
  });
});

describe('el rol en varias líneas', () => {
  it('el salto de línea viaja hasta VideoLab (que lo respeta en wrapText)', () => {
    const presets = groupPresets([{ preset_key: 'r1', layer: 'role', name: 'R1', brand_id: null, status: 'proposed', spec: {} }], 'MarcaA') as PresetsByLayer;
    const pid = '11111111-1111-4111-8111-111111111111';
    const v = validateTextLayers({ hook: null, roles: [{ person_id: pid, text: 'Nombre Apellido\nCargo de la persona', show: true, at_ms: 0, dur_ms: 3000, preset_key: 'r1' }],
      captions: null, key_titles: [], cta: null, identity: { strip: false, identity_role: null } } as any,
      { presets, accentRoles: [], stripRoles: [], durationMs: 60000, castIds: [pid] });
    expect(v.ok && v.value.roles[0].text).toBe('Nombre Apellido\nCargo de la persona');
  });
  it('el rótulo es un área de texto de varias líneas', () => {
    const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
    expect(editor).toMatch(/<textarea value=\{r\.text\} onChange=\{\(e\) => upd\(\{ text: e\.target\.value \}\)\} aria-label=\{`Rótulo de \$\{r\.name\}`\}/);
  });
});

describe('el cableado en la tarjeta', () => {
  const editor = readFileSync('src/modules/iid/OnScreenTextEditor.tsx', 'utf8');
  const visual = readFileSync('src/modules/iid/TextoVisual.tsx', 'utf8');
  it('la vista de la tarjeta lleva reloj y rueda, y «Fijar» arriba; fijar empieza suelto', () => {
    // 2026-11-18: entre `reloj` y `esquinaArriba` entra `controlesArriba` (capa «Plataforma»); lo que fija no cambia.
    expect(editor).toMatch(/\n\s*reloj\n(\s*controlesArriba=\{[^\n]*\}\n)?\s*esquinaArriba=\{/);
    // 2026-11-18: el estado de «Fijar» pasa a `vistaFija.ts`, compartido con «Sonido»; sigue empezando suelto.
    expect(editor).toMatch(/const \[tarjetaFija, cambiarTarjetaFija\] = useVistaFija\(\);/);
    expect(readFileSync('src/modules/iid/vistaFija.ts', 'utf8')).toMatch(/getItem\(CLAVE\) === 'si'/);
    expect(visual).toMatch(/\{esquinaArriba && <div className="absolute top-1\.5 right-1\.5 z-30">/);
    expect(visual).toMatch(/\{reloj && <Reloj video=\{video\} fps=\{fps\} \/>\}/);
  });
  it('la rueda no desplaza la página (listener nativo con passive: false)', () => {
    expect(visual).toMatch(/addEventListener\('wheel', h, \{ passive: false \}\)/);
  });
  it('el deslizador acepta la rueda', () => {
    expect(editor).toMatch(/<input ref=\{conRueda\} type="range"/);
  });
});

describe('la barra de reproducción, arriba de la franja (Sam, 2026-11-18)', () => {
  it('en la tarjeta va primero, justo debajo del video; después la leyenda y las notas', () => {
    const visual = readFileSync('src/modules/iid/TextoVisual.tsx', 'utf8');
    expect(visual).toMatch(/const pie = <div className="space-y-1\.5" data-pie-vista>\{barra\}\{abajo\}\{resto\}<\/div>;/);
  });
});
