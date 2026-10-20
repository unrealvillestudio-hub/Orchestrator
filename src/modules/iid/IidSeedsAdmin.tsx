import React, { useState } from 'react';
import { ClipboardCheck, Sprout, Lightbulb } from 'lucide-react';
import { cn } from '../../ui/components';
import type { IidSession } from '../../services/iidInbound';
import IidSeedsApprove from './IidSeedsApprove';
import IidSeedsCapture from './IidSeedsCapture';
import IidTopicCapture from './IidTopicCapture';

type AdminSeedView = 'queue' | 'capture' | 'topic';

/**
 * IidSeedsAdmin — panel "IID Seeds" del admin (vive dentro de IID Intel).
 * Cola de revisión (approve), captura de un post y, desde el 2026-10-20, propuesta de un tema para que
 * los agentes lo investiguen (el resultado aparece en «Investigaciones»).
 */
export default function IidSeedsAdmin({ session, onVerInvestigaciones }: {
  session: IidSession;
  onVerInvestigaciones?: () => void;
}) {
  const [view, setView] = useState<AdminSeedView>('queue');

  const TABS: { id: AdminSeedView; label: string; icon: typeof Sprout }[] = [
    { id: 'queue',   label: 'Cola de revisión', icon: ClipboardCheck },
    { id: 'capture', label: 'Capturar post',    icon: Sprout },
    { id: 'topic',   label: 'Proponer tema',    icon: Lightbulb },
  ];

  return (
    <div>
      <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1 mb-6 max-w-md">
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

      {view === 'queue' && <IidSeedsApprove session={session} />}
      {view === 'capture' && <IidSeedsCapture session={session} />}
      {view === 'topic' && <IidTopicCapture session={session} onVerInvestigaciones={onVerInvestigaciones} />}
    </div>
  );
}
