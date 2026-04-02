'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { createInventoryItem, updateInventoryItem, deleteInventoryItem } from '@/actions/inventory';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, ArrowRightLeft, FileText, Box, Database, History, Archive, MoreHorizontal, Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import InventoryView from './dashboard/inventory-view';
import PriceCompareView from './dashboard/price-compare-view';

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

export default function DashboardClient({ initialData, initialInventoryData }: { initialData: DashboardItem[], initialInventoryData: any[] }) {
  const navItems = [
    { id: '出货比价', icon: ArrowRightLeft },
    { id: '当前库存', icon: Archive },
    { id: '快递报价', icon: FileText },
    { id: '广货报价', icon: Box },
    { id: '全库明细', icon: Database },
  ];
  
  const [activeCategory, setActiveCategory] = useState<string>('出货比价');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'name', direction: null });
  const [menuOpen, setMenuOpen] = useState(false);

  const [inventory, setInventory] = useState(initialInventoryData);

  const sortedAndFilteredData = useMemo(() => {
    if (activeCategory === '当前库存') return [];
    
    let result = initialData.filter(item => {
      let matchesCategory = true;
      if (activeCategory === '快递报价') matchesCategory = item.expressPrice !== null;
      if (activeCategory === '广货报价') matchesCategory = item.guanghuoPrice !== null;
      if (activeCategory === '出货比价') matchesCategory = item.expressPrice !== null && item.guanghuoPrice !== null; 
      return matchesCategory && item.name.includes(searchTerm);
    });

    if (sortConfig.direction) {
      result.sort((a, b) => {
        let aVal: any = 0, bVal: any = 0;
        if (sortConfig.key === 'historyDiff') {
          aVal = activeCategory === '快递报价' ? (a.expressPrice || 0) - (a.expressPrev || 0) : (a.guanghuoPrice || 0) - (a.guanghuoPrev || 0);
          bVal = activeCategory === '快递报价' ? (b.expressPrice || 0) - (b.expressPrev || 0) : (b.guanghuoPrice || 0) - (b.guanghuoPrev || 0);
        } else {
          aVal = a[sortConfig.key as keyof DashboardItem];
          bVal = b[sortConfig.key as keyof DashboardItem];
        }
        if (aVal === null) return 1;
        if (bVal === null) return -1;
        return sortConfig.direction === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
      });
    }
    return result;
  }, [initialData, activeCategory, searchTerm, sortConfig]);

  const onUpdateInventoryRow = async (id: string, data: any) => {
    setInventory(inventory.map((i: any) => i.id === id ? { ...i, ...data } : i));
    await updateInventoryItem(id, data);
  };

  const onDeleteInventoryRow = async (id: string) => {
    if(!confirm('确定移除此记录？')) return;
    setInventory(inventory.filter((i: any) => i.id !== id));
    await deleteInventoryItem(id);
  };

  const onAddNewInventoryRow = async (name: string, price: number, quantity: number) => {
    const res = await createInventoryItem(name, price, quantity);
    if (res.success && res.data) {
      setInventory([...inventory, res.data]);
    } else {
      alert("创建行失败: " + res.error);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50/50 pb-16 lg:pb-0">
      {/* 侧边栏 */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-slate-200/60 h-screen sticky top-0 shadow-[4px_0_24px_-12px_rgba(0,0,0,0.05)] z-10">
        <div className="pt-8 pb-6 px-5 border-b border-slate-100">
          <h1 className="text-xl font-black text-slate-800 tracking-tight">出货看板</h1>
          <p className="text-xs text-slate-500 mt-1.5 font-medium">行情与库存管理</p>
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
                  isActive ? "bg-slate-800 text-white translate-x-1 shadow-md rounded-md" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded-md"
                )}
              >
                <Icon className="w-4 h-4 opacity-80" strokeWidth={2.5} />
                {nav.id}
              </button>
            )
          })}
        </nav>
      </aside>

      {/* 底部导航 */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-[99] flex justify-around items-center h-[60px] pb-safe shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.1)]">
        {navItems.map(nav => {
          const Icon = nav.icon;
          const isActive = activeCategory === nav.id;
          return (
            <button
              key={nav.id}
              onClick={() => { setActiveCategory(nav.id); setSortConfig({ key: 'name', direction: null }); }}
              className="flex flex-col items-center justify-center flex-1 h-full pt-1"
            >
              <div className={cn("p-1 rounded-full transition-colors", isActive ? "text-blue-600" : "text-slate-400")}>
                <Icon className="w-[22px] h-[22px]" strokeWidth={isActive ? 2.5 : 2} />
              </div>
              <span className={cn("text-[10px] sm:text-xs mt-0.5", isActive ? "font-black text-blue-600" : "font-medium text-slate-500")}>
                {nav.id}
              </span>
            </button>
          );
        })}
      </nav>

      {/* 主体区 */}
      <main className="flex-1 flex flex-col min-h-[100dvh]">
        {/* 顶栏 */}
        <header className="bg-white/90 backdrop-blur-md border-b border-slate-200/60 transition-all sticky top-0 z-50">
          <div className="flex items-center justify-between px-4 py-3">
            <h1 className="lg:hidden font-black text-slate-800 tracking-tight text-lg">{activeCategory}</h1>
            <div className="hidden lg:block lg:flex-1 w-full max-w-sm mr-4">
              <div className="relative group">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                <Input placeholder="搜索名称..." className="pl-9 h-9 bg-slate-100/50 rounded-md border-none focus-visible:ring-1 focus-visible:ring-slate-300 shadow-inner" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              </div>
            </div>
            
            <div className="flex items-center gap-2 relative">
               <div className="lg:hidden relative group w-32 sm:w-48">
                 <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                 <Input className="pl-8 h-8 text-xs bg-slate-100/80 border-none rounded-full" placeholder="简搜..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
               </div>
               
               <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden rounded-full font-bold bg-slate-100/80 hover:bg-slate-200" onClick={() => setMenuOpen(!menuOpen)}>
                 <MoreHorizontal className="w-5 h-5 text-slate-700" />
               </Button>
               
               <div className="hidden lg:flex gap-2">
                 <Link href="/mapping"><Button variant="outline" size="sm" className="font-bold border-slate-200"><ArrowRightLeft className="w-4 h-4 mr-1.5" />名称同步</Button></Link>
                 <Link href="/history"><Button variant="outline" size="sm" className="font-bold border-slate-200"><History className="w-4 h-4 mr-1.5" />历史单据</Button></Link>
                 <Link href="/import"><Button size="sm" className="bg-slate-800 text-white font-bold hover:bg-slate-900"><Plus className="w-4 h-4 mr-1.5" />录入OCR</Button></Link>
               </div>
            </div>
          </div>

          {menuOpen && (
            <div className="absolute right-4 top-14 bg-white border border-slate-200 shadow-xl rounded-xl p-2 z-[100] w-48 flex flex-col gap-1 origin-top-right animate-in fade-in zoom-in-95 duration-200 lg:hidden text-sm">
              <Link href="/mapping" className="flex items-center gap-3 px-3 py-2.5 text-slate-700 font-bold hover:bg-slate-100 rounded-lg"><LinkIcon className="w-4 h-4 text-slate-400" /> 名称同步映射</Link>
              <Link href="/history" className="flex items-center gap-3 px-3 py-2.5 text-slate-700 font-bold hover:bg-slate-100 rounded-lg"><History className="w-4 h-4 text-slate-400" /> 报表历史查询</Link>
              <div className="h-[1px] bg-slate-100 my-1"></div>
              <Link href="/import" className="flex items-center gap-3 px-3 py-2.5 text-blue-600 bg-blue-50/50 font-bold hover:bg-blue-100 rounded-lg"><Plus className="w-4 h-4" /> 录入最新图片</Link>
            </div>
          )}
        </header>

        <div className="flex-1 overflow-auto p-0 sm:p-4 lg:p-6 bg-slate-50/50 scroll-smooth pb-8">
          {activeCategory === '当前库存' ? (
            <InventoryView
              inventory={inventory}
              products={initialData}
              onUpdateInventoryRow={onUpdateInventoryRow}
              onDeleteInventoryRow={onDeleteInventoryRow}
              onAddNewInventoryRow={onAddNewInventoryRow}
            />
          ) : (
            <PriceCompareView
              activeCategory={activeCategory}
              sortedAndFilteredData={sortedAndFilteredData}
              viewMode={viewMode}
              setViewMode={setViewMode}
              sortConfig={sortConfig}
              setSortConfig={setSortConfig}
            />
          )}
        </div>
      </main>
    </div>
  );
}