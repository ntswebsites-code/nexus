import { SharePage } from '@/components/SharePage';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SharePage token={token} />;
}
