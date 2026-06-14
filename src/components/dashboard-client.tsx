'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { createInventoryItem, updateInventoryItem, deleteInventoryItem } from '@/actions/inventory';
import { updateProductPrice } from '@/actions/price';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Search, ArrowRightLeft, FileText, Box, Activity, History, Archive, Menu, Link as LinkIcon, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import InventoryView from './dashboard/inventory-view';
import PriceCompareView from './dashboard/price-compare-view';
import MarketTrendView from './dashboard/market-trend-view'; // 🚨 引入新组件

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

export default function DashboardClient({ initialData, initialInventoryData }: { initialData: DashboardItem[], initialInventoryData: any[] }) {
  // 🚨 修改：将“全库明细”替换为“大盘行情”，图标改为波浪线 Activity
  const navItems = [
    { id: '出货比价', icon: ArrowRightLeft },
    { id: '当前库存', icon: Archive },
    { id: '快递报价', icon: FileText },
    { id: '广货报价', icon: Box },
    { id: '大盘行情', icon: Activity },
  ];

  const [activeCategory, setActiveCategory] = useState<string>('出货比价');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState<SortConfig>({ key: 'compareDiff', direction: 'desc' });
  const [menuOpen, setMenuOpen] = useState(false);

  const [productsList, setProductsList] = useState(initialData);
  const [inventory, setInventory] = useState(initialInventoryData);
  const [isAppEnv, setIsAppEnv] = useState(false);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && navigator.userAgent.includes('PriceOcrApp')) {
      setIsAppEnv(true);
    }
  }, []);
  const getDiffValue = (item: DashboardItem, category: string, sortKey: string) => {
    if (sortKey === 'compareDiff') return item.compareDiff || 0;

    if (sortKey === 'historyDiff') {
      if (category === '快递报价') {
        if (!item.expressPrice || item.expressPrice <= 0 || !item.expressPrev || item.expressPrev <= 0) return 0;
        return item.expressPrice - item.expressPrev;
      }
      if (category === '广货报价') {
        if (!item.guanghuoPrice || item.guanghuoPrice <= 0 || !item.guanghuoPrev || item.guanghuoPrev <= 0) return 0;
        return item.guanghuoPrice - item.guanghuoPrev;
      }
    }
    return 0;
  };

  const sortedAndFilteredData = useMemo(() => {
    // 🚨 大盘行情不需要在这里参与排序过滤，它吃全量数据
    if (activeCategory === '当前库存' || activeCategory === '大盘行情') return [];

    let result = productsList.filter(item => {
      let matchesCategory = true;
      if (activeCategory === '快递报价') matchesCategory = item.expressPrice !== null;
      if (activeCategory === '广货报价') matchesCategory = item.guanghuoPrice !== null;
      if (activeCategory === '出货比价') {
        // 出货比价：必须双边都有真实报价（不为 null 且 > 1，避免 OCR 占位价 0/1 把利润撑爆）
        // 同时排除用户在"名称同步映射"中明确标记为"无需对比"的产品。
        const expOk = item.expressPrice !== null && item.expressPrice > 1;
        const ghOk = item.guanghuoPrice !== null && item.guanghuoPrice > 1;
        matchesCategory = expOk && ghOk && !item.excludedFromCompare;
      }
      return matchesCategory && item.name.includes(searchTerm);
    });

    if (sortConfig.direction) {
      result.sort((a, b) => {
        if (sortConfig.key === 'historyDiff' || sortConfig.key === 'compareDiff') {
          const diffA = getDiffValue(a, activeCategory, sortConfig.key);
          const diffB = getDiffValue(b, activeCategory, sortConfig.key);

          const groupA = diffA > 0 ? 1 : diffA < 0 ? -1 : 0;
          const groupB = diffB > 0 ? 1 : diffB < 0 ? -1 : 0;

          if (groupA !== groupB) {
            if (groupA === 0) return 1;
            if (groupB === 0) return -1;

            if (sortConfig.direction === 'desc') {
              return groupA === 1 ? -1 : 1;
            } else {
              return groupA === -1 ? -1 : 1;
            }
          }

          return Math.abs(diffB) - Math.abs(diffA);
        }

        const aVal = a[sortConfig.key as keyof DashboardItem];
        const bVal = b[sortConfig.key as keyof DashboardItem];

        if (aVal === null || aVal === undefined) return 1;
        if (bVal === null || bVal === undefined) return -1;
        return sortConfig.direction === 'asc' ? (aVal > bVal ? 1 : -1) : (aVal < bVal ? 1 : -1);
      });
    }
    return result;
  }, [productsList, activeCategory, searchTerm, sortConfig]);

  const onUpdateProductPrice = async (id: string, fieldType: 'expressPrice' | 'guanghuoPrice', newPrice: number) => {
    setProductsList(prev => prev.map(p => {
      if (p.id === id) {
        const updated = { ...p, [fieldType]: newPrice };
        if (updated.expressPrice !== null && updated.guanghuoPrice !== null) {
          updated.compareDiff = updated.expressPrice - updated.guanghuoPrice;
        }
        return updated;
      }
      return p;
    }));
    await updateProductPrice(id, fieldType === 'expressPrice' ? 'EXPRESS' : 'GUANGHUO', newPrice);
  };

  const onUpdateInventoryRow = async (id: string, data: any) => {
    setInventory(inventory.map((i: any) => i.id === id ? { ...i, ...data } : i));
    await updateInventoryItem(id, data);
  };

  const onDeleteInventoryRow = async (id: string) => {
    if (!confirm('确定移除此记录？')) return;
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
                onClick={() => { setActiveCategory(nav.id); setSortConfig({ key: (nav.id === '出货比价' || nav.id === '大盘行情') ? 'compareDiff' : 'historyDiff', direction: 'desc' }); }}
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

      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 z-[99] flex justify-around items-center h-[60px] pb-safe shadow-[0_-4px_24px_-12px_rgba(0,0,0,0.1)]">
        {navItems.map(nav => {
          const Icon = nav.icon;
          const isActive = activeCategory === nav.id;
          return (
            <button
              key={nav.id}
              onClick={() => {
                setActiveCategory(nav.id);
                setSortConfig({
                  key: (nav.id === '出货比价' || nav.id === '大盘行情') ? 'compareDiff' : 'historyDiff',
                  direction: 'desc'
                });
              }}
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

      <main className="flex-1 flex flex-col min-h-[100dvh]">
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

              <Button variant="ghost" size="icon" className="h-8 w-8 lg:hidden rounded-full font-bold bg-slate-100/80 hover:bg-slate-200 focus:bg-slate-200 transition-colors" onClick={() => setMenuOpen(!menuOpen)}>
                <Menu className="w-4 h-4 text-slate-700" />
              </Button>

              <div className="hidden lg:flex gap-2">
                {/* 🚨 新增：PC端专属下载按钮 (带 download 属性自动触发下载) */}
                <a href="/app-release.apk" download>
                  <Button variant="outline" size="sm" className="font-bold border-blue-200 text-blue-600 hover:bg-blue-50">
                    <Download className="w-4 h-4 mr-1.5" />下载 APP
                  </Button>
                </a>
                <Link href="/mapping"><Button variant="outline" size="sm" className="font-bold border-slate-200"><ArrowRightLeft className="w-4 h-4 mr-1.5" />名称同步</Button></Link>
                <Link href="/history"><Button variant="outline" size="sm" className="font-bold border-slate-200"><History className="w-4 h-4 mr-1.5" />历史单据</Button></Link>
                <Link href="/import"><Button size="sm" className="bg-slate-800 text-white font-bold hover:bg-slate-900"><Plus className="w-4 h-4 mr-1.5" />录入OCR</Button></Link>
              </div>
            </div>
          </div>
        </header>

        {menuOpen && (
          <>
            <div
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[90] lg:hidden animate-in fade-in duration-200"
              onClick={() => setMenuOpen(false)}
            />
            <div className="fixed right-4 top-[60px] bg-white/95 backdrop-blur-xl border border-slate-200/80 shadow-[0_8px_30px_rgb(0,0,0,0.12)] rounded-2xl p-2 z-[100] w-52 flex flex-col gap-1 origin-top-right animate-in fade-in zoom-in-95 duration-200 lg:hidden text-sm">


              <div className="h-[1px] bg-slate-100 my-1"></div>
              {!isAppEnv && (
                <>
                  <a href="/app-release.apk" download onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-3 py-3 text-blue-700 bg-blue-50 font-bold hover:bg-blue-100 rounded-xl transition-colors">
                    <Download className="w-4 h-4 text-blue-500" /> 下载安卓 APP
                  </a>
                  <div className="h-[1px] bg-slate-100 my-1"></div>
                </>
              )}
              <Link href="/mapping" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-3 py-3 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition-colors"><LinkIcon className="w-4 h-4 text-slate-400" /> 名称同步映射</Link>
              <Link href="/history" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-3 py-3 text-slate-700 font-bold hover:bg-slate-100 rounded-xl transition-colors"><History className="w-4 h-4 text-slate-400" /> 报表历史查询</Link>
              <div className="h-[1px] bg-slate-100 my-1"></div>
              <Link href="/import" onClick={() => setMenuOpen(false)} className="flex items-center gap-3 px-3 py-3 text-blue-600 bg-blue-50/80 font-bold hover:bg-blue-100 rounded-xl transition-colors"><Plus className="w-4 h-4" /> 录入最新图片</Link>
            </div>
          </>
        )}

        <div className="flex-1 p-0 sm:p-4 lg:p-6 bg-slate-50/50 pb-8">
          {/* 🚨 核心路由分发 */}
          {activeCategory === '当前库存' ? (
            <InventoryView
              inventory={inventory.filter(item => item.name.includes(searchTerm))}
              products={initialData}
              onUpdateInventoryRow={onUpdateInventoryRow}
              onDeleteInventoryRow={onDeleteInventoryRow}
              onAddNewInventoryRow={onAddNewInventoryRow}
            />
          ) : activeCategory === '大盘行情' ? (
            <MarketTrendView data={productsList} />
          ) : (
            <PriceCompareView
              activeCategory={activeCategory}
              sortedAndFilteredData={sortedAndFilteredData}
              sortConfig={sortConfig}
              setSortConfig={setSortConfig}
              onUpdateProductPrice={onUpdateProductPrice}
            />
          )}
        </div>
      </main>
    </div>
  );
}