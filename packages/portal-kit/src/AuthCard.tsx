import type { ReactNode } from 'react';
import { ApiError, PORTALS, type PortalId } from '@matanho/shared';

/** Branded card shared by sign-in, invitation, password reset and MFA screens. */
export function AuthCard({
  portal,
  title,
  children,
  foot = 'One Matanho account works across every portal you are authorised to use.',
}: {
  portal: PortalId;
  title: string;
  children: ReactNode;
  foot?: ReactNode;
}) {
  return (
    <main className="mx-login">
      <style>{authCss}</style>
      <section className="mx-card" aria-labelledby="mx-title">
        <div className="mx-brand">
          <img src="/assets/matanho-logo.png" alt="Matanho" />
        </div>
        <div className="mx-eyebrow">{PORTALS[portal].name.toUpperCase()}</div>
        <h1 id="mx-title">{title}</h1>
        {children}
        {foot && <p className="mx-foot">{foot}</p>}
      </section>
    </main>
  );
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? (
    <p className="mx-error" role="alert">
      {error}
    </p>
  ) : null;
}

export const authCss = `
.mx-login{min-height:100vh;display:grid;place-items:center;padding:24px;background:#f5f7fa;color:#000;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.mx-login *{box-sizing:border-box}
.mx-card{width:min(420px,100%);background:#fff;border:1px solid #e1e7ef;border-radius:14px;padding:26px;box-shadow:0 8px 28px rgba(15,34,65,.07)}
.mx-brand{margin-bottom:16px}
.mx-brand img{display:block;width:min(220px,100%);height:auto}
.mx-eyebrow{font-size:11px;color:#5364a9;letter-spacing:.12em;font-weight:850}
.mx-card h1{font-size:25px;letter-spacing:-.035em;margin:6px 0 16px;font-weight:790}
.mx-card form{display:grid;gap:12px}
.mx-card label{display:grid;gap:5px;font-size:11px;color:#4b586b;font-weight:700}
.mx-card input{border:1px solid #d5dde8;border-radius:8px;min-height:38px;padding:8px 10px;font:inherit;font-size:13px;outline:0}
.mx-card input:focus{border-color:#8297e9;box-shadow:0 0 0 3px rgba(49,88,232,.08)}
.mx-card input.mx-code{font-size:20px;letter-spacing:.35em;text-align:center;font-variant-numeric:tabular-nums}
.mx-btn{height:38px;border:1px solid #d7dee8;border-radius:9px;padding:0 14px;background:#fff;color:#1d2a3b;font:inherit;font-size:12px;font-weight:760;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.mx-btn.primary{background:linear-gradient(135deg,#3158e8,#4d68e7);border-color:transparent;color:#fff}
.mx-btn.block{width:100%}
.mx-btn:disabled{opacity:.55;cursor:not-allowed}
.mx-actions{display:flex;gap:8px}
.mx-muted{font-size:12px;color:#4d5868;margin:0 0 14px;line-height:1.5}
.mx-link{background:none;border:0;padding:0;font:inherit;font-size:12px;color:#3158e8;font-weight:700;cursor:pointer;text-decoration:none;justify-self:start}
.mx-secret{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;letter-spacing:.08em;background:#f3f6fb;border:1px solid #e1e7ef;border-radius:8px;padding:10px;word-break:break-all;margin:0 0 12px}
.mx-ok{margin:0 0 12px;font-size:12px;color:#17603d;background:#eefaf3;border:1px solid #c5e8d4;border-radius:8px;padding:8px 10px}
.mx-error{margin:0;font-size:12px;color:#a9253e;background:#fff0f3;border:1px solid #edc7cf;border-radius:8px;padding:8px 10px}
.mx-foot{margin:18px 0 0;font-size:11px;color:#6f7b8c;line-height:1.5}
`;

export function errorMessage(e: unknown, fallback = 'Unable to reach the sign-in service. Try again shortly.') {
  return e instanceof ApiError ? e.message : fallback;
}

/** Only allow same-site relative redirects after sign-in. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/';
}
