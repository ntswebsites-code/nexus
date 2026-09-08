# Matanho Nexus V56 — GitHub + Vercel Ready

Static deployment package for the Matanho Nexus institutional investment-management prototype.

## No build step

This project intentionally has **no `package.json` and no npm build step**. It is deployed directly as static HTML/CSS/JavaScript, avoiding `npm ci` and lockfile deployment issues.

See `START_HERE.md` for drag-and-drop GitHub and Vercel deployment instructions.

## Main pages

- `index.html`
- `client-portal.html`
- `public-onboarding.html`
- `company-portal.html`

## Deployment configuration

- `vercel.json` — Vercel static hosting configuration
- `.github/workflows/pages.yml` — GitHub Pages deployment workflow
- `.nojekyll` — ensures GitHub Pages serves the static assets directly
