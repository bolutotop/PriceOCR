import { getDashboardData } from '@/actions/get-dashboard-data';
import { getInventory } from '@/actions/inventory';
import DashboardClient from '@/components/dashboard-client';

// 强制动态渲染，保证每次刷新都能看到最新存入的价格
export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const data = await getDashboardData();
  const inventoryRes = await getInventory();
  const inventoryData = inventoryRes.data || [];
  return <DashboardClient initialData={data} initialInventoryData={inventoryData} />;
}