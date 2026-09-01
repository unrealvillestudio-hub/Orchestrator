import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LayoutGrid, Layers, History, Bell, Telescope, LogOut, Sprout, Dna, ClipboardCheck, Send, ShieldQuestion, Archive } from 'lucide-react';
import { useFlowStore } from './store/useFlowStore';
import { cn, GlowDot } from './ui/components';
import HubModule from './modules/hub/HubModule';
import FlowPlannerModule from './modules/planner/FlowPlannerModule';
import FlowExecutorModule from './modules/executor/FlowExecutorModule';
import LaunchpadModule from './modules/launchpad/LaunchpadModule';
import JobMonitorModule from './modules/monitor/JobMonitorModule';
import EcosystemIntelModule from './modules/intel/EcosystemIntelModule';
import LoginScreen from './modules/iid/LoginScreen';
import IidSeedsUnified from './modules/iid/IidSeedsUnified';
import CalibrationConsole from './modules/iid/CalibrationConsole';
import ApprovalCalibrationModule from './modules/iid/ApprovalCalibrationModule';
import PublishQueueModule from './modules/iid/PublishQueueModule';
import ChallengedInboxModule from './modules/iid/ChallengedInboxModule';
import EvaluatedHistoryModule from './modules/iid/EvaluatedHistoryModule';
import type { IidSession } from './services/iidInbound';

const BUILD_TAG = "OR_1.1";

type View = "hub" | "planner" | "executor" | "launchpad" | "monitor" | "intel" | "calibration" | "challenged" | "publish" | "history";

const NAV_ITEMS = [
  { id: "hub" as View,         label: "Orchestrator", icon: LayoutGrid },
  { id: "launchpad" as View,   label: "Launchpad",    icon: Layers },
  { id: "monitor" as View,     label: "Monitor",      icon: History },
  { id: "intel" as View,       label: "IID Intel",    icon: Telescope },
  { id: "calibration" as View, label: "Calibración",  icon: ClipboardCheck },
  // CALIB-01-E — las retenidas van junto a la calibración, que es donde Sam ya mira.
  { id: "challenged" as View,  label: "Retenidas",    icon: ShieldQuestion },
  { id: "publish" as View,     label: "Publicación",  icon: Send },
  // BRIEF-02 — el historial va DESPUÉS de las tres bandejas: es donde se mira lo que ya
  // pasó por ellas, no una cuarta cosa que decidir.
  { id: "history" as View,     label: "Historial",    icon: Archive },
];

// Deep-link ?view=calibration → abre la bandeja directo (botón del email despertador).
function initialView(): View {
  try {
    const v = new URLSearchParams(window.location.search).get('view');
    if (v === 'calibration') return 'calibration';
    // Deep-link del email de RETENIDA y del digest → la bandeja de arbitraje.
    if (v === 'challenged') return 'challenged';
    if (v === 'publish') return 'publish';
    // Deep-link al historial: sirve para mandarle a alguien una pieza ya evaluada.
    if (v === 'history') return 'history';
  } catch { /* SSR / entorno sin window */ }
  return 'hub';
}

const Logo = () => (
  <div className="flex items-center gap-2.5">
    <div className="w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-black text-[10px] font-black font-display tracking-tighter">
      UV
    </div>
    <div className="flex flex-col leading-none">
      <span className="text-[13px] font-display font-bold text-accent tracking-tight">UNREALVILLE</span>
      <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Orchestrator</span>
    </div>
  </div>
);

export default function App() {
  const [view, setView] = useState<View>(initialView);
  const [session, setSession] = useState<IidSession | null>(null);
  const { activePlan, completedFlows, isInterpreting } = useFlowStore();

  const logout = () => { setSession(null); setView("hub"); };

  // ── Sin sesión → puerta única (login). Sesión en memoria: re-login al refrescar.
  if (!session) {
    return <LoginScreen onSession={setSession} />;
  }

  // ── Rol seeder → SOLO IID Seeds (captura). Resto del Orchestrator no renderiza
  //    ni es alcanzable. El gate real lo refuerza la EF (seeder → 403 en approve/reject).
  if (session.role === "seeder") {
    return <SeederShell session={session} onLogout={logout} />;
  }

  // ── Rol admin → NAV completa + subpestaña IID Seeds dentro de IID Intel.

  const breadcrumb: Record<View, string> = {
    hub:       "Nuevo flujo",
    planner:   "Revisar plan",
    executor:  "Ejecutando",
    launchpad: "Launchpad",
    monitor:     "Monitor",
    intel:       "Ecosystem Intel",
    calibration: "Calibración",
    challenged:  "Retenidas",
    publish:     "Publicación",
    history:     "Historial",
  };

  const goHub = () => setView("hub");

  return (
    <div className="min-h-screen bg-[#050508] text-zinc-200 selection:bg-accent/30">

      {/* ── TOP NAV ── */}
      <header className="h-14 border-b border-zinc-800/60 px-5 flex items-center justify-between sticky top-0 bg-[#050508]/95 backdrop-blur-xl z-50">
        <div className="flex items-center gap-6">
          <button onClick={goHub} className="hover:opacity-80 transition-opacity">
            <Logo />
          </button>

          <div className="hidden md:flex items-center gap-1 text-[10px] font-mono text-zinc-700">
            {view !== "hub" && (
              <>
                <span className="text-zinc-800">/</span>
                <span className="text-zinc-500">{breadcrumb[view]}</span>
              </>
            )}
          </div>
        </div>

        {/* Center nav */}
        <nav className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={cn(
                "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all font-body",
                view === item.id || (item.id === "hub" && ["hub","planner","executor"].includes(view))
                  ? "bg-accent text-black shadow-md shadow-accent/20"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
              )}
            >
              <item.icon size={13} />
              {item.label}
              {item.id === "monitor" && completedFlows.length > 0 && (
                <span className={cn(
                  "text-[9px] w-4 h-4 rounded-full flex items-center justify-center font-mono",
                  view === "monitor" ? "bg-black/20 text-black" : "bg-emerald-500 text-white"
                )}>
                  {completedFlows.length}
                </span>
              )}
            </button>
          ))}
        </nav>

        {/* Right controls */}
        <div className="flex items-center gap-3">
          {activePlan && (view === "hub" || view === "launchpad" || view === "monitor" || view === "intel") && (
            <button
              onClick={() => setView(activePlan.status === 'running' ? 'executor' : 'planner')}
              className="flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 transition-colors"
            >
              <GlowDot color="#FFAB00" pulse={activePlan.status === 'running'} />
              Flujo activo
            </button>
          )}
          {isInterpreting && (
            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
              <span className="w-3 h-3 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
              Interpretando...
            </div>
          )}
          <button className="p-2 hover:bg-zinc-800 rounded-xl transition-colors">
            <Bell size={15} className="text-zinc-600" />
          </button>
          <SessionControl session={session} onLogout={logout} />
        </div>
      </header>

      {/* ── MAIN CONTENT ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {view === "hub" && (
            <HubModule onPlanReady={() => setView("planner")} />
          )}
          {view === "planner" && (
            <FlowPlannerModule
              onApprove={() => setView("executor")}
              onBack={() => setView("hub")}
            />
          )}
          {view === "executor" && (
            <FlowExecutorModule
              onComplete={() => setView("monitor")}
              onReset={() => setView("hub")}
            />
          )}
          {view === "launchpad"   && <LaunchpadModule />}
          {view === "monitor"     && <JobMonitorModule />}
          {view === "intel"       && <EcosystemIntelModule session={session} />}
          {view === "calibration" && <ApprovalCalibrationModule session={session} />}
          {view === "challenged"  && <ChallengedInboxModule session={session} />}
          {view === "publish"     && <PublishQueueModule session={session} />}
          {view === "history"     && <EvaluatedHistoryModule session={session} />}
        </motion.div>
      </AnimatePresence>

      {/* ── STATUS BAR ── */}
      <footer className="fixed bottom-0 left-0 right-0 h-7 border-t border-zinc-800/40 px-5 flex items-center justify-between bg-[#050508]/80 backdrop-blur-sm z-50">
        <div className="flex items-center gap-5 text-[9px] font-mono text-zinc-800 uppercase tracking-widest">
          <div className="flex items-center gap-1.5">
            <GlowDot color="#22c55e" pulse={false} />
            System Ready
          </div>
          {activePlan && (
            <span className="text-zinc-700">
              Flow: {activePlan.id.slice(0, 12)}...
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-accent/20">UNRLVL Orchestrator {BUILD_TAG}</span>
      </footer>
    </div>
  );
}

// ── Indicador de sesión + logout (compartido) ──────────────────────────────────
function SessionControl({ session, onLogout }: { session: IidSession; onLogout: () => void }) {
  return (
    <div className="flex items-center gap-2 pl-2 border-l border-zinc-800">
      <div className="hidden sm:flex flex-col items-end leading-none">
        <span className="text-[11px] font-semibold text-zinc-300">{session.sub}</span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-accent/70">{session.role}</span>
      </div>
      <button
        onClick={onLogout}
        title="Cerrar sesión"
        className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-600 hover:text-rose-400"
      >
        <LogOut size={15} />
      </button>
    </div>
  );
}

// ── Shell del seeder: dos vistas (Capturar / Calibrar voz) ───────────────────────
//
// E5a (Sprint #47): colapsa el toggle temporal Basic / "Expert (prueba)" en UN solo
// flujo de captura (IidSeedsUnified), común y bifurcado al final en Seed / Genoma.
// E5b (Sprint #47 Fase 2): añade una SEGUNDA vista —Calibrar voz (bucle Boids)—
// dentro del mismo shell vía toggle de estado (no router). El enlace gold de
// IidSeedsUnified salta directo acá (onGoCalibrate). Header "IID SEEDS / Sembrador"
// se mantiene.
type SeederView = 'capture' | 'calibrate';

function SeederShell({ session, onLogout }: { session: IidSession; onLogout: () => void }) {
  const [seederView, setSeederView] = useState<SeederView>('capture');

  const tabs: { id: SeederView; label: string; icon: typeof Sprout }[] = [
    { id: 'capture',   label: 'Capturar',    icon: Sprout },
    { id: 'calibrate', label: 'Calibrar voz', icon: Dna },
  ];

  return (
    <div className="min-h-screen bg-[#050508] text-zinc-200 selection:bg-accent/30">
      <header className="h-14 border-b border-zinc-800/60 px-5 flex items-center justify-between sticky top-0 bg-[#050508]/95 backdrop-blur-xl z-50">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-accent rounded-lg flex items-center justify-center text-black">
            <Sprout size={15} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[13px] font-display font-bold text-accent tracking-tight">IID SEEDS</span>
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">Sembrador</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <SessionControl session={session} onLogout={onLogout} />
        </div>
      </header>

      {/* Toggle de vista (patrón pill-tabs — igual que la nav del admin) */}
      <div className="flex justify-center pt-6">
        <nav className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-xl p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSeederView(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all font-body',
                seederView === t.id
                  ? 'bg-accent text-black shadow-md shadow-accent/20'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800'
              )}
            >
              <t.icon size={13} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={seederView}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {seederView === 'capture'
            ? <IidSeedsUnified session={session} onGoCalibrate={() => setSeederView('calibrate')} />
            : <CalibrationConsole session={session} />}
        </motion.div>
      </AnimatePresence>

      <footer className="fixed bottom-0 left-0 right-0 h-7 border-t border-zinc-800/40 px-5 flex items-center justify-between bg-[#050508]/80 backdrop-blur-sm z-50">
        <div className="flex items-center gap-1.5 text-[9px] font-mono text-zinc-800 uppercase tracking-widest">
          <GlowDot color="#22c55e" pulse={false} /> Conectado
        </div>
        <span className="text-[9px] font-mono text-accent/20">UNRLVL IID · Sembrador</span>
      </footer>
    </div>
  );
}
