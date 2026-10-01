/**
 * Per-deployment branding. Two deployments share this codebase:
 *  - dev.matanho.com — keeps the default Matanho branding (no env vars set).
 *  - matanho-*.nvccz.com (client) — set NEXT_PUBLIC_ORGANIZATION_LOGO=/nvccz-logo.png
 *    and NEXT_PUBLIC_ORGANIZATION_NAME=NVCCZ at build time (see deploy/nvccz/docker-compose.prod.yml).
 *
 * NEXT_PUBLIC_ORGANIZATION_LOGO already existed as a convention (read in a handful of
 * vendor/events pages) but was never wired to an actual build arg, and the main app
 * chrome (favicon, topbar, login) hardcoded /new_logo.png directly. This file is the
 * single source of truth so every touchpoint stays consistent.
 */
export const ORG_NAME = process.env.NEXT_PUBLIC_ORGANIZATION_NAME || 'Matanho'
export const ORG_LOGO_PATH = process.env.NEXT_PUBLIC_ORGANIZATION_LOGO || '/new_logo.png'
/** True when a non-default (client) logo is configured — used to skip Matanho-specific image filters (e.g. brightness-0 invert) that assume the default wordmark's colors. */
export const IS_CUSTOM_BRAND = Boolean(process.env.NEXT_PUBLIC_ORGANIZATION_LOGO)
