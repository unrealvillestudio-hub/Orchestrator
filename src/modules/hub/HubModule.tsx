import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Sparkles, AlertCircle, RotateCcw, ChevronDown } from 'lucide-react';
// U-9 — las marcas salen del dato. Ver `src/config/brands.ts`, vaciado en este mismo corte.
import { useBrands } from '../../services/useBrands';
import { getBrandById } from '../../services/brandsLoader';
import { useFlowStore } from '../../store/useFlowStore';
import { interpretPrompt } from '../../services/orchestratorEngine';
import { FlowPlan, FlowStage, InterpretResult } from '../../core/types';
import { cn, Spinner, GlowDot, BrandsFallbackNotice } from '../../ui/components';

/**
 * U-9 — LOS EJEMPLOS SE ESCRIBEN CON LA MARCA ELEGIDA, NO CON MARCAS ESCRITAS A MANO.
 *
 * Antes eran cuatro frases con cuatro marcas dentro: vocabulario de cliente en una capa
 * compartida, y desactualizado por el mismo motivo que la lista de marcas — dos de las que
 * nombraba ya no eran las de la base.
 *
 * Ahora son PLANTILLAS. La marca entra como dato y los ejemplos hablan siempre de la que
 * está seleccionada, que además los hace más útiles que antes.
 */
const EXAMPLE_TEMPLATES = [
  (marca: string) => `Quiero lanzar el nuevo producto de ${marca} en redes para la próxima semana`,
  (marca: string) => `Crea contenido de marca para ${marca} en todas sus plataformas activas`,
  (marca: string) => `Prepara un post de ${marca} mostrando el antes y el después`,
  (marca: string) => `Lanza una campaña de ${marca} con video y copy`,
];

interface HubModuleProps {
  onPlanReady: () => void;
}

export default function HubModule({ onPlanReady }: HubModuleProps) {
  const [prompt, setPrompt]           = useState('');
  const [error, setError]             = useState('');
  const { brands, source, reason } = useBrands();
  /**
   * U-9 — LA MARCA POR DEFECTO ES LA PRIMERA DEL DATO, NO UNA ESCRITA.
   *
   * Antes este selector arrancaba en una marca concreta nombrada en el código: una marca
   * gobernando una rama de la aplicación. Ahora arranca en la primera que devuelve la
   * consulta, ordenada por nombre. Cuál sea es una consecuencia del dato, no una decisión
   * de este archivo.
   *
   * Empieza vacío a propósito: mientras las marcas cargan todavía no hay ninguna, y elegir
   * una antes de saber cuáles hay sería inventarla.
   */
  const [selectedBrand, setSelectedBrand] = useState<string>('');

  useEffect(() => {
    if (!selectedBrand && brands.length) setSelectedBrand(brands[0].id);
  }, [brands, selectedBrand]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isInterpreting, setInterpreting, setActivePlan } = useFlowStore();

  const handleSubmit = async () => {
    if (!prompt.trim() || isInterpreting) return;
    setError('');
    setInterpreting(true);

    try {
      const result: InterpretResult = await interpretPrompt(prompt.trim());

      const stages: FlowStage[] = result.suggestedStages.map((s, i) => ({
        ...s,
        id: `stage_${i}_${Date.now()}`,
        status: 'pending',
      }));

      const plan: FlowPlan = {
        id: `flow_${Date.now()}`,
        // FIX 1: usar el brand seleccionado manualmente, no el interpretado
        // El intérprete puede detectar el brand del prompt, pero el selector tiene prioridad
        brandId: selectedBrand,
        objective: result.objective,
        platforms: result.platforms,
        userPrompt: prompt.trim(),
        interpretedIntent: result.interpretedIntent,
        stages,
        estimatedTotalSeconds: stages.reduce((s, st) => s + st.estimatedSeconds, 0),
        complianceFlags: result.complianceFlags,
        dbVariablesKeys: result.dbVariablesKeys,
        status: 'planned',
        createdAt: new Date().toISOString(),
      };

      setActivePlan(plan);
      onPlanReady();
    } catch (e: any) {
      setError(e.message ?? 'Error al interpretar el prompt. Verifica la API key.');
    } finally {
      setInterpreting(false);
    }
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
  };

  const handleReset = () => {
    setPrompt('');
    setError('');
    textareaRef.current?.focus();
  };

  const activeBrand = getBrandById(brands, selectedBrand);
  /**
   * Los ejemplos hablan de la marca elegida. Si todavía no hay ninguna —cargando, o la
   * lectura falló y el respaldo tampoco trajo nada—, no se pinta ninguno: un ejemplo con
   * un hueco donde debería ir el nombre enseña a desconfiar de la pantalla.
   */
  const ejemplos = activeBrand ? EXAMPLE_TEMPLATES.map((t) => t(activeBrand.name)) : [];

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-6 pb-16">

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="text-center mb-12"
      >
        <div className="flex items-center justify-center gap-2 mb-6">
          <GlowDot color="#FFAB00" />
          <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500">Sistema listo</span>
          <GlowDot color="#FFAB00" />
        </div>
        <h1 className="font-display text-5xl md:text-6xl font-bold text-white leading-[1.05] tracking-tight mb-4">
          ¿Qué quieres<br />
          <span className="text-accent">producir hoy?</span>
        </h1>
        <p className="text-zinc-500 text-lg max-w-md mx-auto leading-relaxed">
          Describe tu objetivo en lenguaje natural. El Orchestrator diseña el flujo, tú apruebas cada paso.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-2xl"
      >
        {/* U-9 — si las marcas vienen del respaldo, la pantalla lo dice. */}
        {source === 'fallback' && (
          <div className="mb-3">
            <BrandsFallbackNotice source={source} reason={reason} />
          </div>
        )}

        {/* Brand selector */}
        <div className="mb-3">
          <div className="relative">
            <select
              value={selectedBrand}
              onChange={e => setSelectedBrand(e.target.value)}
              disabled={isInterpreting}
              className="w-full appearance-none bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm font-medium text-zinc-200 outline-none hover:border-zinc-700 focus:border-accent/50 transition-all disabled:opacity-50 cursor-pointer pr-10"
              style={{ color: activeBrand?.color ?? '#e4e4e7' }}
            >
              {/* Mientras cargan no hay opciones que pintar, y decirlo es mejor que un
                  selector vacío que parece roto. */}
              {source === 'loading' && <option value="">Cargando marcas…</option>}
              {source !== 'loading' && !brands.length && <option value="">Sin marcas disponibles</option>}
              {brands.map(b => (
                <option key={b.id} value={b.id} style={{ color: b.color, background: '#18181b' }}>
                  {b.name}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              <ChevronDown size={14} className="text-zinc-600" />
            </div>
            {/* Color dot */}
            <div
              className="absolute left-3 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none"
              style={{ backgroundColor: activeBrand?.color ?? '#888' }}
            />
            <div className="absolute left-8 top-1/2 -translate-y-1/2 pointer-events-none">
              {/* spacer */}
            </div>
          </div>
        </div>

        <div className={cn(
          "relative bg-zinc-900 border rounded-2xl transition-all duration-300",
          isInterpreting
            ? "border-accent/50 shadow-lg shadow-accent/10"
            : "border-zinc-800 hover:border-zinc-700 focus-within:border-accent/50 focus-within:shadow-lg focus-within:shadow-accent/10"
        )}>
          {isInterpreting && (
            <div className="absolute inset-x-0 top-0 h-px rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-transparent via-accent to-transparent"
                animate={{ x: ["-100%", "200%"] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: "linear" }}
              />
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder={activeBrand
              ? `Ej: Quiero lanzar el nuevo producto de ${activeBrand.name} en redes esta semana...`
              : 'Describe tu objetivo en lenguaje natural...'}
            rows={4}
            disabled={isInterpreting}
            className="w-full bg-transparent px-5 pt-5 pb-3 text-base text-zinc-200 placeholder:text-zinc-700 resize-none outline-none leading-relaxed font-body disabled:opacity-50"
          />

          <div className="flex items-center justify-between px-4 pb-4 pt-1">
            <span className="text-[11px] font-mono text-zinc-700">⌘ + Enter para generar</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleReset}
                disabled={isInterpreting || (!prompt && !error)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCcw size={13} /> Reset
              </button>
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim() || isInterpreting}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all",
                  prompt.trim() && !isInterpreting
                    ? "bg-accent text-black hover:bg-accent/90 shadow-lg shadow-accent/20 active:scale-95"
                    : "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                )}
              >
                {isInterpreting ? (
                  <><Spinner size={14} className="text-zinc-400" /> Interpretando...</>
                ) : (
                  <><Sparkles size={14} /> Generar flujo <ArrowRight size={13} /></>
                )}
              </button>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400"
            >
              <AlertCircle size={14} /> {error}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-6 space-y-2">
          <p className="text-[11px] font-mono uppercase tracking-widest text-zinc-700 text-center mb-3">Ejemplos</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ejemplos.map((ex, i) => (
              <motion.button
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.08 }}
                onClick={() => { setPrompt(ex); textareaRef.current?.focus(); }}
                className="text-left px-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60 transition-all leading-relaxed"
              >
                "{ex}"
              </motion.button>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
