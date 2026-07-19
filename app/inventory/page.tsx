import Link from 'next/link';
import Page from '@/components/Page';
import { CreditCard, ShoppingBag } from 'lucide-react';

const sheinImage =
  'https://images.unsplash.com/photo-1607083206968-13611e3d76db?auto=format&fit=crop&w=1200&q=80';
const cardsImage =
  'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=1200&q=80';

export default function InventoryPage() {
  return (
    <Page title="المخزن">
      <div className="grid gap-5 md:grid-cols-2">
        <InventoryCard
          href="/inventory/shein-cards"
          title="مخزن كروت شي إن"
          description="إدارة فئات الكروت، حالات البيع والحجز، وسجل الحركة لكل كرت."
          image={sheinImage}
          icon={<ShoppingBag size={28} />}
        />
        <InventoryCard
          href="/inventory/received-cards"
          title="مخزن البطاقات المستلمة"
          description="تسجيل بطاقات الزبائن المستلمة، المتبقي، المصرف، وآخر 4 أرقام فقط."
          image={cardsImage}
          icon={<CreditCard size={28} />}
        />
      </div>
    </Page>
  );
}

function InventoryCard({
  href,
  title,
  description,
  image,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  image: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group relative min-h-72 overflow-hidden rounded-lg border border-white/10 bg-slate-900 shadow-2xl"
    >
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-70 transition duration-500 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-slate-950/10" />
      <div className="relative flex h-full min-h-72 flex-col justify-end p-6 text-white">
        <div className="mb-4 grid h-12 w-12 place-items-center rounded-lg bg-white/15 backdrop-blur">{icon}</div>
        <h2 className="text-2xl font-black">{title}</h2>
        <p className="mt-3 max-w-md text-sm leading-7 text-slate-200">{description}</p>
      </div>
    </Link>
  );
}
