'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, LayoutGrid, List, ArrowRightLeft, FileText, Box, Database, History, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

export default function DashboardClient({ initialData }: { initialData: DashboardItem[] }) {
  const router = useRouter();
  
  const navItems = [
    { id: '出货比价', icon: ArrowRightLeft },
    { id: '快递报价', icon: FileText },
    { id: '广货报价', icon: Box },
    { id: '全库明细', icon: Database },
  ];
  
  const [activeCategory, setActiveCategory] = useState<string>('出货比价');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  
  // 🚨 排序配置状态
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: null });

  // 处理排序逻辑
  const handleSort = (key: SortConfig['key']) => {
    let direction: 'asc' | 'desc' | null = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    } else if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  // 渲染排序图标
  const renderSortIcon = (key: SortConfig['key']) => {
    if (sortConfig.key !== key || !sortConfig.direction) return <div className="w-4 h-4 ml-1 opacity-20"><ChevronUp className="w-3 h-3" /></div>;
    return sortConfig.direction === 'asc' ? <ChevronUp className="w-4 h-4 ml-1 text-slate-900" /> : <ChevronDown className="w-4 h-4 ml-1 text-slate-900" />;
  };

  const formatFloat = (num: number) => Number(num.toFixed(1));

  // 综合过滤与排序的数据流
  const sortedAndFilteredData = useMemo(() => {
    // 1. 过滤
    let result = initialData.filter(item => {
      let matchesCategory = true;
      if (activeCategory === '快递报价') matchesCategory = item.expressPrice !== null;
      if (activeCategory === '广货报价') matchesCategory = item.guanghuoPrice !== null;
      if (activeCategory === '出货比价') matchesCategory = item.expressPrice !== null && item.guanghuoPrice !== null; 
      
      const matchesSearch = item.name.includes(searchTerm);
      return matchesCategory && matchesSearch;
    });

    // 2. 排序
    if (sortConfig.direction) {
      result.sort((a, b) => {
        let aVal: any = 0;
        let bVal: any = 0;

        // 特殊逻辑处理
        if (sortConfig.key === 'historyDiff') {
          const aDiff = activeCategory === '快递报价' 
            ? (a.expressPrice || 0) - (a.expressPrev || 0)
            : (a.guanghuoPrice || 0) - (a.guanghuoPrev || 0);
          const bDiff = activeCategory === '快递报价'
            ? (b.expressPrice || 0) - (b.expressPrev || 0)
            : (b.guanghuoPrice || 0) - (b.guanghuoPrev || 0);
          aVal = aDiff; bVal = bDiff;
        } else {
          aVal = a[sortConfig.key as keyof DashboardItem];
          bVal = b[sortConfig.key as keyof DashboardItem];
        }

        if (aVal === null) return 1;
        if (bVal === null) return -1;

        if (sortConfig.direction === 'asc') {
          return aVal > bVal ? 1 : -1;
        } else {
          return aVal < bVal ? 1 : -1;
        }
      });
    }
    return result;
  }, [initialData, activeCategory, searchTerm, sortConfig]);

  const renderHistoryDiff = (latest: number | null, prev: number | null) => {
    if (!latest || latest <= 0 || !prev || prev <= 0) return <span className="text-slate-400 font-medium">-</span>;
    const diff = formatFloat(latest - prev);
    if (diff > 0) return <span className="text-red-600 font-bold">涨 {diff}</span>;
    if (diff < 0) return <span className="text-emerald-600 font-bold">跌 {Math.abs(diff)}</span>;
    return <span className="text-slate-400 font-bold">平</span>;
  };

  const renderCompareDiff = (diff: number | null) => {
    if (diff === null) return <span className="text-slate-300">-</span>;
    const safeDiff = formatFloat(diff);
    if (safeDiff > 0) return (
      <div className="flex items-center gap-1.5 justify-end">
        <span className="text-blue-600 font-bold tracking-tight">多赚 {safeDiff}</span>
        <span className="text-[10px] md:text-[11px] border border-blue-200 bg-blue-50 text-blue-700 px-1 md:px-1.5 py-0.5 font-bold whitespace-nowrap">卖快递</span>
      </div>
    );
    if (safeDiff < 0) return (
      <div className="flex items-center gap-1.5 justify-end">
        <span className="text-emerald-600 font-bold tracking-tight">多赚 {Math.abs(safeDiff)}</span>
        <span className="text-[10px] md:text-[11px] border border-emerald-200 bg-emerald-50 text-emerald-700 px-1 md:px-1.5 py-0.5 font-bold whitespace-nowrap">卖广货</span>
      </div>
    );
    return <span className="text-slate-400 font-bold">无差价</span>;
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200/50">
      <aside className="hidden lg:flex flex-col w-56 bg-white/80 backdrop-blur-md border-r border-slate-200/60 h-screen sticky top-0 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)] z-10">
        <div className="pt-8 pb-6 px-5 border-b border-slate-100">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">出货看板</h1>
          <p className="text-xs text-slate-500 mt-1.5 font-medium">行情监控与利润最大化</p>
        </div>
        <nav className="p-3 space-y-1">
          {navItems.map(nav => {
            const Icon = nav.icon;
            const isActive = activeCategory === nav.id;
            return (
              <button
                key={nav.id}
                onClick={() => { setActiveCategory(nav.id); setSortConfig({ key: 'name', direction: null }); }}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 text-sm font-bold transition-all ease-out duration-200",
                  isActive ? "bg-slate-800 text-white translate-x-1 shadow-md" : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 hover:translate-x-0.5"
                )}
              >
                <Icon className="w-4 h-4 opacity-80" strokeWidth={2.5} />
                {nav.id}
              </button>
            )
          })}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 px-4 md:px-5 py-3 flex items-center justify-between shrink-0 z-20">
          <div className="lg:hidden font-black text-slate-800 tracking-tight">出货看板</div>
          <div className="flex-1 max-w-sm mx-4 hidden sm:block">
            <div className="relative group">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors ease-out" />
              <Input placeholder="搜索品种..." className="pl-9 bg-slate-100/50 border-slate-200 focus-visible:ring-0 focus-visible:border-slate-400 rounded-none shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2 sm:gap-3">
            <Link href="/history"><Button variant="outline" size="sm" className="rounded-none border-slate-300 font-bold hover:bg-slate-100 text-slate-600 px-2 sm:px-4"><History className="w-4 h-4 sm:mr-1.5" /> <span className="hidden sm:inline">历史单据</span></Button></Link>
            <Link href="/import"><Button size="sm" className="rounded-none bg-slate-800 hover:bg-slate-900 text-white font-bold shadow-none transition-all ease-out px-2 sm:px-4"><Plus className="w-4 h-4 sm:mr-1.5" /> <span className="hidden sm:inline">录入新单</span></Button></Link>
          </div>
        </header>

        <div className="sm:hidden px-4 py-3 bg-white/80 backdrop-blur-sm border-b border-slate-200/60 shrink-0">
           <div className="relative group"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 group-focus-within:text-slate-600 transition-colors ease-out" /><Input placeholder="搜索品种..." className="pl-9 bg-slate-100/50 border-slate-200 focus-visible:ring-0 focus-visible:border-slate-400 rounded-none shadow-inner h-9 text-sm" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} /></div>
        </div>

        <div className="lg:hidden bg-white/80 backdrop-blur-sm border-b border-slate-200/60 overflow-x-auto whitespace-nowrap scrollbar-hide shrink-0">
          <div className="flex px-4 py-2 gap-2">
            {navItems.map(nav => (
              <button key={nav.id} onClick={() => { setActiveCategory(nav.id); setSortConfig({ key: 'name', direction: null }); }} className={cn("px-4 py-1.5 text-xs font-bold border transition-colors ease-out", activeCategory === nav.id ? "bg-slate-800 text-white border-slate-800" : "bg-white text-slate-600 border-slate-200")}>{nav.id}</button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4 lg:p-6">
          <div className="flex justify-between items-end mb-4 border-b border-slate-200/60 pb-3">
            <div className="flex flex-col">
              <h2 className="text-xl font-black text-slate-800 tracking-tight hidden sm:block">{activeCategory}</h2>
              <span className="text-slate-500 text-xs font-bold mt-1">共 {sortedAndFilteredData.length} 条有效记录</span>
            </div>
            <div className="flex bg-slate-200/50 p-0.5 border border-slate-200/50">
              <button onClick={() => setViewMode('grid')} className={cn("p-1.5 transition-colors ease-out", viewMode === 'grid' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600')}><LayoutGrid className="w-4 h-4"/></button>
              <button onClick={() => setViewMode('list')} className={cn("p-1.5 transition-colors ease-out", viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600')}><List className="w-4 h-4"/></button>
            </div>
          </div>

          {viewMode === 'list' && (
            <div className="bg-white border border-slate-200 shadow-sm overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-100/80 border-b border-slate-200">
                  <TableRow className="hover:bg-transparent">
                    {/* 点击表头排序 */}
                    <TableHead className="font-bold text-slate-700 w-[100px] md:w-1/4 uppercase text-xs cursor-pointer select-none" onClick={() => handleSort('name')}>
                      <div className="flex items-center">品种名称 {renderSortIcon('name')}</div>
                    </TableHead>
                    
                    {activeCategory === '快递报价' && (
                      <>
                        <TableHead className="text-right font-bold text-blue-700 bg-blue-50/50 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('expressPrice')}>
                          <div className="flex items-center justify-end">最新 {renderSortIcon('expressPrice')}</div>
                        </TableHead>
                        <TableHead className="text-right font-bold text-slate-500 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('expressPrev')}>
                          <div className="flex items-center justify-end">昨日 {renderSortIcon('expressPrev')}</div>
                        </TableHead>
                        <TableHead className="text-right font-bold text-slate-700 pr-4 md:pr-6 cursor-pointer select-none" onClick={() => handleSort('historyDiff')}>
                          <div className="flex items-center justify-end">变动 {renderSortIcon('historyDiff')}</div>
                        </TableHead>
                      </>
                    )}
                    {activeCategory === '广货报价' && (
                      <>
                        <TableHead className="text-right font-bold text-emerald-700 bg-emerald-50/50 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('guanghuoPrice')}>
                          <div className="flex items-center justify-end">最新 {renderSortIcon('guanghuoPrice')}</div>
                        </TableHead>
                        <TableHead className="text-right font-bold text-slate-500 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('guanghuoPrev')}>
                          <div className="flex items-center justify-end">昨日 {renderSortIcon('guanghuoPrev')}</div>
                        </TableHead>
                        <TableHead className="text-right font-bold text-slate-700 pr-4 md:pr-6 cursor-pointer select-none" onClick={() => handleSort('historyDiff')}>
                          <div className="flex items-center justify-end">变动 {renderSortIcon('historyDiff')}</div>
                        </TableHead>
                      </>
                    )}
                    {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
                      <>
                        <TableHead className="text-right font-bold text-blue-700 bg-blue-50/50 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('expressPrice')}>
                          <div className="flex items-center justify-end">快递 {renderSortIcon('expressPrice')}</div>
                        </TableHead>
                        <TableHead className="text-right font-bold text-emerald-700 bg-emerald-50/50 cursor-pointer select-none px-2 md:px-4" onClick={() => handleSort('guanghuoPrice')}>
                          <div className="flex items-center justify-end">广货 {renderSortIcon('guanghuoPrice')}</div>
                        </TableHead>
                        {/* 🚨 核心逻辑：快递-广货结果排序 */}
                        <TableHead className="text-right font-bold text-slate-800 pr-4 md:pr-6 w-[130px] md:w-[220px] cursor-pointer select-none" onClick={() => handleSort('compareDiff')}>
                          <div className="flex items-center justify-end">出货建议 {renderSortIcon('compareDiff')}</div>
                        </TableHead>
                      </>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedAndFilteredData.map(item => (
                    <TableRow key={item.id} className="cursor-pointer hover:bg-slate-50 group border-b border-slate-100 transition-colors ease-out" onClick={() => router.push(`/product/${item.id}`)}>
                      <TableCell className="font-black text-slate-800 text-sm md:text-base group-hover:text-blue-600 transition-colors ease-out px-3 md:px-4 py-3 truncate max-w-[120px] md:max-w-none">{item.name}</TableCell>
                      {activeCategory === '快递报价' && (
                        <>
                          <TableCell className={`text-right font-mono font-black text-base md:text-lg px-2 md:px-4 ${!item.expressPrice || item.expressPrice <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!item.expressPrice || item.expressPrice <= 0 ? <span className="text-xs md:text-sm font-normal">暂无</span> : item.expressPrice}</TableCell>
                          <TableCell className={`text-right font-mono font-bold text-sm md:text-base px-2 md:px-4 ${!item.expressPrev || item.expressPrev <= 0 ? 'text-slate-300' : 'text-slate-500'}`}>{!item.expressPrev || item.expressPrev <= 0 ? <span className="text-xs md:text-sm font-normal">暂无</span> : item.expressPrev}</TableCell>
                          <TableCell className="text-right pr-4 md:pr-6 font-mono text-sm md:text-base">{renderHistoryDiff(item.expressPrice, item.expressPrev)}</TableCell>
                        </>
                      )}
                      {activeCategory === '广货报价' && (
                        <>
                          <TableCell className={`text-right font-mono font-black text-base md:text-lg px-2 md:px-4 ${!item.guanghuoPrice || item.guanghuoPrice <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!item.guanghuoPrice || item.guanghuoPrice <= 0 ? <span className="text-xs md:text-sm font-normal">暂无</span> : item.guanghuoPrice}</TableCell>
                          <TableCell className={`text-right font-mono font-bold text-sm md:text-base px-2 md:px-4 ${!item.guanghuoPrev || item.guanghuoPrev <= 0 ? 'text-slate-300' : 'text-slate-500'}`}>{!item.guanghuoPrev || item.guanghuoPrev <= 0 ? <span className="text-xs md:text-sm font-normal">暂无</span> : item.guanghuoPrev}</TableCell>
                          <TableCell className="text-right pr-4 md:pr-6 font-mono text-sm md:text-base">{renderHistoryDiff(item.guanghuoPrice, item.guanghuoPrev)}</TableCell>
                        </>
                      )}
                      {(activeCategory === '出货比价' || activeCategory === '全库明细') && (
                        <>
                          <TableCell className={`text-right font-mono font-black text-base md:text-lg px-2 md:px-4 ${!item.expressPrice || item.expressPrice <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!item.expressPrice || item.expressPrice <= 0 ? <span className="text-xs md:text-sm font-normal">缺数</span> : item.expressPrice}</TableCell>
                          <TableCell className={`text-right font-mono font-black text-base md:text-lg px-2 md:px-4 ${!item.guanghuoPrice || item.guanghuoPrice <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!item.guanghuoPrice || item.guanghuoPrice <= 0 ? <span className="text-xs md:text-sm font-normal">缺数</span> : item.guanghuoPrice}</TableCell>
                          <TableCell className="text-right pr-4 md:pr-6 font-mono text-sm md:text-base">{renderCompareDiff(item.compareDiff)}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sortedAndFilteredData.map(item => {
                let valLatest, valPrev, diffDisplay;
                let titleLeft = '最新', titleRight = '昨日', titleDiff = '变动';
                if (activeCategory === '快递报价') { valLatest = item.expressPrice; valPrev = item.expressPrev; diffDisplay = renderHistoryDiff(valLatest, valPrev); }
                else if (activeCategory === '广货报价') { valLatest = item.guanghuoPrice; valPrev = item.guanghuoPrev; diffDisplay = renderHistoryDiff(valLatest, valPrev); }
                else { titleLeft = '快递'; titleRight = '广货'; titleDiff = '差价'; valLatest = item.expressPrice; valPrev = item.guanghuoPrice; diffDisplay = renderCompareDiff(item.compareDiff); }

                return (
                  <Link href={`/product/${item.id}`} key={item.id} className="block h-full outline-none">
                    <Card className="rounded-none border-slate-200 bg-white hover:-translate-y-1 hover:shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] transition-all duration-200 ease-out h-full group">
                      <CardContent className="p-0 flex flex-col h-full">
                        <div className="px-5 pt-5 pb-3 bg-slate-50/50 border-b border-slate-100"><h3 className="font-black text-slate-800 text-lg group-hover:text-blue-600 transition-colors ease-out truncate">{item.name}</h3></div>
                        <div className="grid grid-cols-3 p-4 gap-2 text-left">
                          <div className="flex flex-col"><span className="text-[10px] font-bold text-slate-400 mb-1">{titleLeft}</span><span className={`text-base font-mono font-black ${!valLatest || valLatest <= 0 ? 'text-slate-300' : 'text-slate-800'}`}>{!valLatest || valLatest <= 0 ? '//' : valLatest}</span></div>
                          <div className="flex flex-col border-l border-slate-100 pl-3"><span className="text-[10px] font-bold text-slate-400 mb-1">{titleRight}</span><span className={`text-base font-mono font-bold ${!valPrev || valPrev <= 0 ? 'text-slate-300' : 'text-slate-500'}`}>{!valPrev || valPrev <= 0 ? '//' : valPrev}</span></div>
                          <div className="flex flex-col border-l border-slate-100 pl-3"><span className="text-[10px] font-bold text-slate-400 mb-1">{titleDiff}</span><span className="text-sm font-mono mt-0.5">{diffDisplay}</span></div>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}

          {sortedAndFilteredData.length === 0 && (
            <div className="mt-8 p-6 bg-white border border-slate-200"><h3 className="text-slate-800 font-black text-lg mb-1">未找到匹配品种</h3><p className="text-slate-500 text-sm font-medium">请更换搜索词或切换查看维度。</p></div>
          )}
        </div>
      </main>
    </div>
  );
}