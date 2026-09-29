import { reportingCompany } from '@/data/reporting';

export function ReportingHero() {
  return (
    <section className="hero">
      <div>
        <span>{reportingCompany.name}</span>
        <h1>Monthly reporting</h1>
        <p>
          Submit the numbers once. The investment team reviews the controlled pack in Private Markets.
        </p>
      </div>
      <button className="btn">Reporting guide</button>
    </section>
  );
}
