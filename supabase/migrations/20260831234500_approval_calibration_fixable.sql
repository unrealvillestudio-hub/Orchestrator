-- BRIEF-03 PR-B — el tercer veredicto en el esquema: fixable
--
-- SEGUNDO DE LOS DOS TIEMPOS. El código ya está en `main` (PR #27 y #28): sabe emitir y leer
-- `fixable`, exige la propuesta, la guarda en el corpus y la baja a la pieza. Sólo ahora se
-- amplía el CHECK y se añaden las columnas. Al revés rompe producción: ampliar el CHECK antes
-- de que el código sepa tratar el valor deja la base aceptando algo que ninguna capa produce,
-- y el fallo aparece cuando alguien lo escribe a mano (MULTIBRAND_RULE §5).
--
-- ── DEFINICIÓN VIGENTE DEL CHECK, COPIADA LITERAL ANTES DE TOCARLA ────────────────
-- Es lo que hace posible revertir esta migración. Medido contra `pg_constraint` el 2026-08-31:
--
--   approval_calibration_verdict_check
--   CHECK ((verdict = ANY (ARRAY['approved'::text, 'rejected'::text])))
--
-- ── REVERSIÓN: DOS TABLAS QUE COMPROBAR, NO UNA ───────────────────────────────────
-- Restaurar esa definición literal sobre el corpus NO basta.
--
--   1. Corpus vivo. Si existieran filas con `verdict='fixable'`, restaurar el CHECK FALLARÍA:
--      primero se reetiquetan a 'rejected' conservando su `fix_proposal`, y sólo después se
--      restaura la restricción.
--   2. Archivo. `intel.approval_calibration_archive` NO tiene ningún constraint, así que
--      restaurar el CHECK del corpus NO fallaría por su culpa — y ése es justamente el
--      problema: una fila `fixable` ya archivada quedaría con un valor que el corpus ya no
--      admite, y nadie se enteraría. La reversión comprueba también el archivo y reetiqueta
--      allí, o declara por escrito que decide conservarlo.
--
-- Estado al escribir esto (medido 2026-08-31): 6 filas vivas, 0 `fixable`, 48 archivadas —
-- hoy no hay nada que reetiquetar en ninguna de las dos. La columna puede quedarse en la
-- reversión: una columna sin uso no molesta.
--
-- ── POR QUÉ TAMBIÉN EL ARCHIVO ────────────────────────────────────────────────────
-- El corpus se archiva (48 filas, medido 2026-08-31). Sin la columna en el archivo, la
-- propuesta se perdería al archivar la fila y el historial leería dos formas distintas de la
-- misma tabla.
--
-- ── POR QUÉ EL CORPUS NO LLEVA `DELETE` Y EL ARCHIVO SÍ ───────────────────────────
-- La asimetría es deliberada y se escribe para que nadie la "corrija" dentro de tres meses.
-- Hoy `service_role` tiene SELECT/INSERT/UPDATE sobre `approval_calibration` y además DELETE
-- sobre `approval_calibration_archive` (medido 2026-08-31 contra `information_schema`). Las
-- sentencias de abajo reproducen exactamente eso, sin ampliar ni recortar nada:
-- **una fila de calibración no se borra, se archiva** — el veredicto de Sam es el activo del
-- corpus y perderlo no se recupera salvo re-etiquetando. El `DELETE` vive donde vive el
-- archivado, que es la única operación que legítimamente saca filas de circulación.
--
-- ── SOBRE EL GRANT ────────────────────────────────────────────────────────────────
-- Se re-emite explícito, que es la convención de este repo desde 2026-07-25. El aprendizaje
-- correcto, MEDIDO el 2026-08-31 y verificado de forma independiente por Sam:
--
--   · una TABLA nueva no hereda ningún permiso y exige `GRANT` explícito;
--   · una COLUMNA nueva sobre una tabla ya concedida SÍ queda cubierta por el grant de tabla.
--
-- Evidencia: `watcher_result` y `watcher_gate` los añadió la migración 20260725190000, que NO
-- re-emitió ningún GRANT, y hoy los dos tienen INSERT/SELECT/UPDATE para `service_role`. Es lo
-- que ya decía 20260728190000: «aunque el grant a nivel tabla ya cubre columnas nuevas, se
-- re-emite por seguridad (idempotente)». Se re-emite igual —es gratis, es idempotente y es la
-- convención—, pero el motivo escrito es ése y no una herencia que no ocurre.
--
-- NO toca lab_jobs, lab_configs, Edge Functions ni el flujo del pipeline. Aditiva.
--
-- Ejecutar UNA sentencia por llamada si se aplica vía el MCP de Supabase
-- (el parser rompe con multi-statement; ver 20260718120000_calibration_craft_columns.sql).

-- 1 · La propuesta en el corpus vivo.
ALTER TABLE intel.approval_calibration ADD COLUMN IF NOT EXISTS fix_proposal text;

-- 2 · La misma columna en el archivo, para que el historial lea UNA sola forma.
ALTER TABLE intel.approval_calibration_archive ADD COLUMN IF NOT EXISTS fix_proposal text;

-- 3 · El CHECK ampliado, en UNA sola sentencia. DROP y ADD separados dejarían a la tabla sin
--     restricción sobre `verdict` en el intervalo entre las dos — una ventana en la que
--     cualquier valor entraría. `ALTER TABLE` acepta varias acciones y las aplica en orden
--     dentro de la misma sentencia: la restricción nunca deja de existir.
ALTER TABLE intel.approval_calibration
  DROP CONSTRAINT IF EXISTS approval_calibration_verdict_check,
  ADD  CONSTRAINT approval_calibration_verdict_check
       CHECK (verdict IN ('approved', 'rejected', 'fixable'));

-- 4 · GRANT explícito a service_role, en las DOS tablas, reproduciendo exactamente los
--     privilegios vigentes (ver la nota de la asimetría, arriba).
GRANT SELECT, INSERT, UPDATE ON intel.approval_calibration TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON intel.approval_calibration_archive TO service_role;

-- ── VERIFICACIÓN POSTERIOR (no forma parte de la migración; se ejecuta y se reporta) ──
--
-- a) El grant sobre la columna nueva, en las dos tablas. Esperado: 6 filas
--    (SELECT/INSERT/UPDATE × 2 tablas). `DELETE` no aparece: es un privilegio de tabla, no
--    de columna.
--
--   SELECT table_name, column_name, privilege_type
--     FROM information_schema.column_privileges
--    WHERE table_schema = 'intel'
--      AND table_name IN ('approval_calibration', 'approval_calibration_archive')
--      AND grantee = 'service_role'
--      AND column_name = 'fix_proposal'
--    ORDER BY table_name, privilege_type;
--
-- b) El CHECK ampliado. Esperado: los TRES valores en la definición, con el mismo nombre de
--    restricción de siempre.
--
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conname = 'approval_calibration_verdict_check';
