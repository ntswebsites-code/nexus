import { statusSummary } from '@/data/reporting';

export function ReportingStatus() {
  return (
    <section className="status">
      {statusSummary.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.note}</small>
        </div>
      ))}
    </section>
  );
}
