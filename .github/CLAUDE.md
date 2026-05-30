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
