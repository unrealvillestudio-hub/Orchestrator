import type { ReadablePiece } from '../../ui/SpeechReader';
import { shortId, type TopicSeed } from '../../services/iidInbound';

/**
 * Adaptadores de «Investigaciones» a la forma que lee `SpeechReader` (`{title, body}` en texto plano).
 *
 * Sam, 2026-10-20: «Necesito que le incluyas a cada panel de lectura de los hallazgos incluyendo Memo
 * completo el tts como está en calibración». El lector es el mismo componente de Calibración; aquí sólo
 * vive la traducción de un resultado a texto que se pueda escuchar: sin URLs, sin marcas de formato y sin
 * la lista de fuentes del final del memo, que en voz alta es ruido.
 */

const SECCION_FUENTES = /\n-{3,}\s*\nFUENTES CONSULTADAS:[\s\S]*$/;

/** Texto plano de un memo: sin la lista de fuentes, sin markdown, sin URLs sueltas. */
export function memoParaLeer(memo: string | null | undefined): string {
  return String(memo ?? '')
    .replace(SECCION_FUENTES, '')
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, '$1') // [texto](url) → texto
    .replace(/https?:\/\/\S+/g, '')                          // URL suelta
    .replace(/^#{1,6}\s*/gm, '')                             // encabezados
    .replace(/(\*\*|__|`)/g, '')                             // negrita, código
    .replace(/^\s*[-*•]\s+/gm, '')                           // viñetas
    .replace(/^\s*-{3,}\s*$/gm, '')                          // reglas horizontales
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** El panel del resultado: resumen, dominio y hallazgos, en el orden en que se leen en pantalla. */
export function lecturaDelResultado(seed: TopicSeed): ReadablePiece | null {
  const r = seed.research;
  if (!r) return null;
  const partes: string[] = [];
  if (r.resumen) partes.push(r.resumen);
  const d = r.dominio;
  if (d?.encaja_en) partes.push(`Dominio: cabe en ${d.encaja_en.replace(/-/g, ' ')}.`);
  else if (d?.propuesto) partes.push(`Dominio nuevo propuesto: ${d.propuesto.nombre}.`);
  if (d?.por_que) partes.push(d.por_que);
  if (r.hallazgos.length) {
    partes.push('Hallazgos.');
    r.hallazgos.forEach((h, i) => partes.push(`${i + 1}. ${h.afirmacion}`));
  }
  const body = partes.join('\n').trim();
  return body ? { title: `Investigación ${shortId(seed.id)}. ${seed.raw_signal}`, body } : null;
}

/** El memo completo. */
export function lecturaDelMemo(seed: TopicSeed): ReadablePiece | null {
  const body = memoParaLeer(seed.research?.memo);
  return body ? { title: `Memo de la investigación ${shortId(seed.id)}`, body } : null;
}
