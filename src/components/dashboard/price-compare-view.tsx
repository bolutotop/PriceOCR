'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LayoutGrid, List, ChevronUp, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dispatch, SetStateAction } from 'react';

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

export default function PriceCompareView({
  activeCategory,
  sortedAndFilteredData,
  viewMode,
  setViewMode,
  sortConfig,
  setSortConfig
}: {
  activeCategory: string;
  sortedAndFilteredData: DashboardItem[];
  viewMode: 'grid' | 'list';
  setViewMode: Dispatch<SetStateAction<'grid' | 'list'>>;
  sortConfig: SortConfig;
  setSortConfig: Dispatch<SetStateAction<SortConfig>>;
}) {
  const router = useRouter();

  const handleSort = (key: SortConfig['key']) => {
    let direction: 'asc' | 'desc' | null = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
    else if (sortConfig.key === key && sortConfig.direction === 'asc') direction = null;
    setSortConfig({ key, direction });
  };

  const renderSortIcon = (key: SortConfig['key']) => {
    if (sortConfig.key !== key || !sortConfig.direction) return <div className="w-3 h-3 md:w-4 md:h-4 ml-0.5 md:ml-1 opacity-20"><ChevronUp className="w-3 h-3" /></div>;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3 md:w-4 md:h-4 ml-0.5 md:ml-1 text-slate-900" /> : <ChevronDown className="w-3 h-3 md:w-4 md:h-4 ml-0.5 md:ml-1 text-slate-900" />;
  };

  const formatFloat = (num: number) => Number(num.toFixed(1));

  const renderHistoryDiff = (latest: number | null, prev: number | null) => {
    if (!latest || latest <= 0 || !prev || prev <= 0) return <span className="text-slate-400 font-medium">-</span>;
    const diff = formatFloat(latest - prev);
    if (diff > 0) return <span className="text-red-600 font-bold text-xs sm:text-base">+{diff}</span>;
    if (diff < 0) return <span className="text-emerald-600 font-bold text-xs sm:text-base">{diff}</span>;
    return <span className="text-slate-400 font-bold text-xs sm:text-base">0</span>;
  };

  const renderCompareDiff = (diff: number | null) => {
    if (diff === null) return <span className="text-slate-300">-</span>;
    const safeDiff = formatFloat(diff);
    if (safeDiff > 0) return (
      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-0.5 sm:gap-1.5 justify-end">
        <span className="text-blue-600 font-bold tracking-tight text-[13px] sm:text-base leading-none">+{safeDiff}</span>
        <span className="text-[9px] sm:text-[11px] border border-blue-200 bg-blue-50 text-blue-700 px-1 py-0.5 font-bold whitespace-nowrap leading-none">卖快递</span>
      </div>
    );
    if (safeDiff < 0) return (
      <div className="flex flex-col sm:flex-row items-end sm:items-center gap-0.5 sm:gap-1.5 justify-end">
        <span className="text-emerald-600 font-bold tracking-tight text-[13px] sm:text-base leading-none">+{Math.abs(safeDiff)}</span>
        <span className="text-[9px] sm:text-[11px] border border-emerald-200 bg-emerald-50 text-emerald-700 px-1 py-0.5 font-bold whitespace-nowrap leading-none">卖广货</span>
      </div>
    );
    return <span className="text-slate-400 font-bold text-xs sm:text-base">0</span>;
  };

  return (
    <div className="p-2 sm:p-0">
      <div className="flex justify-between items-end mb-3 sm:mb-4 border-b border-slate-200/60 pb-2 sm:pb-3 px-2 sm:px-0">
        <div className="flex flex-col">
          <h2 className="text-xl font-black text-slate-800 tracking-tight hidden sm:block">{activeCategory}</h2>
          <span className="text-slate-500 text-xs font-bold mt-1">共 {sortedAndFilteredData.length} 条记录</span>
        </div>
        <div className="flex bg-slate-200/50 p-0.5 border border-slate-200/50 rounded-md">
          <button onClick={() => setViewMode('grid')} className={cn("p-1.5 transition-all ease-out rounded-sm", viewMode === 'grid' ? 'bg-white text-slate-800 shadow-sm font-bold scale-100' : 'text-slate-400 hover:text-slate-600 scale-95')}><LayoutGrid className="w-4 h-4"/></button>
          <button onClick={() => setViewMode('list')} className={cn("p-1.5 transition-all ease-out rounded-sm", viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm font-bold scale-100' : 'text-slate-400 hover:text-slate-600 scale-95')}><List className="w-4 h-4"/></button>
        </div>
      </div>

      {viewMode === 'list' && (
        <div className="bg-white border border-slate-200 shadow-sm -mx-2 sm:mx-0">
          <Table>
            <TableHeader className="bg-slate-50/80 border-b border-slate-200">
              <TableRow className="hover:bg-transparent border-none">
                <TableHead className="font-bold text-slate-700 w-[90px] sm:w-[120px] md:w-1/4 uppercase text-[10px] sm:text-xs cursor-pointer select-none px-2 sm:px-4" onClick={() => handleSort('name')}>
                  <div className="flex items-center">品种 {renderSortIcon('name')}</div>
                </TableHead>
                
                {activeCategory === '快递报价' && (
                  <>
                    <TableHead className="text-right font-bold text-blue-700 bg-blue-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('expressPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">最新 {renderSortIcon('expressPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-500 cursor-pointer select-none px-1 sm:px-4 hidden sm:table-cell" onClick={() => handleSort('expressPrev')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">昨日</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-700 pr-2 sm:pr-6 cursor-pointer select-none" onClick={() => handleSort('historyDiff')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">变动 {renderSortIcon('historyDiff')}</div>
                    </TableHead>
                  </>
                )}
                {activeCategory === '广货报价' && (
                  <>
                    <TableHead className="text-right font-bold text-emerald-700 bg-emerald-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('guanghuoPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">最新 {renderSortIcon('guanghuoPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-500 cursor-pointer select-none px-1 sm:px-4 hidden sm:table-cell" onClick={() => handleSort('guanghuoPrev')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">昨日</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-700 pr-2 sm:pr-6 cursor-pointer select-none" onClick={() => handleSort('historyDiff')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">变动 {renderSortIcon('historyDiff')}</div>
                    </TableHead>
                  </>
                )}
                {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
                  <>
                    <TableHead className="text-right font-bold text-blue-700 bg-blue-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('expressPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">快递 {renderSortIcon('expressPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-emerald-700 bg-emerald-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('guanghuoPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">广货 {renderSortIcon('guanghuoPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-800 pr-2 sm:pr-6 cursor-pointer select-none" onClick={() => handleSort('compareDiff')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">差价 {renderSortIcon('compareDiff')}</div>
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAndFilteredData.map(item => (
                <TableRow key={item.id} className="cursor-pointer hover:bg-slate-50 group border-b border-slate-100/60 transition-colors ease-out" onClick={() => router.push(`/product/${item.id}`)}>
                  <TableCell className="font-black text-slate-800 text-[13px] sm:text-base group-hover:text-blue-600 transition-colors ease-out px-2 sm:px-4 py-3 sm:py-4 truncate max-w-[90px] sm:max-w-full">
                    {item.name}
                  </TableCell>

                  {activeCategory === '快递报价' && (
                    <>
                      <TableCell className={`text-right font-mono font-black text-[13px] sm:text-base px-1 sm:px-4 ${!item.expressPrice || item.expressPrice <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-800'}`}>{!item.expressPrice || item.expressPrice <= 0 ? '暂无' : item.expressPrice}</TableCell>
                      <TableCell className={`text-right font-mono font-bold text-xs sm:text-[15px] px-1 sm:px-4 hidden sm:table-cell ${!item.expressPrev || item.expressPrev <= 0 ? 'text-slate-300 font-sans font-normal' : 'text-slate-500'}`}>{!item.expressPrev || item.expressPrev <= 0 ? '暂无' : item.expressPrev}</TableCell>
                      <TableCell className="text-right pr-2 sm:pr-6 font-mono">{renderHistoryDiff(item.expressPrice, item.expressPrev)}</TableCell>
                    </>
                  )}

                  {activeCategory === '广货报价' && (
                    <>
                      <TableCell className={`text-right font-mono font-black text-[13px] sm:text-base px-1 sm:px-4 ${!item.guanghuoPrice || item.guanghuoPrice <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-800'}`}>{!item.guanghuoPrice || item.guanghuoPrice <= 0 ? '暂无' : item.guanghuoPrice}</TableCell>
                      <TableCell className={`text-right font-mono font-bold text-xs sm:text-[15px] px-1 sm:px-4 hidden sm:table-cell ${!item.guanghuoPrev || item.guanghuoPrev <= 0 ? 'text-slate-300 font-sans font-normal' : 'text-slate-500'}`}>{!item.guanghuoPrev || item.guanghuoPrev <= 0 ? '暂无' : item.guanghuoPrev}</TableCell>
                      <TableCell className="text-right pr-2 sm:pr-6 font-mono">{renderHistoryDiff(item.guanghuoPrice, item.guanghuoPrev)}</TableCell>
                    </>
                  )}

                  {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
                    <>
                      <TableCell className={`text-right font-mono font-black text-[13px] sm:text-base px-1 sm:px-4 ${!item.expressPrice || item.expressPrice <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-800'}`}>{!item.expressPrice || item.expressPrice <= 0 ? '无数据' : item.expressPrice}</TableCell>
                      <TableCell className={`text-right font-mono font-black text-[13px] sm:text-base px-1 sm:px-4 ${!item.guanghuoPrice || item.guanghuoPrice <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-800'}`}>{!item.guanghuoPrice || item.guanghuoPrice <= 0 ? '无数据' : item.guanghuoPrice}</TableCell>
                      <TableCell className="text-right pr-2 sm:pr-6 font-mono">{renderCompareDiff(item.compareDiff)}</TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {viewMode === 'grid' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 sm:gap-4 mt-2">
          {sortedAndFilteredData.map(item => {
            let valLatest, valPrev, diffDisplay, titleLeft = '最新', titleRight = '昨日', titleDiff = '变动';
            if (activeCategory === '快递报价') { valLatest = item.expressPrice; valPrev = item.expressPrev; diffDisplay = renderHistoryDiff(valLatest, valPrev); }
            else if (activeCategory === '广货报价') { valLatest = item.guanghuoPrice; valPrev = item.guanghuoPrev; diffDisplay = renderHistoryDiff(valLatest, valPrev); }
            else { titleLeft = '快递'; titleRight = '广货'; titleDiff = '差价'; valLatest = item.expressPrice; valPrev = item.guanghuoPrice; diffDisplay = renderCompareDiff(item.compareDiff); }

            return (
              <Link href={`/product/${item.id}`} key={item.id} className="block h-full outline-none">
                <Card className="rounded-lg border-slate-200 bg-white hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200 ease-out h-full group overflow-hidden">
                  <CardContent className="p-0 flex flex-col h-full">
                    <div className="px-3 sm:px-4 py-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100"><h3 className="font-black text-slate-800 text-[15px] sm:text-base group-hover:text-blue-600 transition-colors ease-out truncate">{item.name}</h3></div>
                    <div className="grid grid-cols-3 p-3 gap-1 text-left bg-white relative">
                      <div className="flex flex-col"><span className="text-[10px] font-bold text-slate-400 mb-0.5">{titleLeft}</span><span className={`text-[15px] font-mono font-black tracking-tight ${!valLatest || valLatest <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!valLatest || valLatest <= 0 ? '//' : valLatest}</span></div>
                      <div className="flex flex-col border-l border-slate-100 pl-2"><span className="text-[10px] font-bold text-slate-400 mb-0.5">{titleRight}</span><span className={`text-[13px] font-mono font-bold tracking-tight mt-0.5 ${!valPrev || valPrev <= 0 ? 'text-slate-300' : 'text-slate-500'}`}>{!valPrev || valPrev <= 0 ? '//' : valPrev}</span></div>
                      <div className="flex flex-col border-l border-slate-100 pl-2"><span className="text-[10px] font-bold text-slate-400 mb-0.5">{titleDiff}</span><span className="text-[13px] font-mono tracking-tight mt-1">{diffDisplay}</span></div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      )}

      {sortedAndFilteredData.length === 0 && (
        <div className="mt-4 p-8 bg-white/50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center text-center"><Search className="w-8 h-8 text-slate-300 mb-2"/><h3 className="text-slate-600 font-bold text-sm">未查找到匹配品种</h3><p className="text-slate-400 text-xs mt-1">换个搜索词试试</p></div>
      )}
    </div>
  );
}
