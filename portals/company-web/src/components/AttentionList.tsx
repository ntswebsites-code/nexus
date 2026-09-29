import { attentionItems } from '@/data/reporting';

export function AttentionList() {
  return (
    <section className="card">
      <h2>What needs attention</h2>
      {attentionItems.map((item) => (
        <div className="task" key={item.title}>
          <span>
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </span>
          <span className={item.tone === 'good' ? 'pill good' : 'pill'}>{item.status}</span>
        </div>
      ))}
    </section>
  );
}
