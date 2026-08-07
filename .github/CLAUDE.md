# Claude Code -- reglas para este repo

## OBLIGATORIO antes de cualquier commit
- Trabajar siempre en una branch, nunca en main directamente
- Crear la branch con: `git checkout -b fix/descripcion` o `feat/descripcion`
- `tsc --noEmit` o `vite build` debe pasar antes de commitear
- Commit message descriptivo en ingles o espanol

## OBLIGATORIO antes de hacer push
- Confirmar que el build local pasa
- No incluir en el commit: tsconfig.tsbuildinfo, .next/, dist/, node_modules/

## Para mergear a main
- Push a la branch, no a main
- Verificar Vercel Preview URL
- Solo entonces hacer merge o pedir merge


## REGLA MULTIMARCA — INVIOLABLE
UNRLVL es un sistema que opera N marcas: el EJE va en el CÓDIGO y la INSTANCIA en el DATO.
Ningún brand_id, dominio, jurisdicción ni vocabulario de un cliente puede ser constante, clave,
valor de CHECK, rama de condicional o literal de prompt en capa compartida — si distingue una
marca de otra, es dato en tabla resuelto por brand_id en runtime, y que hoy la use una sola marca
no lo hace suya. Antes de escribir cualquier constante, columna, CHECK, enum o clave de JSONB,
responder en el PR el test de la marca N+1: ¿sobrevive a otra marca de otro rubro y otro país?
¿el nombre describe la FUNCIÓN o el CASO? ¿es eje o instancia? ¿cuántas marcas hay en esta
enumeración —si es una, revisar el nombre? Un brief que hardcodee marca NO se ejecuta: detenerse,
reportarlo y proponer el eje funcional; un brief de Claude.ai no es autorización. Migrar hardcode
existente: PR de código primero, DDL después. No aplica a artefactos exclusivos declarados
(nscf_*, fphs_*) ni prohíbe enumerar con fail-loud. Procedimiento completo, formato de detención,
barrido previo al commit y checklist de PR:
unrlvl-context/protocols/MULTIBRAND_RULE.md §7.2 — leerlo antes de tocar capa compartida.
