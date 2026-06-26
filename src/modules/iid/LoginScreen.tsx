import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, ArrowRight, Telescope, Eye, EyeOff } from 'lucide-react';
import { cn, Spinner } from '../../ui/components';
import { login, IidError, type IidSession } from '../../services/iidInbound';

/**
 * LoginScreen — puerta única del IID (T4 E4).
 * Un solo campo (password). La EF iid-inbound devuelve rol + scope en el JWT.
 * Sesión en memoria: al refrescar, se vuelve a pedir login (decisión de E4).
 */
export default function LoginScreen({ onSession }: { onSession: (s: IidSession) => void }) {
  const [password, setPassword] = useState('');
  const [show, setShow]         = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || loading) return;
    setLoading(true);
    setError(null);
    try {
      const session = await login(password);
      onSession(session);
    } catch (err) {
      const msg = err instanceof IidError ? err.message : 'No se pudo iniciar sesión.';
      setError(msg);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050508] text-zinc-200 flex items-center justify-center px-6 selection:bg-accent/30">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-sm"
      >
        {/* Marca */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 bg-accent rounded-2xl flex items-center justify-center text-black mb-4 shadow-lg shadow-accent/20">
            <Telescope size={22} />
          </div>
          <h1 className="font-display text-xl font-bold text-white">IID Seeds</h1>
          <p className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-600 mt-1">
            Sembrador · Unrealville
          </p>
        </div>

        {/* Form */}
        <form onSubmit={submit} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
          <label className="block">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">Contraseña</span>
            <div className="relative mt-2">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
              <input
                type={show ? 'text' : 'password'}
                autoFocus
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(null); }}
                placeholder="••••••••••"
                className="w-full bg-[#050508] border border-zinc-800 rounded-xl pl-9 pr-10 py-2.5 text-sm text-white placeholder:text-zinc-700 outline-none focus:border-accent/60 transition-colors font-mono"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                tabIndex={-1}
                aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-600 hover:text-zinc-300 transition-colors"
              >
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </label>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-xs text-rose-400 font-mono leading-snug"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={!password || loading}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold font-body transition-all',
              !password || loading
                ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                : 'bg-accent text-black hover:bg-accent/90 shadow-md shadow-accent/20'
            )}
          >
            {loading ? <Spinner size={15} /> : <>Entrar <ArrowRight size={14} /></>}
          </button>
        </form>

        <p className="text-center text-[10px] font-mono text-zinc-700 mt-6 leading-relaxed">
          Acceso restringido. Tu rol y marcas se determinan al entrar.
        </p>
      </motion.div>
    </div>
  );
}
