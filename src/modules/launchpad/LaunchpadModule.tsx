import React from 'react';
import { motion } from 'motion/react';
import { ExternalLink, Clock } from 'lucide-react';
import { LABS } from '../../config/labs';
import { cn } from '../../ui/components';

export default function LaunchpadModule() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mb-2">Acceso directo</p>
        <h2 className="font-display text-2xl font-bold text-white">Launchpad</h2>
        <p className="text-sm text-zinc-500 mt-1">Accede a cualquier lab directamente para tareas específicas.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {LABS.map((lab, i) => (
          <motion.div
            key={lab.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <div
              className="group relative bg-zinc-900 border border-zinc-800 rounded-2xl p-5 hover:border-zinc-700 transition-all duration-200 cursor-pointer overflow-hidden"
            >
              {/* Hover glow */}
              <div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 rounded-2xl"
                style={{ background: `radial-gradient(circle at top left, ${lab.color}08 0%, transparent 60%)` }}
              />

              <div className="flex items-start justify-between mb-4 relative">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl border"
                  style={{ backgroundColor: `${lab.color}15`, borderColor: `${lab.color}25` }}
                >
                  {lab.icon}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border border-zinc-800 text-zinc-700">
                    {lab.buildTag}
                  </span>
                  <ExternalLink size={12} className="text-zinc-700 group-hover:text-zinc-500 transition-colors" />
                </div>
              </div>

              <div className="relative">
                <p className="font-display font-bold text-base text-white mb-1 group-hover:text-accent transition-colors" style={{}}>
                  {lab.label}
                </p>
                <p className="text-xs text-zinc-500 leading-relaxed">{lab.description}</p>
              </div>

              {/* Bottom accent line */}
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: `linear-gradient(to right, transparent, ${lab.color}, transparent)` }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Note */}
      <div className="mt-8 flex items-center gap-2 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl">
        <Clock size={13} className="text-zinc-600 shrink-0" />
        <p className="text-xs text-zinc-600 leading-relaxed">
          Los labs se ejecutan como aplicaciones independientes. En producción, el Launchpad abrirá cada lab en su propia ventana o ruta.
          La integración completa entre labs se gestiona a través del modo Flujo del Orchestrator.
        </p>
      </div>
    </div>
  );
}
