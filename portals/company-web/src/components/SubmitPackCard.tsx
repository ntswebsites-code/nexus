'use client';

import { uploadSlots } from '@/data/reporting';
import { useToast } from './Toast';

export function SubmitPackCard() {
  const { show } = useToast();

  return (
    <aside className="card">
      <h2>Submit reporting pack</h2>
      {uploadSlots.map((slot) => (
        <div className="upload" key={slot.id}>
          <label>{slot.label}</label>
          <input type="file" id={slot.id} />
        </div>
      ))}
      <div className="actions">
        <button className="btn">Save draft</button>
        <button className="btn primary" id="submit" onClick={() => show('Reporting pack submitted for review')}>
          Submit pack
        </button>
      </div>
    </aside>
  );
}
