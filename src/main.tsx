import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
);

// Avisos push propios (2026-11-12): el service worker enseña los avisos aunque el Orchestrator esté cerrado.
// Se registra siempre; suscribirse lo decide la campanita, con el permiso del sistema.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* sin avisos push */ }); });
}
