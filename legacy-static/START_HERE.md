# Matanho Nexus V56 — Deployment Pack

This folder is the **repository root**. It contains only the files required to run the static prototype plus deployment configuration.

## GitHub — easiest route

1. Create a new **empty** GitHub repository.
2. Open this folder on your computer.
3. In GitHub, choose **Add file → Upload files**.
4. Drag **all contents of this folder** into the upload area and commit to `main`.
   - If your upload method supports dragging the folder as a repository root, use the whole folder.
   - The important point is that `index.html` must end up at the root of the repository, not one directory deeper.
5. For GitHub Pages, open **Settings → Pages → Build and deployment → Source → GitHub Actions**.
6. The included `.github/workflows/pages.yml` publishes the static site automatically on each push to `main` or `master`.

## Vercel

Recommended flow after GitHub upload:

1. In Vercel choose **Add New → Project**.
2. Import the GitHub repository.
3. Framework preset: **Other**.
4. Root directory: `./`.
5. Leave **Build Command** empty.
6. Leave **Output Directory** empty.
7. Deploy.

`vercel.json` is already included. There is no npm install, package build, lockfile, or framework compilation step.

## Entry points

- `/` → `index.html` — administrator / investment-management workspace
- `/client-portal` → `client-portal.html`
- `/public-onboarding` → `public-onboarding.html`
- `/company-portal` → `company-portal.html`

## Before a production launch

This package is a static functional prototype. Production use still requires persistent backend services, institutional IAM/RBAC, secure secret management, licensed ZSE/VFEX data, real bank/custodian/broker integrations, audit-grade evidence storage, production OMS/IBOR/ABOR services, and approved operational controls.
