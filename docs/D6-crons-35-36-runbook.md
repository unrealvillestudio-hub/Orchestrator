# D.6 — Secreto de los crons 35/36: migración a Vault + rotación

**Estado:** entregable de CC. **NO aplicado.** Todo el SQL de acá lo aplica Claude-chat bajo HRD.
**Fecha:** 2026-07-17 · **Autor:** CC (Sesión 3) · **Aplica:** Claude-chat / Sam

---

## 1. Qué se encontró

Los crons `35` (`iid-expert-orphan-sweep`, horario) y `36` (`unrlvl-media-temp-cleanup`, 3am)
llevan el `x-sweep-secret` **literal** dentro de `cron.job.command`. Ambos `active=true`, ambos
llaman a la EF `storage-orphan-sweep`. Son **los únicos 2 de 36 crons** con credencial inline.

Tres hallazgos que cambian el plan original del brief:

### 1.1 El secreto no está solo en `cron.job` — está 386 veces en el historial

`cron.job_run_details` guarda el `command` de **cada corrida**:

| jobid | corridas con el secreto en texto plano | desde | hasta |
|---|---|---|---|
| 35 | 371 | 2026-07-01 12:00 | 2026-07-16 22:00 |
| 36 | 15 | 2026-07-02 03:00 | 2026-07-16 03:00 |

Reescribir `cron.job.command` **no toca esas 386 filas**. Migrar sin purgar el historial deja
386 copias del secreto en la base. Por eso la rotación no es opcional: la exposición pasada no
se "desexpone".

### 1.2 `intel.iid_scheduler_config` NO es un destino seguro — es peor que el origen

El brief proponía mover el secreto ahí ("patrón ya usado: `iid_cron_secret` vive ahí").
Dos problemas:

**(a) Ningún cron lee de esa tabla.** El secreto *vive* ahí, pero cero crons lo *leen* de ahí.
El precedente de almacenamiento existe; el de lectura no.

**(b) La tabla es legible por cualquier usuario autenticado:**

```
grants:   postgres=arwdDxtm | service_role=arwdDxtm | authenticated=arwd   ← authenticated
policy:   intel_select | SELECT | permisiva | rol: authenticated | USING (true)
```

Y el schema `intel` está **expuesto por PostgREST** — verificado contra la propia API:

```
PGRST106: "Only the following schemas are exposed: public, intel, content"
```

Es decir: cualquiera con un login puede hacer
`GET /rest/v1/iid_scheduler_config` con `Accept-Profile: intel` y leer todo.
Mover el `sweep_secret` ahí lo sacaría de `cron.job` (RLS restringida al owner del job) para
ponerlo detrás de un `USING (true)`. **Es un downgrade.**

> **Colateral, ya vivo hoy:** `iid_cron_secret` y `vercel_bypass_secret` YA están en esa tabla,
> o sea ya expuestos a cualquier autenticado. Ver §5.

### 1.3 El destino correcto es Vault, que ya está instalado y vacío

```
supabase_vault 0.3.1 · vault.secrets: 0 filas
grants: supabase_admin | postgres=r* | service_role=rd     ← NO authenticated, NO anon
```

---

## 2. Diseño: wrapper `SECURITY DEFINER` que lee de Vault

Se copia el patrón de la casa — `intel.trigger_iid_agent` (cron 29 es literalmente
`SELECT intel.trigger_iid_agent('content-dispatcher');`). El command del cron no sabe nada de
secretos porque no los toca: los lee la función.

La EF `storage-orphan-sweep` **no cambia**. Valida `x-sweep-secret` contra su propio env var
`STORAGE_SWEEP_SECRET` (timing-safe, `verify_jwt:false`). Su lado ya está bien.

---

## 3. BLOQUE A — Migración (sin rotar todavía)

> Se aplica con el valor **ACTUAL** del secreto. Migrar y rotar en un solo paso mezcla dos
> causas de fallo; si algo se rompe, no se sabe cuál fue.

```sql
-- A1. Guardar el secreto ACTUAL en Vault.
--     <VALOR_ACTUAL> = el literal que hoy está en cron.job.command de los jobs 35/36.
select vault.create_secret(
  '<VALOR_ACTUAL>',
  'sweep_secret',
  'x-sweep-secret de storage-orphan-sweep (crons 35 y 36). Debe coincidir con el env var STORAGE_SWEEP_SECRET de la EF.'
);

-- A2. Wrapper. Mismo patrón que intel.trigger_iid_agent: SECURITY DEFINER + search_path fijo.
create or replace function intel.trigger_storage_sweep(
  p_bucket             text,
  p_older_than_minutes int,
  p_prefix             text default null
)
returns bigint
language plpgsql
security definer
set search_path to 'intel', 'public'
as $function$
declare
  v_url        text;
  v_secret     text;
  v_request_id bigint;
begin
  select value into v_url
    from intel.iid_scheduler_config
   where key = 'supabase_url';

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'sweep_secret';

  -- Fail-fast y ruidoso: si falta config, el cron falla visible en job_run_details.
  -- Antes, un secreto incorrecto daba 401 en la EF pero el cron figuraba "succeeded"
  -- (net.http_post es fire-and-forget) — el fallo era invisible.
  if v_url is null or v_secret is null then
    raise exception 'trigger_storage_sweep: falta supabase_url (iid_scheduler_config) o sweep_secret (Vault)';
  end if;

  select net.http_post(
    url     := v_url || '/functions/v1/storage-orphan-sweep',
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-sweep-secret', v_secret
    ),
    -- strip_nulls: el job 35 no manda prefix; la EF trata su ausencia como raíz.
    body    := jsonb_strip_nulls(jsonb_build_object(
      'bucket',             p_bucket,
      'older_than_minutes', p_older_than_minutes,
      'prefix',             p_prefix
    ))
  ) into v_request_id;

  return v_request_id;
end;
$function$;

-- A3. Lockdown. OBLIGATORIO, no opcional: las funciones reciben EXECUTE a PUBLIC por
--     defecto, y el schema intel está expuesto por PostgREST. Sin esto, la función queda
--     invocable por RPC — y al ser SECURITY DEFINER adjunta el secreto en nombre de quien
--     la llame (diputado confundido). El cron corre como postgres (owner) y conserva EXECUTE.
revoke all on function intel.trigger_storage_sweep(text, int, text) from public;
revoke all on function intel.trigger_storage_sweep(text, int, text) from anon;
revoke all on function intel.trigger_storage_sweep(text, int, text) from authenticated;

-- A4. Reescribir los crons. Payload idéntico al actual (bucket / older_than_minutes / prefix).
select cron.alter_job(35, command := $cmd$select intel.trigger_storage_sweep('iid-expert-uploads', 60);$cmd$);
select cron.alter_job(36, command := $cmd$select intel.trigger_storage_sweep('unrlvl-media', 17280, 'temp/');$cmd$);
```

**Verificación del Bloque A** (debe dar 0 filas):

```sql
select jobid, jobname, command
  from cron.job
 where jobid in (35, 36)
   and command ilike '%x-sweep-secret%';
```

Y esperar la corrida siguiente del job 35 (corre en punto, cada hora):

```sql
select jobid, status, return_message, start_time
  from cron.job_run_details
 where jobid = 35
 order by start_time desc
 limit 3;
```

Debe decir `succeeded`. Confirmar además en los logs de la EF que responde `ok:true` y **no** `401`.

---

## 4. BLOQUE B — Purga del historial

> Solo después de que el Bloque A esté verificado.

```sql
delete from cron.job_run_details
 where jobid in (35, 36)
   and command ilike '%x-sweep-secret%';
```

**Verificación** (debe dar 0):

```sql
select count(*)
  from cron.job_run_details
 where jobid in (35, 36)
   and command ilike '%x-sweep-secret%';
```

---

## 5. BLOQUE C — Rotación

El secreto actual se considera **comprometido**: estuvo en texto plano en `cron.job.command`,
en 386 filas de `job_run_details`, y quedó en el log de la sesión de CC que produjo este
runbook (la redacción de la query falló: se asumió JSON literal, pero el command usa
`jsonb_build_object`, y el regex no matcheó). Rotar no es opcional.

La EF compara contra **un solo valor** (no acepta viejo+nuevo a la vez), así que hay una
**ventana de fallo inevitable** entre actualizar un lado y el otro. Es tolerable: ambos crons
son garbage collection de respaldo y una corrida perdida la recupera la siguiente. Hacerlo
justo **después** de una corrida en punto deja ~50 min de margen.

Orden:

1. **Generar** el nuevo valor (64 chars, como el actual): `openssl rand -base64 48 | tr -d '/+=' | head -c 64`
2. **Actualizar la EF:** Dashboard → Edge Functions → Secrets → `STORAGE_SWEEP_SECRET` = nuevo.
   *(Desde acá y hasta el paso 3, los crons mandan el viejo → EF 401 → sweep se saltea. Ventana.)*
3. **Actualizar Vault** (cierra la ventana):
   ```sql
   select vault.update_secret(
     (select id from vault.secrets where name = 'sweep_secret'),
     '<VALOR_NUEVO>'
   );
   ```
4. **Verificar:** esperar la corrida siguiente del job 35 → `succeeded`, y la EF respondiendo
   `ok:true` y no `401`. Si da 401, los dos lados no coinciden.
5. **Viejo:** no hay paso de "revocar" — deja de existir al sobrescribirse ambos lados. Confirmar
   que la verificación de §4 sigue dando 0.

---

## 6. Fuera de alcance — decisiones para Sam

Encontrado de paso mientras se verificaba D.6. **Nada de esto se ejecutó.**

### 6.1 `iid_cron_secret` y `vercel_bypass_secret` ya están expuestos (§1.2)

Ambos viven en `intel.iid_scheduler_config`, tabla con `authenticated=arwd` + policy
`USING (true)`, en un schema expuesto por PostgREST. Cualquiera con un login puede leerlos.
Lo único entre eso y "cualquiera en internet" es si el signup público está abierto —
**CC no lo verificó: comprobarlo requiere crear una cuenta, y eso no lo hace CC.**
Primer paso sugerido: Dashboard → Auth → Providers → Email → ¿signup habilitado?

Mitigación (a decidir, no ejecutada):
```sql
-- Cerrar la lectura a authenticated; el acceso legítimo es vía service_role o SECURITY DEFINER.
drop policy intel_select on intel.iid_scheduler_config;
revoke all on intel.iid_scheduler_config from authenticated;
```
⚠️ Antes de aplicar: verificar qué código lee esa tabla como `authenticated`. Si el front la lee
con la anon/user key, esto lo rompe. `orchestrator_url` y `supabase_url` no son secretos y podrían
necesitar seguir siendo legibles → conviene partir la tabla, o mover solo los `*_secret` a Vault.

### 6.2 `intel.trigger_iid_agent` es invocable por RPC (probable, no confirmado)

Ambas sobrecargas son `SECURITY DEFINER` **sin ACL → EXECUTE a PUBLIC**; `anon` y `authenticated`
tienen `USAGE` sobre `intel`; `intel` está expuesto por PostgREST. Eso implica que
`POST /rest/v1/rpc/trigger_iid_agent` con `Content-Profile: intel` y la anon key (pública por
diseño, va en el bundle del front) dispararía agentes arbitrarios — y la función, al ser
`SECURITY DEFINER`, adjunta el `x-cron-secret` real por el llamante. El secreto deja de importar.

**No confirmado end-to-end:** el único test decisivo ejecuta la función y dispara efectos reales
en prod, y eso está gateado por Claude-chat/Sam. La sonda vía OpenAPI resultó inválida (devuelve
0 rutas incluso para `public`, donde sabemos que hay funciones → es un artefacto del endpoint, no
evidencia de permisos). La evidencia de grants es fuerte pero indirecta.

Mitigación sugerida (barata, conviene igual esté o no explotable — el cron corre como `postgres`,
que conserva EXECUTE como owner):
```sql
revoke all on function intel.trigger_iid_agent(text)        from public, anon, authenticated;
revoke all on function intel.trigger_iid_agent(text, jsonb) from public, anon, authenticated;
```

### 6.3 `meta_accounts.system_token` — D.6 / tarea 3.4

3 filas, 3 tokens, columna `text` plano. **Pero el control de acceso está bien:**

```
rls:      activa
grants:   postgres=arwdDxtm | service_role=arwdDxtm     ← NO authenticated, NO anon
policy:   service_role_only  USING (auth.role() = 'service_role')
```

No son legibles por `authenticated` ni `anon`. El riesgo es solo **at-rest**: quien tenga la
service_role key, un backup, o una sesión MCP como esta, los ve en claro.

**Prioridad relativa:** más baja que 6.1. La tabla que el brief marcó como preocupación está
cerrada; la que el brief proponía como destino seguro es la que está abierta.

**Opción y esfuerzo** (solo reporte, como pide el brief):

| Opción | Esfuerzo | Notas |
|---|---|---|
| Dejar como está | 0 | Access control ya correcto; el gap es solo cifrado at-rest |
| Mover a Vault + wrapper `SECURITY DEFINER` | Medio (~2-3h) | Mismo patrón que §3. Toca todo consumidor de `system_token` (lab-worker EF y quien más lea la columna) — hay que auditarlos primero. Rotación de tokens de Meta es delicada y va en su propia ventana |
| Cifrado a nivel columna (pgsodium TCE) | Alto | pgsodium no está instalado (solo `supabase_vault`). Deprecado a favor de Vault |

**Recomendación:** no tocar ahora. El beneficio marginal sobre el estado actual es bajo, y el
costo (auditar consumidores + ventana de rotación de tokens vivos de 3 marcas) es alto. Hacerlo
después de 6.1, que sí es una exposición real.
