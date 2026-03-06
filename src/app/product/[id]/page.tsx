import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProductDetails } from '@/actions/get-product-details';
import { PriceChart } from '@/components/price-chart';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, TrendingUp, History } from 'lucide-react';
import { format } from 'date-fns';

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProductDetails(id);

  if (!data) return notFound();
  
  const { product, chartData, latestExpressPrice, latestGuanghuoPrice } = data;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200/50 pb-12 flex flex-col font-sans">
      
      {/* 顶部导航：毛玻璃、无圆角、锐利分割线 */}
      <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-20 px-4 md:px-6 py-3 flex items-center shrink-0">
        <Link href="/" className="group flex items-center gap-2 outline-none">
          <div className="p-1.5 border border-transparent group-hover:bg-slate-800 group-hover:text-white text-slate-600 transition-colors ease-out">
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </div>
          <span className="font-black text-slate-800 tracking-tight group-hover:text-slate-900 transition-colors ease-out">返回看板</span>
        </Link>
      </header>

      <main className="flex-1 w-full max-w-5xl mx-auto p-3 sm:p-5 md:p-8 space-y-6">
        
        {/* 顶部行情面板：工业网格、硬阴影、无圆角 */}
        <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] flex flex-col">
          <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/50">
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight truncate">{product.name}</h1>
          </div>
          
          <div className="grid grid-cols-2 divide-x divide-slate-200 bg-slate-50">
            {/* 快递区 */}
            <div className="p-4 sm:p-6 flex flex-col bg-white hover:bg-slate-50/50 transition-colors ease-out">
              <span className="text-[10px] sm:text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 inline-block w-max mb-3 tracking-widest uppercase">
                快递行情
              </span>
              <div className="text-3xl sm:text-5xl font-mono font-black tracking-tighter text-slate-800 mt-auto">
                {latestExpressPrice && latestExpressPrice > 0 ? (
                  <>
                    <span className="text-xl sm:text-2xl text-slate-400 mr-1">¥</span>
                    {latestExpressPrice}
                  </>
                ) : (
                  <span className="text-xl text-slate-300">缺数</span>
                )}
              </div>
            </div>
            
            {/* 广货区 */}
            <div className="p-4 sm:p-6 flex flex-col bg-white hover:bg-slate-50/50 transition-colors ease-out">
              <span className="text-[10px] sm:text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 inline-block w-max mb-3 tracking-widest uppercase">
                广货行情
              </span>
              <div className="text-3xl sm:text-5xl font-mono font-black tracking-tighter text-slate-800 mt-auto">
                {latestGuanghuoPrice && latestGuanghuoPrice > 0 ? (
                  <>
                    <span className="text-xl sm:text-2xl text-slate-400 mr-1">¥</span>
                    {latestGuanghuoPrice}
                  </>
                ) : (
                  <span className="text-xl text-slate-300">缺数</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 价格走势图 */}
        <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)]">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-slate-500 stroke-[2.5]" /> 
            <h2 className="text-sm font-black text-slate-800 tracking-tight">大盘走势对比</h2>
          </div>
          <div className="p-2 sm:p-4 h-[300px]">
            {chartData.length > 0 ? (
              <PriceChart data={chartData} />
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 text-sm font-bold bg-slate-50/50 border border-dashed border-slate-200 m-2">
                无可用走势数据
              </div>
            )}
          </div>
        </div>

        {/* 历史流水 */}
        <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)]">
          <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/80 flex items-center gap-2">
            <History className="w-4 h-4 text-slate-500 stroke-[2.5]" /> 
            <h2 className="text-sm font-black text-slate-800 tracking-tight">历史报价明细</h2>
            <span className="ml-auto text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5">
              {product.priceHistory.length} ROWS
            </span>
          </div>
          
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-slate-50 border-b border-slate-200">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="font-bold text-slate-500 w-[90px] sm:w-[120px] uppercase text-[10px] sm:text-xs px-4">日期</TableHead>
                  <TableHead className="font-bold text-slate-500 uppercase text-[10px] sm:text-xs px-4">单据来源</TableHead>
                  <TableHead className="text-right font-bold text-slate-500 pr-4 sm:pr-6 uppercase text-[10px] sm:text-xs">录入价</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...product.priceHistory].reverse().map((history) => {
                  const isExpress = history.sheet.marketType === 'EXPRESS';
                  return (
                    <TableRow key={history.id} className="hover:bg-slate-50/80 transition-colors ease-out border-b border-slate-100">
                      <TableCell className="font-mono text-xs sm:text-sm text-slate-600 font-bold px-4 whitespace-nowrap">
                        {format(new Date(history.sheet.recordDate), 'MM.dd')}
                      </TableCell>
                      <TableCell className="px-4 py-3">
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-1.5 sm:gap-3">
                          <span className={`text-[9px] sm:text-[10px] font-bold px-1.5 py-0.5 whitespace-nowrap border ${isExpress ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                            {isExpress ? '快递' : '广货'}
                          </span>
                          {history.sheet.title && (
                            <span className="text-[11px] sm:text-xs text-slate-500 font-medium truncate max-w-[120px] sm:max-w-xs">{history.sheet.title}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className={`text-right font-mono font-black text-sm sm:text-base pr-4 sm:pr-6 ${history.price <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>
                        {history.price <= 0 ? '//' : history.price}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {product.priceHistory.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-12 text-slate-400 text-sm font-bold bg-slate-50/50">
                      暂无关联数据
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>

      </main>
    </div>
  );
}