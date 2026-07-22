import Page from '@/components/Page';
import CashboxClient from '@/components/CashboxClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export default function CashboxPage() {
  return (
    <Page title="الصندوق">
      <CashboxClient />
    </Page>
  );
}
