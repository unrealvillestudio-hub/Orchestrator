# Workflow de desarrollo — Orchestrator

## Regla principal
**Nunca pushear directamente a `main`.** Todo cambio va por PR.

## Flujo estándar

1. Crear branch desde main:
```
git checkout main && git pull
git checkout -b fix/descripcion-corta
```

2. Desarrollar y commitear en la branch

3. Push y abrir PR hacia main:
```
git push origin fix/descripcion-corta
```
   GitHub → New Pull Request → base: main ← compare: tu-branch

4. Vercel genera automáticamente una **Preview URL** para el PR.
   Probar ahí antes de mergear.

5. Completar el checklist del PR template.

6. Mergear a main → deploy automático a producción.

## Convenciones de nombre de branch
- `fix/descripcion`     — bug fixes
- `feat/descripcion`    — features nuevas
- `chore/descripcion`   — config, deps, docs
- `hotfix/descripcion`  — fixes urgentes de producción

## Si un deploy de main se rompe
1. Vercel → proyecto → Deployments → seleccionar el último READY bueno
2. Click "Promote to Production" (instant rollback)
3. Abrir branch `hotfix/descripcion` para el fix real
4. PR normal → preview → merge

## Preview URLs
Cada PR genera una URL única:
`https://[repo]-git-[branch]-unrealvillestudio-projects.vercel.app`
