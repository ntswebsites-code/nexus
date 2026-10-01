'use client';

import { api, ops } from './api';
import { useCan } from './session';
import type { ClientOption, CompanyOption, Fund } from './types';
import { useResource } from './ui';

/** Staff clients list (existing endpoint). `uuid` is what the ops API takes as `clientId`. */
export function useClients() {
  const allowed = useCan('clients.view');
  return useResource<ClientOption[]>(
    () => (allowed ? api.get<ClientOption[]>('/api/v1/clients') : Promise.resolve([])),
    [allowed],
  );
}

export function useFunds() {
  return useResource<Fund[]>(() => api.get<Fund[]>(ops('/funds')), []);
}

/** Portfolio companies (existing staff endpoint); `id` is the company ref. */
export function useCompanies() {
  const allowed = useCan('portfolio.view');
  return useResource<CompanyOption[]>(
    () => (allowed ? api.get<CompanyOption[]>('/api/v1/private-markets/companies') : Promise.resolve([])),
    [allowed],
  );
}

export function ClientSelect({ name, required, defaultValue }: { name: string; required?: boolean; defaultValue?: string }) {
  const clients = useClients();
  const allowed = useCan('clients.view');
  if (!allowed) {
    return <input className="ops-input" name={name} required={required} placeholder="Client id" defaultValue={defaultValue} />;
  }
  return (
    <select className="ops-input" name={name} required={required} defaultValue={defaultValue ?? ''}>
      <option value="" disabled={required}>
        {clients.state === 'loading' ? 'Loading clients…' : clients.state === 'error' ? 'Clients unavailable' : 'Select a client'}
      </option>
      {clients.state === 'ok' &&
        clients.data.map((c) => (
          <option key={c.uuid} value={c.uuid}>
            {c.name} ({c.id})
          </option>
        ))}
    </select>
  );
}

export function FundSelect({
  name,
  required,
  defaultValue,
  onChange,
  allowAll,
}: {
  name: string;
  required?: boolean;
  defaultValue?: string;
  onChange?: (fundId: string) => void;
  allowAll?: string;
}) {
  const funds = useFunds();
  return (
    <select
      className="ops-input"
      name={name}
      required={required}
      defaultValue={defaultValue ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value="" disabled={required && !allowAll}>
        {funds.state === 'loading' ? 'Loading funds…' : funds.state === 'error' ? 'Funds unavailable' : allowAll ?? 'Select a fund'}
      </option>
      {funds.state === 'ok' &&
        funds.data.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name} ({f.currency})
          </option>
        ))}
    </select>
  );
}

export function CompanySelect({ name, required }: { name: string; required?: boolean }) {
  const companies = useCompanies();
  const allowed = useCan('portfolio.view');
  if (!allowed) return <input className="ops-input" name={name} required={required} placeholder="Company id" />;
  return (
    <select className="ops-input" name={name} required={required} defaultValue="">
      <option value="" disabled>
        {companies.state === 'loading' ? 'Loading companies…' : companies.state === 'error' ? 'Companies unavailable' : 'Select a company'}
      </option>
      {companies.state === 'ok' &&
        companies.data.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.id})
          </option>
        ))}
    </select>
  );
}

export function fundLabel(x: { fundName?: string | null; fund?: { name?: string; shortName?: string } | null; fundId: string }) {
  return x.fundName ?? x.fund?.name ?? x.fund?.shortName ?? x.fundId;
}

export function clientLabel(x: {
  clientName?: string | null;
  lpLegalNameSnapshot?: string | null;
  client?: { name?: string } | null;
  clientId: string;
}) {
  return x.clientName ?? x.lpLegalNameSnapshot ?? x.client?.name ?? x.clientId;
}
