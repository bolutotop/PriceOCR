'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronUp, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dispatch, SetStateAction } from 'react';

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

// ==========================================
// 提取独立可编辑的价格单元格
// ==========================================
function PriceInputCell({ 
  value, 
  onSave, 
  className 
}: { 
  value: number | null, 
  onSave: (val: number) => void,
  className?: string
}) {
  const [val, setVal] = useState(value !== null && value > 0 ? String(value) : '');
  
  // 当外部 value 变化时，同步内部状态（例如其它端修改或刷新）
  useEffect(() => {
    setVal(value !== null && value > 0 ? String(value) : '');
  }, [value]);

  const handleBlur = () => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0 && num !== value) {
      onSave(num);
    } else if (val === '' && value !== null && value !== 0) {
      // 允许清零或者不处理，目前设计：不清零，恢复原状
      setVal(String(value));
    }
  };

  return (
    <input
      type="number"
      value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={handleBlur}
      className={cn(
        "w-full h-full min-h-[40px] px-2 bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-blue-400 rounded-sm text-right font-mono font-black transition-all", 
        val === '' ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-800',
        className
      )}
      placeholder="点此输入"
    />
  );
}

// ==========================================
// 提取可编辑的数据行
// ==========================================
function PriceCompareRow({ 
  item, 
  activeCategory, 
  onUpdateProductPrice,
  router 
}: { 
  item: DashboardItem, 
  activeCategory: string,
  onUpdateProductPrice: (id: string, fieldType: 'expressPrice' | 'guanghuoPrice', newPrice: number) => Promise<void>,
  router: any
}) {
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
    <TableRow className="hover:bg-slate-50 group border-b border-slate-100/60 transition-colors ease-out">
      <TableCell className="font-black text-slate-800 text-[13px] sm:text-base group-hover:text-blue-600 transition-colors ease-out px-2 sm:px-4 py-1 sm:py-2 truncate max-w-[90px] sm:max-w-full">
        { /* 点击文字依然可以跳转详情 */ }
        <span className="cursor-pointer" onClick={() => router.push(`/product/${item.id}`)}>{item.name}</span>
      </TableCell>

      {activeCategory === '快递报价' && (
        <>
          <TableCell className="p-0 border-x border-slate-100 w-24 sm:w-32">
            <PriceInputCell 
              value={item.expressPrice} 
              onSave={(val) => onUpdateProductPrice(item.id, 'expressPrice', val)} 
              className="text-blue-700" 
            />
          </TableCell>
          <TableCell className={`text-right font-mono font-bold text-xs sm:text-[15px] px-1 sm:px-4 hidden sm:table-cell ${!item.expressPrev || item.expressPrev <= 0 ? 'text-slate-300 font-sans font-normal' : 'text-slate-500'}`}>{!item.expressPrev || item.expressPrev <= 0 ? '无记录' : item.expressPrev}</TableCell>
          <TableCell className="text-right pr-2 sm:pr-6 font-mono align-middle">{renderHistoryDiff(item.expressPrice, item.expressPrev)}</TableCell>
        </>
      )}

      {activeCategory === '广货报价' && (
        <>
          <TableCell className="p-0 border-x border-slate-100 w-24 sm:w-32">
             <PriceInputCell 
               value={item.guanghuoPrice} 
               onSave={(val) => onUpdateProductPrice(item.id, 'guanghuoPrice', val)} 
               className="text-emerald-700" 
             />
          </TableCell>
          <TableCell className={`text-right font-mono font-bold text-xs sm:text-[15px] px-1 sm:px-4 hidden sm:table-cell ${!item.guanghuoPrev || item.guanghuoPrev <= 0 ? 'text-slate-300 font-sans font-normal' : 'text-slate-500'}`}>{!item.guanghuoPrev || item.guanghuoPrev <= 0 ? '无记录' : item.guanghuoPrev}</TableCell>
          <TableCell className="text-right pr-2 sm:pr-6 font-mono align-middle">{renderHistoryDiff(item.guanghuoPrice, item.guanghuoPrev)}</TableCell>
        </>
      )}

      {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
        <>
          <TableCell className="p-0 border-r border-slate-100 w-20 sm:w-28 relative">
             <PriceInputCell 
               value={item.expressPrice} 
               onSave={(val) => onUpdateProductPrice(item.id, 'expressPrice', val)} 
               className="text-blue-700" 
             />
          </TableCell>
          <TableCell className="p-0 border-r border-slate-100 w-20 sm:w-28">
             <PriceInputCell 
               value={item.guanghuoPrice} 
               onSave={(val) => onUpdateProductPrice(item.id, 'guanghuoPrice', val)} 
               className="text-emerald-700" 
             />
          </TableCell>
          <TableCell className="text-right pr-2 sm:pr-6 font-mono bg-slate-50/50 align-middle">
            {renderCompareDiff(item.compareDiff)}
          </TableCell>
        </>
      )}
    </TableRow>
  );
}


export default function PriceCompareView({
  activeCategory,
  sortedAndFilteredData,
  sortConfig,
  setSortConfig,
  onUpdateProductPrice
}: {
  activeCategory: string;
  sortedAndFilteredData: DashboardItem[];
  sortConfig: SortConfig;
  setSortConfig: Dispatch<SetStateAction<SortConfig>>;
  onUpdateProductPrice: (id: string, fieldType: 'expressPrice' | 'guanghuoPrice', newPrice: number) => Promise<void>;
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

  return (
    <div className="p-2 sm:p-0 h-full flex flex-col max-w-5xl mx-auto pb-[120px]">
      <div className="flex justify-between items-end mb-3 sm:mb-4 border-b border-slate-200/60 pb-2 sm:pb-3 px-2 sm:px-0 shrink-0">
        <div className="flex flex-col">
          <h2 className="text-xl font-black text-slate-800 tracking-tight hidden sm:block">{activeCategory}</h2>
          <span className="text-slate-500 text-xs font-bold mt-1">共 {sortedAndFilteredData.length} 条记录支持即时编辑</span>
        </div>
      </div>

      <div className="bg-white border sm:rounded-xl border-slate-200 shadow-sm flex-1 sm:overflow-hidden flex flex-col">
        <div className="w-full">
          <Table>
            <TableHeader className="bg-slate-50/80 border-b border-slate-200 sticky top-0 z-10 backdrop-blur-md">
              <TableRow className="hover:bg-transparent border-none">
                <TableHead className="font-bold text-slate-700 w-[90px] sm:w-[120px] md:w-1/4 uppercase text-[10px] sm:text-xs cursor-pointer select-none px-2 sm:px-4" onClick={() => handleSort('name')}>
                  <div className="flex items-center">品种 {renderSortIcon('name')}</div>
                </TableHead>
                
                {activeCategory === '快递报价' && (
                  <>
                    <TableHead className="text-right font-bold text-blue-700 bg-blue-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('expressPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">最新 ✍️ {renderSortIcon('expressPrice')}</div>
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
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">最新 ✍️ {renderSortIcon('guanghuoPrice')}</div>
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
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">快递价 ✍️ {renderSortIcon('expressPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-emerald-700 bg-emerald-50/50 cursor-pointer select-none px-1 sm:px-4" onClick={() => handleSort('guanghuoPrice')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">广货价 ✍️ {renderSortIcon('guanghuoPrice')}</div>
                    </TableHead>
                    <TableHead className="text-right font-bold text-slate-800 pr-2 sm:pr-6 cursor-pointer select-none bg-slate-50" onClick={() => handleSort('compareDiff')}>
                      <div className="flex items-center justify-end text-[10px] sm:text-xs">差价利润 {renderSortIcon('compareDiff')}</div>
                    </TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedAndFilteredData.map(item => (
                <PriceCompareRow 
                  key={item.id} 
                  item={item} 
                  activeCategory={activeCategory} 
                  onUpdateProductPrice={onUpdateProductPrice}
                  router={router}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {sortedAndFilteredData.length === 0 && (
        <div className="mt-4 p-8 bg-white/50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center text-center"><Search className="w-8 h-8 text-slate-300 mb-2"/><h3 className="text-slate-600 font-bold text-sm">未查找到可用数据记录</h3><p className="text-slate-400 text-xs mt-1">换个搜索词试试</p></div>
      )}
    </div>
  );
}
