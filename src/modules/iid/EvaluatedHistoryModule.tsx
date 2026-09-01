import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { RefreshCw, Inbox, AlertTriangle, Archive, ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import { renderArtifact, CalibrationError } from '../../services/calibrationInbox';
import {
  fetchEvaluatedHistory,
  type EvaluatedRow, type EvaluatedHistoryResult, type HistorySourceFilter,
} from '../../services/evaluatedHistory';
import { CountPill, Selector, Pager, CopyableId, fmtDate } from './pieceUi';
// Lectura en voz alta. Mismo componente y mismo adaptador que las otras tres bandejas.
import { SpeechReader } from '../../ui/SpeechReader';
import { readableFromArtifactHtml } from './readablePiece';

const PAGE = 50;

/**
 * EvaluatedHistoryModule — HISTORIAL DE PIEZAS EVALUADAS (BRIEF-02).
 *
 * EL DEFECTO QUE CIERRA, y lo que decide el diseño: una pieza calibrada desaparecía de la
 * bandeja y no había forma de volver a verla ni de NOMBRARLA. Por eso el `piece_id` es
 * copiable en cada fila y no está escondido en el detalle: encontrar una pieza y poder
 * señalarla es la operación que este tab existe para permitir.
 *
 * SÓLO LECTURA, sin excepción. Ni un botón de acción: no aprueba, no rechaza, no descarta y
 * no edita. Lo que se decidió, decidido está — este tab mira.
 *
 * ── LAS DOS GENERACIONES NO SE MEZCLAN EN SILENCIO ───────────────────────────
 * El historial junta el corpus vivo y el archivado, y lo archivado es de una generación
 * anterior a su corte. Por eso el filtro de origen y el distintivo de «archivada» NO son
 * adornos: sin ellos este tab reintroduce exactamente la confusión que el archivado vino a
 * resolver. La razón del archivado se muestra en la fila abierta, no en un tooltip.
 *
 * ── MULTIMARCA ───────────────────────────────────────────────────────────────
 * Ninguna marca, canal ni veredicto aparece en este archivo. Las tres facetas se DESCUBREN
 * de `by_brand` / `by_channel` / `by_verdict`, que el server cuenta sobre el dato. Un
 * veredicto que este código no conozca se muestra tal cual, nunca se descarta.
 */
export default function EvaluatedHistoryModule({ session }: { session: IidSession }) {
  const token = session.session_token;

  const [data, setData]       = useState<EvaluatedHistoryResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [from, setFrom]       = useState('');
  const [to, setTo]           = useState('');
  const [brand, setBrand]     = useState('');
  const [channel, setChannel] = useState('');
  const [verdict, setVerdict] = useState('');
  const [source, setSource]   = useState<HistorySourceFilter>('all');
  const [offset, setOffset]   = useState(0);
  const [open, setOpen]       = useState<string | null>(null);

  type Query = {
    offset: number; from: string; to: string;
    brand: string; channel: string; verdict: string; source: HistorySourceFilter;
  };
  const current = (): Query => ({ offset, from, to, brand, channel, verdict, source });

  /**
   * Los `<input type="date">` dan un día suelto, y el corpus guarda un instante. Se abre el
   * día por los dos extremos: sin esto, filtrar «hasta el 22» dejaría fuera todo lo evaluado
   * ese mismo 22 después de medianoche — un rango que miente por un detalle de formato.
   */
  const desdeIso = (d: string) => (d ? new Date(`${d}T00:00:00.000Z`).toISOString() : undefined);
  const hastaIso = (d: string) => (d ? new Date(`${d}T23:59:59.999Z`).toISOString() : undefined);

  const load = async (q: Query) => {
    setLoading(true); setError(null);
    try {
      setData(await fetchEvaluatedHistory(token, {
        limit: PAGE,
        offset: q.offset,
        from: desdeIso(q.from),
        to: hastaIso(q.to),
        brand: q.brand || undefined,
        channel: q.channel || undefined,
        verdict: q.verdict || undefined,
        source: q.source,
      }));
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar el historial.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(current()); /* eslint-disable-next-line */ }, []);

  // Todo cambio de filtro vuelve a la primera página y cierra la fila abierta: el offset
  // viejo no significa lo mismo sobre un conjunto distinto.
  const apply = (patch: Partial<Query>) => {
    const q = { ...current(), offset: 0, ...patch };
    setOffset(q.offset); setFrom(q.from); setTo(q.to);
    setBrand(q.brand); setChannel(q.channel); setVerdict(q.verdict); setSource(q.source);
    setOpen(null);
    load(q);
  };
  const goPage = (o: number) => { setOffset(o); setOpen(null); load({ ...current(), offset: o }); };

  const total     = data?.total ?? 0;
  const byBrand   = data?.by_brand ?? {};
  const byChannel = data?.by_channel ?? {};
  const byVerdict = data?.by_verdict ?? {};
  const rows      = data?.rows ?? [];
  // Marcas, canales y veredictos se DESCUBREN del dato; ninguna lista vive en este archivo.
  const brands   = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const channels = useMemo(() => Object.keys(byChannel).sort(), [byChannel]);
  const verdicts = useMemo(() => Object.keys(byVerdict).sort(), [byVerdict]);

  const limpiar = () => apply({ from: '', to: '', brand: '', channel: '', verdict: '', source: 'all' });
  const hayFiltro = Boolean(from || to || brand || channel || verdict || source !== 'all');

  return (
    <div className="max-w-5xl mx-auto px-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h3 className="font-display text-lg font-bold text-white">Historial de evaluadas</h3>
          <p className="text-sm text-zinc-500 mt-0.5">
            Las piezas que ya pasaron por la bandeja, con su veredicto y su nota.
            <span className="text-zinc-400"> Sólo lectura</span> — el id de cada pieza se copia de un clic.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[11px] font-mono px-2 py-1 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-400">
            {total} pieza{total === 1 ? '' : 's'}
          </span>
          <button
            onClick={() => load(current())}
            className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400"
            title="Refrescar"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Rango de fechas + origen. El origen es el eje de generación de este tab. */}
      <div className="flex items-end gap-4 flex-wrap mb-3">
        <label className="flex flex-col gap-1 text-[10px] font-mono text-zinc-600">
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => apply({ from: e.target.value })}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12px] text-zinc-300"
          />
        </label>
        <label className="flex flex-col gap-1 text-[10px] font-mono text-zinc-600">
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => apply({ to: e.target.value })}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[12px] text-zinc-300"
          />
        </label>
        <div className="pb-1">
          <Selector
            label="Origen"
            value={source}
            onChange={(v) => apply({ source: v as HistorySourceFilter })}
            options={[['all', 'Todas'], ['live', 'Corpus vivo'], ['archived', 'Archivadas']]}
          />
        </div>
        {hayFiltro && (
          <button
            onClick={limpiar}
            className="pb-1.5 text-[11px] font-mono text-zinc-600 hover:text-zinc-300 transition-colors"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {/* Facetas — las tres se descubren del dato */}
      {brands.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2">
          <CountPill label="Todas las marcas" count={Object.values(byBrand).reduce((a, b) => a + b, 0)} active={brand === ''} onClick={() => apply({ brand: '' })} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply({ brand: b })} />
          ))}
        </div>
      )}
      {channels.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2">
          <CountPill label="Todos los canales" count={Object.values(byChannel).reduce((a, b) => a + b, 0)} active={channel === ''} onClick={() => apply({ channel: '' })} />
          {channels.map((c) => (
            <CountPill key={c} label={c} count={byChannel[c]} active={channel === c} onClick={() => apply({ channel: c })} />
          ))}
        </div>
      )}
      {verdicts.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-5">
          <CountPill label="Todos los veredictos" count={Object.values(byVerdict).reduce((a, b) => a + b, 0)} active={verdict === ''} onClick={() => apply({ verdict: '' })} />
          {verdicts.map((v) => (
            <CountPill key={v} label={v} count={byVerdict[v]} active={verdict === v} onClick={() => apply({ verdict: v })} />
          ))}
        </div>
      )}

      {/* El historial pudo quedar truncado. Se dice: uno truncado en silencio parece completo. */}
      {data?.truncated && (
        <div className="flex items-start gap-2 text-[12px] text-amber-300/90 bg-amber-500/[0.06] border border-amber-500/25 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">
            La lectura llegó al tope del server: el historial puede estar incompleto. Acotar el rango de fechas lo resuelve.
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[12px] text-rose-400/90 bg-rose-500/[0.06] border border-rose-500/20 rounded-xl px-3 py-2 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="leading-snug">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-zinc-700"><Spinner size={22} /></div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-zinc-700 gap-3">
          <Inbox size={26} />
          <p className="text-sm text-zinc-600">
            {hayFiltro ? 'Ninguna pieza evaluada con esos filtros.' : 'Todavía no hay piezas evaluadas.'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <HistoryRow
              key={`${r.source}:${r.piece_id}`}
              row={r}
              token={token}
              open={open === `${r.source}:${r.piece_id}`}
              onToggle={() => setOpen(open === `${r.source}:${r.piece_id}` ? null : `${r.source}:${r.piece_id}`)}
            />
          ))}
        </div>
      )}

      <Pager offset={offset} pageSize={PAGE} total={total} loading={loading} onGo={goPage} />
    </div>
  );
}

// ── Una fila del historial ───────────────────────────────────────────────────────

function HistoryRow({ row, token, open, onToggle }: {
  row: EvaluatedRow; token: string; open: boolean; onToggle: () => void;
}) {
  const [artHtml, setArtHtml] = useState<string | null>(null);
  const [artErr, setArtErr]   = useState<string | null>(null);

  // El artefacto se pide SÓLO al abrir la fila: `preview-render` es idempotente y lo
  // reconstruye desde la pieza, así que no hace falta que el HTML viejo siga en el CDN — pero
  // pedirlo para las cincuenta filas de la página sería cincuenta renders que nadie mira.
  useEffect(() => {
    if (!open || artHtml !== null || artErr !== null) return;
    let alive = true;
    renderArtifact(token, row.piece_id)
      .then((r) => { if (alive) setArtHtml(r.html); })
      .catch((err) => { if (alive) setArtErr(err instanceof CalibrationError ? err.message : 'No se pudo renderizar el artefacto.'); });
    return () => { alive = false; };
  }, [open, row.piece_id, token, artHtml, artErr]);

  const readable = useMemo(() => (artHtml ? readableFromArtifactHtml(artHtml) : null), [artHtml]);
  const archivada = row.source === 'archived';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
      className={cn(
        'rounded-xl border transition-colors',
        archivada ? 'border-zinc-800/70 bg-zinc-900/30' : 'border-zinc-800 bg-zinc-900/60',
      )}
    >
      {/* La fila cerrada tiene que bastar para ENCONTRAR y NOMBRAR una pieza. */}
      <div className="flex items-center gap-3 flex-wrap px-3 py-2.5">
        <button
          onClick={onToggle}
          className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-200 transition-colors shrink-0"
          title={open ? 'Cerrar' : 'Ver la pieza'}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Eye size={13} />
        </button>

        <span className="text-[11px] font-mono text-zinc-600 shrink-0">{fmtDate(row.created_at)}</span>
        <span className="text-[11px] font-mono text-zinc-400 shrink-0">{row.brand_id}</span>
        {row.platform && <span className="text-[11px] font-mono text-zinc-600 shrink-0">{row.platform}</span>}

        {/* El veredicto se muestra TAL COMO está guardado: uno que este código no conozca
            aparece igual, en neutro, en vez de desaparecer del historial. */}
        <VerdictTag verdict={row.verdict} />

        {archivada && (
          <span
            className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 border border-zinc-700 text-zinc-400 shrink-0"
            title="De una generación anterior a su corte de archivado"
          >
            <Archive size={10} /> archivada
          </span>
        )}

        <div className="ml-auto shrink-0">
          <CopyableId id={row.piece_id} title="id de la pieza" />
        </div>
      </div>

      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-zinc-800/60 pt-3">
          {/* Lo que Sam decidió, y por qué */}
          <div className="grid gap-2 text-[12px] leading-relaxed">
            {row.criterion && (
              <p className="text-zinc-300"><span className="text-zinc-600 font-mono text-[10px] uppercase tracking-wider">Criterio </span>{row.criterion}</p>
            )}
            {row.fix_proposal && (
              <p className="text-sky-300/90"><span className="text-zinc-600 font-mono text-[10px] uppercase tracking-wider">Propuesta </span>{row.fix_proposal}</p>
            )}
            {archivada && row.archived_reason && (
              <p className="text-zinc-400">
                <span className="text-zinc-600 font-mono text-[10px] uppercase tracking-wider">Archivada </span>
                {row.archived_reason}
                {row.archived_at && <span className="text-zinc-600"> · {fmtDate(row.archived_at)}</span>}
              </p>
            )}
            <p className="text-[10px] font-mono text-zinc-600">
              evaluó {row.evaluated_by ?? 'sin registrar'}
              {row.voice && <> · voz {row.voice}</>}
              {row.watcher_result && <> · watcher {row.watcher_result}{row.watcher_gate ? ` (${row.watcher_gate})` : ''}</>}
            </p>
          </div>

          {/* El artefacto, reconstruido bajo demanda */}
          <div className="rounded-xl overflow-hidden border border-zinc-800 bg-[#050508]">
            {artErr ? (
              <div className="p-4 text-[11px] text-rose-400/90 font-mono flex items-center gap-2">
                <AlertTriangle size={13} /> {artErr}
              </div>
            ) : artHtml === null ? (
              <div className="flex items-center justify-center py-16 text-zinc-700"><Spinner size={18} /></div>
            ) : (
              <iframe
                srcDoc={artHtml}
                title={`preview-${row.piece_id}`}
                sandbox=""
                className="w-full"
                style={{ height: 420, border: 'none', background: '#050508' }}
              />
            )}
          </div>

          {readable && <SpeechReader piece={readable} suggestedLang={row.reading_language} />}

          {row.artifact_url && (
            <a href={row.artifact_url} target="_blank" rel="noopener noreferrer"
               className="block text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors truncate">
              {row.artifact_url}
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}

/**
 * El veredicto, pintado. Los colores son de PRESENTACIÓN y sólo cubren los que hoy existen;
 * cualquier otro cae en neutro y SE MUESTRA IGUAL. Un historial que esconde lo que no
 * reconoce es peor que uno feo: pierde filas sin avisar.
 */
function VerdictTag({ verdict }: { verdict: string }) {
  const tono = verdict === 'approved'
    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
    : verdict === 'rejected'
      ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
      : verdict === 'fixable'
        ? 'bg-sky-500/10 border-sky-500/30 text-sky-300'
        : 'bg-zinc-800 border-zinc-700 text-zinc-300';
  return (
    <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0', tono)}>
      {verdict || 'sin veredicto'}
    </span>
  );
}
