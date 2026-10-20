import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shortId, type TopicSeed } from '../../services/iidInbound';
import { memoParaLeer, lecturaDelResultado, lecturaDelMemo } from './readableTopic';

/**
 * SEEDS DE TEMA E «INVESTIGACIONES» (Sam, 2026-10-20).
 *
 * Lo que este test fija, leyendo las fuentes que se compilan:
 *   1 · «Hallazgos» se fue: IID Intel no vuelve a leer `intel.iid_findings` con la clave anónima (sin
 *       permiso, por decisión de Sam) ni a tragarse el error de esa lectura;
 *   2 · «Investigaciones» lee por `iid-inbound` con la sesión y muestra el fallo como fallo;
 *   3 · la vista es de sólo lectura: las decisiones se toman y se ejecutan en sesión, sin botones;
 *   4 · el ID corto es el mismo en el formulario y en la vista;
 *   5 · cero marcas en las tres piezas (marca N+1).
 */
const MOD = readFileSync(new URL('./EcosystemIntelModule.tsx', import.meta.url), 'utf8');
const VIEW = readFileSync(new URL('./InvestigacionesView.tsx', import.meta.url), 'utf8');
const FORM = readFileSync(new URL('../iid/IidTopicCapture.tsx', import.meta.url), 'utf8');
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('IID Intel sin «Hallazgos»', () => {
  it('no lee iid_findings con la clave anónima', () => {
    for (const src of [MOD, VIEW]) {
      expect(sinComentarios(src)).not.toMatch(/rest\/v1\/iid_findings/);
      expect(sinComentarios(src)).not.toMatch(/VITE_SUPABASE_ANON_KEY/);
    }
  });
  it('las bandas Top / Watchlist / Descartados ya no existen', () => {
    expect(sinComentarios(MOD)).not.toMatch(/watchlist|discarded|FindingsView/i);
  });
});

describe('«Investigaciones» y el formulario de tema', () => {
  it('la vista lee con la sesión por iid-inbound y pinta el error', () => {
    expect(VIEW).toContain('listTopics(session.session_token)');
    expect(VIEW).toContain('setError(');
  });
  it('el formulario propone el tema por iid-inbound', () => {
    expect(FORM).toContain('captureTopic(session.session_token');
  });
  it('la vista no tiene acciones: ni publicar, ni aprobar, ni activar dominios', () => {
    const code = sinComentarios(VIEW);
    expect(code).not.toMatch(/approve|publish|capture_topic|captureTopic|fetch\(/i);
    // Los únicos botones abren o cierran, o refrescan.
    const handlers = code.match(/onClick=\{[^}]*\}/g) ?? [];
    for (const h of handlers) expect(h).toMatch(/setOpen|setMemo|load/);
  });
  it('el ID corto son los 8 primeros caracteres, igual en formulario y vista', () => {
    expect(shortId('7d74fdd1-aaaa-bbbb-cccc-000000000000')).toBe('7d74fdd1');
    expect(FORM).toContain('shortId(done.id)');
    expect(VIEW).toContain('shortId(seed.id)');
  });
  it('cero marcas en las tres piezas', () => {
    for (const src of [MOD, VIEW, FORM])
      for (const m of ['NeuroneSCF', 'ForumPHs', 'LucienSael', 'UnrealvilleStudio', 'Patricia'])
        expect(src).not.toContain(m);
  });
});

describe('lectura en voz alta del resultado y del memo (Sam, 2026-10-20)', () => {
  const seed = {
    id: '9a55e66d-0000-0000-0000-000000000000', raw_signal: 'Un tema de prueba', seeder_rationale: null,
    mapped_brand_id: 'MarcaInventada', captured_by: 'sam', status: 'researched', researched_at: null,
    failures: 0, last_error: null, created_at: '', updated_at: '',
    research: {
      memo: '# Memo\n\n**Clave:** un dato [con enlace](https://a.org/x) y https://b.org/y suelto.\n\n---\nFUENTES CONSULTADAS:\n- A — https://a.org/x',
      fuentes: [], agente: 'AG', stop_reason: 'end_turn', truncado: false, resumen: 'Lo esencial.',
      hallazgos: [{ afirmacion: 'Primera afirmación', fuente: 'https://a.org/x' }],
      dominio: { encaja_en: 'ai-cognition', propuesto: null, por_que: 'Cabe.' }, resumen_error: null,
    },
  } as unknown as TopicSeed;

  it('el memo se lee sin la lista de fuentes, sin URLs y sin marcas de formato', () => {
    const t = memoParaLeer(seed.research!.memo);
    expect(t).toContain('Clave: un dato con enlace');
    expect(t).not.toMatch(/https?:\/\//);
    expect(t).not.toMatch(/FUENTES CONSULTADAS|\*\*|^#/m);
  });
  it('el resultado se lee con resumen, dominio y hallazgos, sin URLs', () => {
    const r = lecturaDelResultado(seed)!;
    expect(r.title).toContain('9a55e66d');
    const body = String(r.body);
    expect(body).toContain('Lo esencial.');
    expect(body).toContain('cabe en ai cognition');
    expect(body).toContain('1. Primera afirmación');
    expect(body).not.toMatch(/https?:\/\//);
    expect(String(lecturaDelMemo(seed)?.body ?? '').length).toBeGreaterThan(0);
  });
  it('sin resultado no hay lector', () => {
    expect(lecturaDelResultado({ ...seed, research: null })).toBeNull();
    expect(lecturaDelMemo({ ...seed, research: null })).toBeNull();
  });
  it('la vista monta el mismo SpeechReader de Calibración para el resultado y el memo', () => {
    expect(VIEW).toContain("import { SpeechReader } from '../../ui/SpeechReader'");
    expect(VIEW).toContain('<SpeechReader piece={lecturaResultado} suggestedLang="es" />');
    expect(VIEW).toMatch(/<SpeechReader piece=\{lecturaMemo\} suggestedLang="en"/);
  });
});
