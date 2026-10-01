'use client';

/** Persistent marker on every page that renders fixture data instead of live records. */
export function DemoRibbon({ note }: { note?: string }) {
  return (
    <div
      role="status"
      data-testid="demo-ribbon"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 14,
        transform: 'translateX(-50%)',
        zIndex: 9000,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 14px',
        borderRadius: 999,
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        color: '#78350f',
        fontSize: 12.5,
        fontWeight: 600,
        boxShadow: '0 6px 18px rgba(120,53,15,.18)',
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">●</span>
      Demo data — this page shows sample records, not your live data{note ? ` · ${note}` : ''}
    </div>
  );
}
