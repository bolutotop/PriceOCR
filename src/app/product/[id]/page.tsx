import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductDetails } from '@/actions/get-product-details';
import { PriceChart } from '@/components/price-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, TrendingUp, Calendar } from 'lucide-react';
import { format } from 'date-fns';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProductDetails(id);

  if (!data) return notFound();
  
  const { product, chartData, latestExpressPrice, latestGuanghuoPrice } = data;

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      {/* 顶部导航 */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10 flex items-center gap-2">
        <Link href="/">
          <Button variant="ghost" size="icon" className="-ml-2 text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="font-bold text-slate-800">{product.name}</h1>
      </div>

      <div className="max-w-4xl mx-auto p-4 space-y-6 mt-4">
        
        {/* 顶部：极简卡片，突出两大行情最新报价 */}
        <Card className="border-none shadow-sm overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <h2 className="text-3xl font-black text-slate-900 mb-6">{product.name}</h2>
            
            <div className="grid grid-cols-2 gap-4 md:gap-8 divide-x divide-slate-100">
              {/* 快递最新价 */}
              <div className="pr-4">
                <div className="flex items-center gap-2 mb-2">
                   <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">🚀 快递行情</Badge>
                </div>
                <div className="text-4xl font-mono font-black text-slate-800 tracking-tight">
                  {latestExpressPrice && latestExpressPrice > 0 ? `¥${latestExpressPrice}` : <span className="text-slate-300">无货</span>}
                </div>
              </div>
              
              {/* 广货最新价 */}
              <div className="pl-4 md:pl-8">
                <div className="flex items-center gap-2 mb-2">
                   <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">📦 广货行情</Badge>
                </div>
                <div className="text-4xl font-mono font-black text-slate-800 tracking-tight">
                  {latestGuanghuoPrice && latestGuanghuoPrice > 0 ? `¥${latestGuanghuoPrice}` : <span className="text-slate-300">无货</span>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 价格走势图区域 (双折线) */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4 border-b border-slate-100">
            <CardTitle className="text-base flex items-center gap-2 font-bold text-slate-800">
              <TrendingUp className="w-4 h-4 text-blue-600" /> 
              大盘走势对比
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {chartData.length > 0 ? (
              <PriceChart data={chartData} />
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-400 text-sm">暂无走势数据</div>
            )}
          </CardContent>
        </Card>

        {/* 历史记录明细表 */}
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-4 border-b border-slate-100">
            <CardTitle className="text-base flex items-center gap-2 font-bold text-slate-800">
              <Calendar className="w-4 h-4 text-slate-500" /> 
              历史报价流水
            </CardTitle>
          </CardHeader>
          <div className="overflow-hidden rounded-b-lg">
            <Table>
              <TableHeader className="bg-slate-50/80">
                <TableRow>
                  <TableHead className="w-[100px] md:w-[140px] font-bold text-slate-600">日期</TableHead>
                  <TableHead className="font-bold text-slate-600">行情 / 备注</TableHead>
                  <TableHead className="text-right font-bold text-slate-600 pr-6">价格</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* 倒序显示，最近的在上面 */}
                {[...product.priceHistory].reverse().map((history) => {
                  const isExpress = history.sheet.marketType === 'EXPRESS';
                  return (
                    <TableRow key={history.id} className="hover:bg-slate-50 transition-colors">
                      <TableCell className="font-mono text-sm text-slate-500 font-medium">
                        {format(new Date(history.sheet.recordDate), 'MM-dd')}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 font-medium ${isExpress ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                            {isExpress ? '快递' : '广货'}
                          </Badge>
                          {history.sheet.title && (
                            <span className="text-xs text-slate-400 mt-1">{history.sheet.title}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right font-mono font-bold text-base pr-6 ${history.price > 1000 ? 'text-red-600' : 'text-slate-800'}`}>
                        {history.price <= 0 ? <span className="text-slate-300 font-normal">无货</span> : `¥${history.price}`}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {product.priceHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-10 text-slate-400">暂无任何流水记录</TableCell>
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