import { SignPage } from '@/components/SignPage';

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <SignPage token={token} />;
}
