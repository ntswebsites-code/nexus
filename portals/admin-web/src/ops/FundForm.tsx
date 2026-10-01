'use client';

import type { Fund } from './types';
import { Field, FieldGrid, optStr, str } from './ui';

/** Fund master fields shared by create and edit. */
export function FundFields({ fund }: { fund?: Fund }) {
  return (
    <FieldGrid>
      <Field label="Fund name" span={2}>
        <input className="ops-input" name="name" required maxLength={200} defaultValue={fund?.name} />
      </Field>
      <Field label="Short name">
        <input className="ops-input" name="shortName" required maxLength={80} defaultValue={fund?.shortName} />
      </Field>
      <Field label="Currency">
        <input className="ops-input" name="currency" required minLength={3} maxLength={3} defaultValue={fund?.currency ?? 'USD'} style={{ textTransform: 'uppercase' }} />
      </Field>
      <Field label="Operating model">
        <select className="ops-input" name="operatingModel" defaultValue={fund?.operatingModel ?? 'PRIVATE_CAPITAL'}>
          <option value="PRIVATE_CAPITAL">Private capital (commitments and calls)</option>
          <option value="OPEN_ENDED">Open-ended (dealing)</option>
        </select>
      </Field>
      <Field label="Vintage">
        <input className="ops-input" name="vintage" type="number" min={1950} max={2100} defaultValue={fund?.vintage ?? ''} />
      </Field>
      <Field label="Public reference">
        <input className="ops-input" name="publicReference" maxLength={40} defaultValue={fund?.publicReference ?? ''} />
      </Field>
      <Field label="Default share class">
        <input className="ops-input" name="defaultShareClass" maxLength={32} defaultValue={fund?.defaultShareClass ?? ''} />
      </Field>
      <Field label="LP portal" span={2}>
        <label className="ops-check">
          <input type="checkbox" name="portalVisible" defaultChecked={fund?.portalVisible ?? true} /> Visible to LPs with a commitment or holding
        </label>
      </Field>
    </FieldGrid>
  );
}

export function fundPayload(fd: FormData) {
  const vintage = str(fd, 'vintage');
  return {
    name: str(fd, 'name'),
    shortName: str(fd, 'shortName'),
    currency: str(fd, 'currency').toUpperCase(),
    operatingModel: str(fd, 'operatingModel'),
    vintage: vintage ? Number(vintage) : undefined,
    publicReference: optStr(fd, 'publicReference'),
    defaultShareClass: optStr(fd, 'defaultShareClass'),
    portalVisible: fd.get('portalVisible') === 'on',
  };
}
