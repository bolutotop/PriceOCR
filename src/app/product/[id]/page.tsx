import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductDetails } from '@/actions/get-product-details';
import { PriceChart } from '@/components/price-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, TrendingUp, Calendar, Tag } from 'lucide-react';
import { format } from 'date-fns';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next.js 15+ 中 params 需要 await
  const { id } = await params;
  const data = await getProductDetails(id);

  if (!data) return notFound();
  
  const { product, chartData } = data;
  const latestPrice = chartData.length > 0 ? chartData[chartData.length - 1].price : null;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      {/* 顶部导航 */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10 flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="icon" className="-ml-2 text-slate-600">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="font-bold text-slate-800">{product.name}</h1>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6">
        
        {/* 顶部基本信息卡片 */}
        <Card className="border-none shadow-sm">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant="secondary" className="bg-slate-100 text-slate-600 hover:bg-slate-200">
                    <Tag className="w-3 h-3 mr-1" />
                    {product.category?.name || '未分类'}
                  </Badge>
                </div>
                <h2 className="text-2xl font-extrabold text-slate-900">{product.name}</h2>
              </div>
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-1">最新报价</p>
                <div className="text-3xl font-mono font-bold text-blue-600">
                  {latestPrice ? `¥${latestPrice}` : '--'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 价格走势图区域 */}
        <Card>
          <CardHeader className="pb-2 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" /> 
              价格走势 (近 {chartData.length} 次记录)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <PriceChart data={chartData} />
          </CardContent>
        </Card>

        {/* 历史记录明细表 */}
        <Card>
          <CardHeader className="pb-2 border-b">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" /> 
              历史报价明细
            </CardTitle>
          </CardHeader>
          <div className="overflow-hidden rounded-b-lg">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="w-[120px]">日期</TableHead>
                  <TableHead>来源/备注</TableHead>
                  <TableHead className="text-right">价格</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* 倒序显示，最近的在上面 */}
                {[...product.priceHistory].reverse().map((history) => (
                  <TableRow key={history.id}>
                    <TableCell className="font-mono text-slate-600">
                      {format(new Date(history.sheet.recordDate), 'yyyy-MM-dd')}
                    </TableCell>
                    <TableCell className="text-slate-500 text-xs">
                      {history.sheet.title || '日常报价'}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold ${history.price > 1000 ? 'text-red-500' : ''}`}>
                      {history.price <= 0 ? '//' : history.price}
                    </TableCell>
                  </TableRow>
                ))}
                {product.priceHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-6 text-slate-400">暂无历史记录</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

      </div>
    </div>
  );
}