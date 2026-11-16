import React, { useEffect, useRef, useState } from 'react';
import { Menu, ExternalLink } from 'lucide-react';
import { fetchWithTimeout } from '../../services/fetchWithTimeout';
import { getLabById } from '../../config/labs';

/**
 * MENÚ DE LABS (2026-11-16, pedido de Sam). Desde el logotipo del Orchestrator se abren las apps de los otros labs.
 * Qué labs salen y a dónde llevan es DATO: las filas activas de `lab_configs` con `ui_url` (migración
 * 20261116233000). El código no escribe ninguna dirección: un lab entra al menú cargando su `ui_url`.
 */

const SB_URL = (import.meta as any).env.VITE_SUPABASE_URL as string;
const SB_KEY = (import.meta as any).env.VITE_SUPABASE_ANON_KEY as string;

export interface LabApp { lab_key: string; ui_url: string }

/** Las apps que el menú puede abrir: sólo direcciones https, sin duplicados, en orden por nombre. PURO. */
export function labAppsOf(rows: unknown): LabApp[] {
  if (!Array.isArray(rows)) return [];
  const vistos = new Set<string>();
  return rows
    .filter((r: any) => typeof r?.lab_key === 'string' && typeof r?.ui_url === 'string' && /^https:\/\//.test(r.ui_url))
    .filter((r: any) => (vistos.has(r.lab_key) ? false : (vistos.add(r.lab_key), true)))
    .map((r: any) => ({ lab_key: r.lab_key, ui_url: r.ui_url }))
    .sort((a, b) => a.lab_key.localeCompare(b.lab_key));
}

/** El nombre visible de un lab: el de la configuración de la UI, o su clave. PURO. */
export function labNameOf(labKey: string): string {
  return getLabById(labKey)?.label ?? labKey;
}

export function MenuDeLabs() {
  const [abierto, setAbierto] = useState(false);
  const [apps, setApps] = useState<LabApp[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto || apps) return;
    fetchWithTimeout('db', `${SB_URL}/rest/v1/lab_configs?select=lab_key,ui_url&active=eq.true&ui_url=not.is.null`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } })
      .then(async (r) => { if (!r.ok) throw new Error(`lab_configs ${r.status}`); setApps(labAppsOf(await r.json())); })
      .catch((e) => setError(String(e?.message ?? e)));
  }, [abierto, apps]);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => { if (!raiz.current?.contains(e.target as Node)) setAbierto(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);

  return (
    <div ref={raiz} className="relative shrink-0">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-haspopup="menu" aria-expanded={abierto}
        aria-label="Abrir otros labs" title="Otros labs"
        className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/70 transition-colors">
        <Menu size={18} />
      </button>
      {abierto && (
        <div role="menu" className="absolute left-0 top-full mt-2 w-56 rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl shadow-black/60 p-1.5 z-[60]">
          <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-mono uppercase tracking-widest text-zinc-600">Labs</p>
          {error && <p className="px-2.5 py-1.5 text-[11px] text-amber-300/90">No se pudo leer la lista de labs: {error}</p>}
          {!error && !apps && <p className="px-2.5 py-1.5 text-[11px] text-zinc-500">Cargando…</p>}
          {apps && apps.length === 0 && <p className="px-2.5 py-1.5 text-[11px] text-zinc-500">Ningún lab tiene su app declarada todavía.</p>}
          {apps?.map((a) => (
            <a key={a.lab_key} role="menuitem" href={a.ui_url} target="_blank" rel="noopener noreferrer"
              onClick={() => setAbierto(false)}
              className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-[13px] text-zinc-200 hover:bg-zinc-800/80">
              <span>{labNameOf(a.lab_key)}</span>
              <ExternalLink size={13} className="text-zinc-500" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
