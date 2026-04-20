'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardItem } from '@/actions/get-dashboard-data';
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

  useEffect(() => {
    setVal(value !== null && value > 0 ? String(value) : '');
  }, [value]);

  const handleBlur = () => {
    const num = parseFloat(val);
    if (!isNaN(num) && num > 0 && num !== value) {
      onSave(num);
    } else if (val === '' && value !== null && value !== 0) {
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
        "w-full h-11 px-1 sm:px-2 bg-transparent outline-none text-center font-mono font-black transition-all",
        val === '' ? 'text-slate-300 font-sans font-normal text-[12px]' : 'text-slate-800 text-[14px] sm:text-[16px]',
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
  index,
  activeCategory,
  onUpdateProductPrice,
  router
}: {
  item: DashboardItem,
  index: number,
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
      <div className="flex flex-col items-center justify-center">
        <span className="text-blue-600 font-bold tracking-tight text-[14px] sm:text-[16px] leading-none">+{safeDiff}</span>
        <span className="text-[9px] sm:text-[10px] text-blue-500 mt-0.5 whitespace-nowrap leading-none">(卖快递)</span>
      </div>
    );
    if (safeDiff < 0) return (
      <div className="flex flex-col items-center justify-center">
        <span className="text-emerald-600 font-bold tracking-tight text-[14px] sm:text-[16px] leading-none">+{Math.abs(safeDiff)}</span>
        <span className="text-[9px] sm:text-[10px] text-emerald-500 mt-0.5 whitespace-nowrap leading-none">(卖广货)</span>
      </div>
    );
    return <span className="text-slate-400 font-bold text-xs sm:text-base">0</span>;
  };

  return (
    <tr className={cn("hover:bg-blue-50/50 group border-b border-blue-50/50 transition-colors", index % 2 !== 0 && "bg-slate-50/40")}>
      <td className="text-center font-bold text-slate-400 w-10 sm:w-12 border-r border-blue-50/50 p-0 text-xs">
        {index + 1}
      </td>
      <td className="p-0 border-r border-blue-50/50 relative px-2 sm:px-3 text-[13px] sm:text-[14px] text-slate-800 font-bold max-w-[120px] truncate">
        <span className="cursor-pointer hover:text-blue-600 transition-colors" onClick={() => router.push(`/product/${item.id}`)}>{item.name}</span>
      </td>

      {activeCategory === '快递报价' && (
        <>
          <td className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center bg-blue-50/20">
            <PriceInputCell
              value={item.expressPrice}
              onSave={(val) => onUpdateProductPrice(item.id, 'expressPrice', val)}
              className="text-blue-700"
            />
          </td>
          <td className={`p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center font-mono font-bold text-[13px] sm:text-[15px] hidden sm:table-cell ${!item.expressPrev || item.expressPrev <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-500'}`}>
            <div className="w-full h-11 flex items-center justify-center">{!item.expressPrev || item.expressPrev <= 0 ? '无记录' : item.expressPrev}</div>
          </td>
          <td className="p-0 text-center font-mono align-middle">
            <div className="w-full h-11 flex items-center justify-center">{renderHistoryDiff(item.expressPrice, item.expressPrev)}</div>
          </td>
        </>
      )}

      {activeCategory === '广货报价' && (
        <>
          <td className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center bg-emerald-50/20">
            <PriceInputCell
              value={item.guanghuoPrice}
              onSave={(val) => onUpdateProductPrice(item.id, 'guanghuoPrice', val)}
              className="text-emerald-700"
            />
          </td>
          <td className={`p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center font-mono font-bold text-[13px] sm:text-[15px] hidden sm:table-cell ${!item.guanghuoPrev || item.guanghuoPrev <= 0 ? 'text-slate-300 font-sans font-normal text-xs' : 'text-slate-500'}`}>
            <div className="w-full h-11 flex items-center justify-center">{!item.guanghuoPrev || item.guanghuoPrev <= 0 ? '无记录' : item.guanghuoPrev}</div>
          </td>
          <td className="p-0 text-center font-mono align-middle">
            <div className="w-full h-11 flex items-center justify-center">{renderHistoryDiff(item.guanghuoPrice, item.guanghuoPrev)}</div>
          </td>
        </>
      )}

      {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
        <>
          <td className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center bg-blue-50/20">
            <PriceInputCell
              value={item.expressPrice}
              onSave={(val) => onUpdateProductPrice(item.id, 'expressPrice', val)}
              className="text-blue-700"
            />
          </td>
          <td className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center bg-emerald-50/20">
            <PriceInputCell
              value={item.guanghuoPrice}
              onSave={(val) => onUpdateProductPrice(item.id, 'guanghuoPrice', val)}
              className="text-emerald-700"
            />
          </td>
          <td className="p-0 text-center font-mono bg-slate-50/80 align-middle">
            <div className="w-full h-11 flex items-center justify-center">{renderCompareDiff(item.compareDiff)}</div>
          </td>
        </>
      )}
    </tr>
  );
}

// ==========================================
// 主视图组件
// ==========================================
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
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3 md:w-4 md:h-4 ml-0.5 md:ml-1 text-white" /> : <ChevronDown className="w-3 h-3 md:w-4 md:h-4 ml-0.5 md:ml-1 text-white" />;
  };

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col pb-[120px]">
      {/* 统一样式的黑底白字 Header */}
      <div className="bg-slate-800 text-white p-4 sm:rounded-t-xl shrink-0">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">{activeCategory} / 记录数</p>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-mono text-white font-black tracking-tight">{sortedAndFilteredData.length}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border-l border-r border-b border-slate-200 sm:rounded-b-xl shadow-sm flex-1 flex flex-col -mt-[1px]">
        <div className="w-full">
          <table className="w-full text-left border-collapse min-w-[320px]">
            <thead className="sticky top-[52px] lg:top-[60px] z-40 shadow-sm">
              <tr className="bg-[#4a8ebf] text-white select-none">
                <th className="w-10 sm:w-12 py-2.5 px-0 text-center text-xs border-r border-[#3c78a3] font-black">⊕</th>
                <th className="py-2.5 px-2 sm:px-3 text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer" onClick={() => handleSort('name')}>
                  <div className="flex items-center">品种 {renderSortIcon('name')}</div>
                </th>

                {activeCategory === '快递报价' && (
                  <>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer" onClick={() => handleSort('expressPrice')}>
                      <div className="flex items-center justify-center">最新 {renderSortIcon('expressPrice')}</div>
                    </th>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer hidden sm:table-cell" onClick={() => handleSort('expressPrev')}>
                      昨日
                    </th>
                    <th className="py-2.5 px-1 text-center text-xs sm:text-sm font-bold cursor-pointer" onClick={() => handleSort('historyDiff')}>
                      <div className="flex items-center justify-center">变动 {renderSortIcon('historyDiff')}</div>
                    </th>
                  </>
                )}
                {activeCategory === '广货报价' && (
                  <>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer" onClick={() => handleSort('guanghuoPrice')}>
                      <div className="flex items-center justify-center">最新 {renderSortIcon('guanghuoPrice')}</div>
                    </th>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer hidden sm:table-cell" onClick={() => handleSort('guanghuoPrev')}>
                      昨日
                    </th>
                    <th className="py-2.5 px-1 text-center text-xs sm:text-sm font-bold cursor-pointer" onClick={() => handleSort('historyDiff')}>
                      <div className="flex items-center justify-center">变动 {renderSortIcon('historyDiff')}</div>
                    </th>
                  </>
                )}
                {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
                  <>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer" onClick={() => handleSort('expressPrice')}>
                      <div className="flex items-center justify-center">快递价 {renderSortIcon('expressPrice')}</div>
                    </th>
                    <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3] cursor-pointer" onClick={() => handleSort('guanghuoPrice')}>
                      <div className="flex items-center justify-center">广货价 {renderSortIcon('guanghuoPrice')}</div>
                    </th>
                    <th className="py-2.5 px-1 text-center text-xs sm:text-sm font-bold cursor-pointer" onClick={() => handleSort('compareDiff')}>
                      <div className="flex items-center justify-center">差价利润 {renderSortIcon('compareDiff')}</div>
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedAndFilteredData.map((item, i) => (
                <PriceCompareRow
                  key={item.id}
                  item={item}
                  index={i}
                  activeCategory={activeCategory}
                  onUpdateProductPrice={onUpdateProductPrice}
                  router={router}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sortedAndFilteredData.length === 0 && (
        <div className="mt-4 p-8 bg-white/50 border border-slate-200 border-dashed rounded-xl flex flex-col items-center justify-center text-center"><Search className="w-8 h-8 text-slate-300 mb-2" /><h3 className="text-slate-600 font-bold text-sm">未查找到可用数据记录</h3><p className="text-slate-400 text-xs mt-1">换个搜索词试试</p></div>
      )}
    </div>
  );
}
