import React, { useState } from 'react';
import { Telescope, Sprout } from 'lucide-react';
import { cn } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import IidSeedsAdmin from '../iid/IidSeedsAdmin';
import InvestigacionesView from './InvestigacionesView';

// ── Main module ────────────────────────────────────────────────────
// Admin: subpestañas Investigaciones | IID Seeds (cola de revisión, captura de post y propuesta de tema).
//
// 2026-10-20 — «Hallazgos» (Top / Watchlist / Descartados) se retira por decisión de Sam. Evaluaba
// cada hallazgo como mejora interna del ecosistema, nadie lo usaba y llevaba meses vacío: leía
// `intel.iid_findings` con la clave anónima, sin permiso sobre esa tabla, y se tragaba el error. En su
// lugar van los resultados de los seeds de tema, leídos por `iid-inbound` con la sesión.
type IntelTab = 'investigaciones' | 'seeds';

export default function EcosystemIntelModule({ session }: { session?: IidSession | null } = {}) {
  const [tab, setTab] = useState<IntelTab>('investigaciones');
  const isAdmin = session?.role === 'admin';

  if (!isAdmin || !session) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-16 text-sm text-zinc-500">
        Esta sección es sólo para administradores.
      </div>
    );
  }

  const TABS: { id: IntelTab; label: string; icon: typeof Telescope }[] = [
    { id: 'investigaciones', label: 'Investigaciones', icon: Telescope },
    { id: 'seeds',           label: 'IID Seeds',       icon: Sprout },
  ];

  return (
    <div>
      <div className="max-w-3xl mx-auto px-6 pt-8">
        <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 max-w-sm">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
                tab === t.id ? 'bg-accent text-black shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
              )}
            >
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'investigaciones' ? (
        <InvestigacionesView session={session} />
      ) : (
        <div className="max-w-3xl mx-auto px-6 py-6 pb-24">
          <IidSeedsAdmin session={session} onVerInvestigaciones={() => setTab('investigaciones')} />
        </div>
      )}
    </div>
  );
}
