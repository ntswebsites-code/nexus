import { AttentionList } from '@/components/AttentionList';
import { PortalHeader } from '@/components/PortalHeader';
import { ReportingHero } from '@/components/ReportingHero';
import { ReportingStatus } from '@/components/ReportingStatus';
import { SubmitPackCard } from '@/components/SubmitPackCard';
import { ToastProvider } from '@/components/Toast';

export default function CompanyPortalPage() {
  return (
    <ToastProvider>
      <main className="shell">
        <PortalHeader />
        <ReportingHero />
        <ReportingStatus />
        <div className="grid">
          <AttentionList />
          <SubmitPackCard />
        </div>
      </main>
    </ToastProvider>
  );
}
