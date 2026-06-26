import React, { useState } from 'react';
import { ClipboardCheck, Sprout } from 'lucide-react';
import { cn } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import IidSeedsApprove from './IidSeedsApprove';
import IidSeedsCapture from './IidSeedsCapture';

type AdminSeedView = 'queue' | 'capture';

/**
 * IidSeedsAdmin — panel "IID Seeds" del admin (vive dentro de IID Intel).
 * Toggle entre la cola de revisión (approve) y la captura manual.
 */
export default function IidSeedsAdmin({ session }: { session: IidSession }) {
  const [view, setView] = useState<AdminSeedView>('queue');

  const TABS: { id: AdminSeedView; label: string; icon: typeof Sprout }[] = [
    { id: 'queue',   label: 'Cola de revisión', icon: ClipboardCheck },
    { id: 'capture', label: 'Capturar',         icon: Sprout },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-6 max-w-xs">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
              view === t.id ? 'bg-accent text-black shadow' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'
            )}
          >
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {view === 'queue' ? <IidSeedsApprove session={session} /> : <IidSeedsCapture session={session} />}
    </div>
  );
}
