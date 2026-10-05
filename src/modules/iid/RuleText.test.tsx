import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RuleText, RuleChip, RuleTextsProvider, type RuleTexts } from './RuleText';
import { AutofixNotice, WatcherBadge } from './pieceUi';

/**
 * 2026-10-05 — CHIP DE REGLA en la tarjeta. Un código con enunciado para la marca de la pieza es un
 * botón (teclado y toque); uno sin enunciado —de otra marca, o un pseudo-código— queda como texto.
 */
const TEXTS: RuleTexts = {
  'HR-AAA-05': { statement: 'Primera frase de la regla. Segunda frase.', severity: 'blocking' },
  'HR-GEN-01': { statement: 'Regla general.', severity: 'warn' },
};
const html = (node: React.ReactNode) => renderToStaticMarkup(<RuleTextsProvider value={TEXTS}>{node}</RuleTextsProvider>);
const botones = (h: string) => (h.match(/<button[^>]*>([^<]*)<\/button>/g) ?? []).map((b) => b.replace(/<[^>]+>/g, ''));

describe('RuleText en la tarjeta', () => {
  it('cada código con enunciado es un botón; el resto del texto queda igual', () => {
    const h = html(<RuleText text="corrigió HR-AAA-05, HR-GEN-01 y nada más" />);
    expect(botones(h)).toEqual(['HR-AAA-05', 'HR-GEN-01']);
    expect(h.replace(/<[^>]+>/g, '')).toBe('corrigió HR-AAA-05, HR-GEN-01 y nada más');
    expect(h).toContain('type="button"');
    expect(h).toContain('aria-label="HR-AAA-05: ver el enunciado de la regla"');
  });

  it('un código sin enunciado para esta pieza (otra marca) es texto, no chip', () => {
    const h = html(<RuleText text="HR-OTRA-01 y HR-AAA-05" />);
    expect(botones(h)).toEqual(['HR-AAA-05']);
    expect(h).toContain('HR-OTRA-01');
  });

  it('FIXABLE-PROPUESTA nunca es chip, aunque alguien le pusiera enunciado', () => {
    const h = renderToStaticMarkup(
      <RuleTextsProvider value={{ ...TEXTS, 'FIXABLE-PROPUESTA': { statement: 'x', severity: null } }}>
        <RuleText text="resolvió FIXABLE-PROPUESTA" />
      </RuleTextsProvider>);
    expect(botones(h)).toEqual([]);
  });

  it('sin proveedor (un server anterior), todo es texto', () => {
    expect(botones(renderToStaticMarkup(<RuleChip code="HR-AAA-05" />))).toEqual([]);
  });

  it('el enunciado no se pinta hasta que se pide: la tarjeta no crece', () => {
    expect(html(<RuleText text="HR-AAA-05" />)).not.toContain('Primera frase');
  });

  it('WatcherBadge y AutofixNotice pintan sus códigos como chips', () => {
    const w = html(<WatcherBadge verdict="REJECT" failedRules={['HR-AAA-05', 'HR-OTRA-01']} reason="incumplió HR-AAA-05" />);
    expect(botones(w)).toEqual(['HR-AAA-05', 'HR-AAA-05']);
    expect(w.replace(/<[^>]+>/g, '')).toContain('· HR-AAA-05, HR-OTRA-01');
    const a = html(<AutofixNotice autofix={{ outcome: 'residual', attempts: 1, resolved: ['HR-AAA-05'], residual: ['HR-GEN-01'], cost_usd: null }} reason="motivo FIXABLE-PROPUESTA" />);
    expect(botones(a)).toEqual(['HR-AAA-05', 'HR-GEN-01']);
  });
});
