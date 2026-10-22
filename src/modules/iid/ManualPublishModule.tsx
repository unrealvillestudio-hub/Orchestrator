import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Inbox, AlertTriangle, Copy, Check, Download, CheckCircle2, ExternalLink } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import {
  fetchManualQueue, markManualPublished, CalibrationError,
  type ManualItem, type ManualQueueResult, type ManualArticle,
} from '../../services/publishInbox';
import { CountPill, fmtInZone, DayPicker } from './pieceUi';
import { fetchWithTimeout } from '../../services/fetchWithTimeout';

/**
 * ManualPublishModule — pestaña «Manual» dentro de Publicación (Sam, 2026-10-01).
 *
 * Lo que hay que publicar a mano, con todo lo necesario para hacerlo y nada más: las fotos con su
 * URL y UN bloque de texto —título, cuerpo, hashtags y firma juntos— listo para copiar y pegar.
 * Filtrable por marca y por canal; los dos filtros salen del dato, ninguna lista vive aquí. Y por
 * día de salida (2026-10-21), en el reloj de cada marca.
 *
 * «Publicada» (Sam, 2026-10-01): con el link del post como prueba, marca la franja y la pieza
 * publicadas, deja la fila en la bitácora del drenaje y cierra el aviso. La tarjeta sale de la lista.
 *
 * ARTÍCULO (Sam, 2026-10-22): el editor de artículos pide título, portada y cuerpo en campos
 * distintos, así que la tarjeta de un artículo los entrega por separado, cada uno con su botón. El
 * cuerpo se copia como HTML (los subtítulos llegan como subtítulos) y como texto plano de respaldo.
 * Las imágenes se DESCARGAN de verdad —antes eran enlaces que había que abrir y guardar a mano—.
 */
export default function ManualPublishModule({ session }: { session: IidSession }) {
  const token = session.session_token;
  const [data, setData] = useState<ManualQueueResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [brand, setBrand] = useState('');
  const [channel, setChannel] = useState('');
  const [day, setDay] = useState('');

  const load = async (b: string, c: string, d: string = day) => {
    setLoading(true); setError(null);
    try {
      setData(await fetchManualQueue(token, { brand: b || undefined, channel: c || undefined, day: d || undefined }));
    } catch (err) {
      setError(err instanceof CalibrationError ? err.message : 'No se pudo cargar la lista.');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(brand, channel); /* eslint-disable-next-line */ }, []);

  const apply = (b: string, c: string, d: string = day) => { setBrand(b); setChannel(c); setDay(d); load(b, c, d); };

  // La pieza publicada sale de la lista y de los conteos, sin recargar todo.
  const onPublished = (it: ManualItem) => {
    setData((prev) => {
      if (!prev) return prev;
      const dec = (m: Record<string, number>, k: string) => {
        const n = (m[k] ?? 0) - 1; const out = { ...m }; if (n > 0) out[k] = n; else delete out[k]; return out;
      };
      return {
        ...prev,
        total: Math.max(0, prev.total - 1),
        by_brand: dec(prev.by_brand, it.brand_id),
        by_channel: dec(prev.by_channel, it.platform_key),
        items: prev.items.filter((x) => x.slot_id !== it.slot_id),
      };
    });
  };

  const byBrand = data?.by_brand ?? {};
  const byChannel = data?.by_channel ?? {};
  const brands = useMemo(() => Object.keys(byBrand).sort(), [byBrand]);
  const channels = useMemo(() => Object.keys(byChannel).sort(), [byChannel]);
  const items = data?.items ?? [];
  const sum = (m: Record<string, number>) => Object.values(m).reduce((a, n) => a + n, 0);

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-zinc-500">Piezas de canales que se publican a mano. Copiar, pegar, publicar.</p>
        <div className="text-[11px] font-mono shrink-0"><DayPicker value={day} onChange={(v) => apply(brand, channel, v)} /></div>
        <button
          onClick={() => load(brand, channel)}
          className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-zinc-400 shrink-0"
          title="Refrescar"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {brands.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-2 [&>*]:shrink-0">
          <CountPill label="Todas" count={sum(byBrand)} active={brand === ''} onClick={() => apply('', channel)} />
          {brands.map((b) => (
            <CountPill key={b} label={b} count={byBrand[b]} active={brand === b} onClick={() => apply(b, channel)} />
          ))}
        </div>
      )}
      {channels.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto md:flex-wrap bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-4 [&>*]:shrink-0">
          <CountPill label="Todos los canales" count={sum(byChannel)} active={channel === ''} onClick={() => apply(brand, '')} />
          {channels.map((c) => (
            <CountPill key={c} label={c} count={byChannel[c]} active={channel === c} onClick={() => apply(brand, c)} />
          ))}
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
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 text-zinc-700">
          <Inbox size={36} strokeWidth={1} />
          <p className="text-sm">Nada para publicar a mano.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((it) => <ManualCard key={it.slot_id} item={it} token={token} onPublished={onPublished} />)}
        </div>
      )}
    </div>
  );
}

/** Estilo común de los botones de la tarjeta: hover, active y foco visible. */
const BTN = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900';
const BTN_IDLE = 'bg-zinc-800 border-zinc-700 text-zinc-200 hover:bg-zinc-700 active:bg-zinc-600';
const BTN_OK = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';

function useFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  return [on, () => { setOn(true); setTimeout(() => setOn(false), 1500); }];
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [ok, flash] = useFlash();
  return (
    <button
      onClick={() => { navigator.clipboard?.writeText(text).then(flash).catch(() => {}); }}
      className={cn(BTN, ok ? BTN_OK : BTN_IDLE)}
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
      {ok ? 'Copiado' : label}
    </button>
  );
}

/**
 * Copia el cuerpo con formato: `text/html` (el editor conserva subtítulos y negritas) y `text/plain`
 * en el mismo elemento. Si el navegador no tiene `ClipboardItem` o lo rechaza, copia el texto plano.
 */
function CopyRichButton({ html, text, label }: { html: string; text: string; label: string }) {
  const [ok, flash] = useFlash();
  const copiar = async () => {
    try {
      if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) throw new Error('sin ClipboardItem');
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      flash();
    } catch {
      navigator.clipboard?.writeText(text).then(flash).catch(() => {});
    }
  };
  return (
    <button
      onClick={copiar}
      className={cn(BTN, ok ? BTN_OK : BTN_IDLE)}
      title="Copia el cuerpo con subtítulos y negritas; si el navegador no lo permite, como texto plano"
    >
      {ok ? <Check size={13} /> : <Copy size={13} />}
      {ok ? 'Copiado' : label}
    </button>
  );
}

// ── Descarga real ────────────────────────────────────────────────────────────────
const EXT_POR_TIPO: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };

/** La extensión: del tipo del archivo descargado; si no, de la ruta de la URL; si no, `png`. */
function extensionOf(blobType: string, url: string): string {
  const porTipo = EXT_POR_TIPO[blobType.split(';')[0].trim().toLowerCase()];
  if (porTipo) return porTipo;
  try {
    const m = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    if (m) return m[1].toLowerCase();
  } catch { /* URL ilegible: extensión por defecto */ }
  return 'png';
}

/** Nombre de archivo a partir del dato: id de marca, ocho caracteres del id de pieza y qué es. */
function fileBaseOf(brandId: string, pieceId: string, what: string): string {
  const limpio = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return [limpio(brandId), limpio(pieceId).slice(0, 8), what].filter(Boolean).join('-');
}

/**
 * Descarga el archivo aunque viva en otro origen: lectura con plazo → blob → URL de objeto → `<a download>`.
 * Si el almacenamiento no deja leerlo (CORS o red), lo abre en una pestaña nueva y devuelve `false`.
 */
async function downloadFile(url: string, base: string): Promise<boolean> {
  try {
    // Plazo de lectura (`db`): el almacenamiento es del mismo proyecto que la base, y el plazo mide
    // hasta la respuesta, no hasta el último byte. Vencido, cae a la pestaña nueva como cualquier fallo.
    const res = await fetchWithTimeout('db', url, { mode: 'cors' });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = obj;
    a.download = `${base}.${extensionOf(blob.type, url)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(obj), 1000);
    return true;
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
  }
}

const DOWNLOAD_TIP = 'Descarga el archivo. Si el almacenamiento no permite la descarga directa, '
  + 'se abre en una pestaña nueva para guardarlo desde ahí.';

function DownloadButton({ url, base, label = 'Descargar' }: { url: string; base: string; label?: string }) {
  const [estado, setEstado] = useState<'idle' | 'busy' | 'ok' | 'tab'>('idle');
  const bajar = async () => {
    setEstado('busy');
    const ok = await downloadFile(url, base);
    setEstado(ok ? 'ok' : 'tab');
    setTimeout(() => setEstado('idle'), 2500);
  };
  return (
    <button
      onClick={bajar} disabled={estado === 'busy'} title={DOWNLOAD_TIP}
      className={cn(BTN, estado === 'ok' ? BTN_OK : BTN_IDLE, estado === 'busy' && 'opacity-70 cursor-wait')}
    >
      {estado === 'busy' ? <Spinner size={13} /> : estado === 'ok' ? <Check size={13} />
        : estado === 'tab' ? <ExternalLink size={13} /> : <Download size={13} />}
      {estado === 'ok' ? 'Descargada' : estado === 'tab' ? 'Abierta en otra pestaña' : label}
    </button>
  );
}

/** Rótulo de cada bloque del artículo. */
function BlockLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{children}</p>;
}

/** Artículo: tres bloques —Título, Portada, Cuerpo—, cada uno con su botón. */
function ArticleBlocks({ article, brandId, pieceId }: { article: ManualArticle; brandId: string; pieceId: string }) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <BlockLabel>Título</BlockLabel>
        {article.title ? (
          <p className="text-[15px] font-semibold text-zinc-100 bg-[#050508] border border-zinc-800 rounded-xl px-3 py-2 break-words">{article.title}</p>
        ) : (
          <p className="text-[11px] font-mono text-amber-300/80">Este artículo no tiene título.</p>
        )}
        {article.title && <CopyButton text={article.title} label="Copiar título" />}
      </div>

      <div className="space-y-1.5">
        <BlockLabel>Portada</BlockLabel>
        {article.cover_url ? (
          <>
            <div className="w-full max-w-xl aspect-video bg-black rounded-lg border border-zinc-800 overflow-hidden">
              <img src={article.cover_url} alt="Portada del artículo" loading="lazy" className="w-full h-full object-contain" />
            </div>
            <DownloadButton url={article.cover_url} base={fileBaseOf(brandId, pieceId, 'portada')} />
          </>
        ) : (
          <p className="text-[11px] font-mono text-amber-300/80">Este artículo no tiene portada.</p>
        )}
      </div>

      <div className="space-y-1.5">
        <BlockLabel>Cuerpo</BlockLabel>
        {/* `body_html` lo arma el server escapando TODO antes de interpretar `##`, `**` y la URL del
            original (`api/_manualShared.ts → articleBodyHtml`, con sus pruebas de escape). */}
        <div
          className="font-body text-[13px] leading-relaxed text-zinc-200 bg-[#050508] border border-zinc-800 rounded-xl p-3 max-h-[60vh] overflow-y-auto break-words
            [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h2]:mt-4 [&_h2]:mb-2 [&_h2:first-child]:mt-0
            [&_p]:mb-3 [&_p:last-child]:mb-0 [&_strong]:text-zinc-50 [&_a]:underline [&_a]:text-zinc-300 [&_a:hover]:text-zinc-100"
          dangerouslySetInnerHTML={{ __html: article.body_html || '—' }}
        />
        <CopyRichButton html={article.body_html} text={article.body_text} label="Copiar cuerpo" />
      </div>

      {article.source_url && (
        <p className="text-[11px] font-mono text-zinc-500 break-all">
          Original:{' '}
          <a href={article.source_url} target="_blank" rel="noopener noreferrer" className="text-zinc-400 hover:text-zinc-200 underline">
            {article.source_url}
          </a>
        </p>
      )}
    </div>
  );
}

function ManualCard({ item, token, onPublished }: {
  item: ManualItem; token: string; onPublished: (it: ManualItem) => void;
}) {
  const z = fmtInZone(item.slot_at, item.timezone);
  const [link, setLink] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const linkOk = /^https?:\/\/\S+$/.test(link.trim());
  const varias = item.images.length > 1;
  const fotoBase = (i: number) => fileBaseOf(item.brand_id, item.piece_id, varias ? `foto-${i + 1}` : 'foto');

  const publicar = async () => {
    setSaving(true); setErr(null);
    try {
      await markManualPublished(token, item.slot_id, link.trim());
      onPublished(item);
    } catch (e) {
      setErr(e instanceof CalibrationError ? e.message : 'No se pudo marcar como publicada.');
      setSaving(false);
    }
  };
  return (
    <div
      className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 md:p-4 space-y-3"
      style={{ borderLeftWidth: 3, borderLeftColor: item.due ? '#f59e0b' : '#3f3f46' }}
    >
      <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[11px] font-mono text-zinc-500">
        <span className="text-accent font-semibold">{item.brand_id}</span>
        <span>·</span>
        <span className="text-zinc-300">{item.platform_key}</span>
        {item.format && <><span>·</span><span>{item.format}</span></>}
        <span>·</span>
        <span className={item.due ? 'text-amber-300' : 'text-zinc-400'} title={z?.title ?? item.slot_at}>
          {item.due ? 'Toca ya — ' : 'Sale '}{z ? `${z.when} (${z.zone})` : `${item.slot_at} UTC`}
        </span>
      </div>

      {item.article ? (
        <ArticleBlocks article={item.article} brandId={item.brand_id} pieceId={item.piece_id} />
      ) : (
        <>
          {item.images.length > 0 ? (
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto">
                {item.images.map((u, i) => (
                  <button
                    key={u} type="button" onClick={() => { void downloadFile(u, fotoBase(i)); }}
                    className="relative shrink-0 rounded-lg hover:opacity-90 active:opacity-75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                    title={`Foto ${i + 1}: descargar. ${DOWNLOAD_TIP}`}
                  >
                    <img src={u} alt={`Foto ${i + 1}`} loading="lazy" className="h-32 w-32 object-cover rounded-lg border border-zinc-800" />
                    {varias && (
                      <span className="absolute top-1 left-1 text-[10px] font-mono bg-black/70 text-white px-1.5 rounded">{i + 1}</span>
                    )}
                    <Download size={12} className="absolute bottom-1 right-1 text-white/80" />
                  </button>
                ))}
              </div>
              <div className="space-y-1">
                {item.images.map((u, i) => (
                  <div key={u} className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-zinc-600 shrink-0">{varias ? `${i + 1}.` : 'URL'}</span>
                    <a href={u} target="_blank" rel="noopener noreferrer" className="text-[11px] font-mono text-zinc-400 hover:text-zinc-200 truncate min-w-0">{u}</a>
                    <span className="shrink-0"><DownloadButton url={u} base={fotoBase(i)} /></span>
                  </div>
                ))}
              </div>
              <CopyButton text={item.images.join('\n')} label={varias ? 'Copiar URLs' : 'Copiar URL'} />
            </div>
          ) : (
            <p className="text-[11px] font-mono text-amber-300/80">Esta pieza no tiene imagen.</p>
          )}

          <pre className="whitespace-pre-wrap break-words font-body text-[13px] leading-relaxed text-zinc-200 bg-[#050508] border border-zinc-800 rounded-xl p-3 max-h-[60vh] overflow-y-auto">
            {item.text || '—'}
          </pre>
          <CopyButton text={item.text} label="Copiar texto" />
        </>
      )}

      <div className="flex flex-col md:flex-row gap-2 pt-2 border-t border-zinc-800">
        <input
          type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)}
          placeholder="Link del post publicado (https://…)"
          className="flex-1 min-w-0 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-[12px] font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
        />
        <button
          onClick={publicar} disabled={!linkOk || saving}
          title={linkOk ? 'Marcar como publicada' : 'Pega primero el link del post: es la prueba de que salió'}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
            linkOk && !saving
              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/25'
              : 'bg-zinc-900 border-zinc-800 text-zinc-600 cursor-not-allowed'
          )}
        >
          {saving ? <Spinner size={13} /> : <CheckCircle2 size={13} />}
          Publicada
        </button>
      </div>
      {err && <p className="text-[11px] text-rose-400/90">{err}</p>}
    </div>
  );
}
