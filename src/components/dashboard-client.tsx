'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { createInventoryItem, updateInventoryItem, deleteInventoryItem } from '@/actions/inventory';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, LayoutGrid, List, ArrowRightLeft, FileText, Box, Database, History, ChevronUp, ChevronDown, Archive, MoreHorizontal, Link as LinkIcon, Trash2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type SortConfig = {
  key: keyof DashboardItem | 'historyDiff';
  direction: 'asc' | 'desc' | null;
};

// ==========================================
// 提取可复用的库存行组件 (单行内联编辑)
// ==========================================
function InventoryRow({
  item,
  index,
  products,
  onUpdate,
  onDelete
}: {
  item: any;
  index: number;
  products: DashboardItem[];
  onUpdate: (id: string, data: any) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price === 0 ? '' : item.price));
  const [qty, setQty] = useState(String(item.quantity === 0 ? '' : item.quantity));

  const [showSuggestions, setShowSuggestions] = useState(false);
  const rowRef = useRef<HTMLTableRowElement>(null);

  const filteredProducts = useMemo(() => {
    if (!name) return [];
    return products.filter(p => p.name.includes(name)).slice(0, 10); // 最多展示10条联想
  }, [name, products]);

  // 统一提交保存
  const commitSave = () => {
    const numPrice = parseFloat(price) || 0;
    const numQty = parseInt(qty, 10) || 0;
    
    // 只有当真正发生变动时才上报
    if (name !== item.name || numPrice !== item.price || numQty !== item.quantity) {
      onUpdate(item.id, { name, price: numPrice, quantity: numQty });
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    // 如果焦点仍然在这行内部（例如点到了下拉框），阻止保存
    if (rowRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setTimeout(() => {
      setShowSuggestions(false);
      commitSave();
    }, 150);
  };

  // 选择联想项
  const handleSelectProduct = (p: DashboardItem) => {
    setName(p.name);
    // 优先取快快递价格，不行取广货价格
    const bestPrice = p.expressPrice || p.guanghuoPrice;
    if (bestPrice) setPrice(String(bestPrice));
    
    setShowSuggestions(false);
    // 选择后立即触发失焦机制或手动上传
    const finalPrice = bestPrice || parseFloat(price) || 0;
    onUpdate(item.id, { name: p.name, price: finalPrice, quantity: parseInt(qty) || 0 });
  };

  return (
    <TableRow 
      ref={rowRef}
      onBlur={handleBlur}
      className={cn("hover:bg-blue-50/50 group border-b border-blue-50/50 relative", index % 2 !== 0 && "bg-slate-50/40")}
    >
      <TableCell className="text-center font-bold text-slate-400 w-12 border-r border-blue-50/50 p-0 text-xs">
        {index + 1}
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 relative group/name focus-within:z-50">
        <input 
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="w-full h-11 px-3 bg-transparent outline-none font-bold text-[14px] text-slate-800 placeholder:text-slate-300"
          placeholder="输入名称"
        />
        {/* 联想下拉菜单 */}
        {showSuggestions && filteredProducts.length > 0 && (
          <div className="absolute top-11 left-0 w-full min-w-[200px] bg-white border border-slate-200 shadow-xl z-50 max-h-48 overflow-y-auto rounded-b-md">
            {filteredProducts.map(fp => (
              <div 
                key={fp.id} 
                onClick={() => handleSelectProduct(fp)}
                className="px-3 py-2 text-sm hover:bg-blue-50 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center"
              >
                <span className="font-bold text-slate-800">{fp.name}</span>
                <span className="text-emerald-600 font-mono text-xs">¥{fp.expressPrice || fp.guanghuoPrice || '-'}</span>
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 w-20 sm:w-28 text-center">
        <input 
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-bold text-[15px] sm:text-[17px] text-center text-blue-700"
          placeholder="0"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 w-20 sm:w-28 text-center">
        <input 
          type="number"
          value={price}
          onChange={e => setPrice(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-black text-[15px] sm:text-[17px] text-center text-rose-600"
          placeholder="0"
        />
      </TableCell>
      <TableCell className="w-10 sm:w-12 p-0 text-center align-middle">
        <div className="flex h-full w-full justify-center items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button 
            type="button"
            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="w-4 h-4"/>
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ==========================================
// 底部新增行组件
// ==========================================
function InventoryNewRow({
  index,
  products,
  onAdd
}: {
  index: number;
  products: DashboardItem[];
  onAdd: (name: string, price: number, qty: number) => void;
}) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const rowRef = useRef<HTMLTableRowElement>(null);

  const filteredProducts = useMemo(() => {
    if (!name) return [];
    return products.filter(p => p.name.includes(name)).slice(0, 10);
  }, [name, products]);

  const commitAdd = () => {
    const numPrice = parseFloat(price) || 0;
    const numQty = parseInt(qty, 10) || 0;
    
    // 如果名称、数量和价格都有意义，则触发添加
    if (name.trim() !== '' && numQty > 0) {
      onAdd(name, numPrice, numQty);
      // 清空用于下一行
      setName('');
      setPrice('');
      setQty('');
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (rowRef.current?.contains(e.relatedTarget as Node)) {
      return;
    }
    setTimeout(() => {
      setShowSuggestions(false);
      commitAdd(); // 尝试添加
    }, 150);
  };

  const handleSelectProduct = (p: DashboardItem) => {
    setName(p.name);
    const bestPrice = p.expressPrice || p.guanghuoPrice;
    if (bestPrice) setPrice(String(bestPrice));
    setShowSuggestions(false);
    
    // 设置光标或者让用户继续填数量
    // 此处不做自动提交，等用户填好数量失焦再提交
  };

  return (
    <TableRow 
      ref={rowRef}
      onBlur={handleBlur}
      className="bg-emerald-50/30 hover:bg-emerald-50/60 transition-colors border-b-2 border-emerald-100"
    >
      <TableCell className="text-center text-emerald-500 w-12 border-r border-emerald-100/50 p-0 text-sm">
        <Plus className="w-4 h-4 mx-auto" />
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 relative focus-within:z-50">
        <input 
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="w-full h-11 px-3 bg-transparent outline-none font-bold text-[14px] text-emerald-900 placeholder:text-emerald-300"
          placeholder="点击追加新品种..."
        />
        {showSuggestions && filteredProducts.length > 0 && (
          <div className="absolute top-11 left-0 w-full min-w-[200px] bg-white border border-emerald-200 shadow-xl z-[60] max-h-48 overflow-y-auto rounded-b-md">
            {filteredProducts.map(fp => (
              <div 
                key={fp.id} 
                onClick={() => handleSelectProduct(fp)}
                className="px-3 py-2 text-sm hover:bg-emerald-50 cursor-pointer border-b border-slate-50 last:border-0 flex justify-between items-center"
              >
                <span className="font-bold text-slate-800">{fp.name}</span>
                <span className="text-emerald-600 font-mono text-xs">¥{fp.expressPrice || fp.guanghuoPrice || '-'}</span>
              </div>
            ))}
          </div>
        )}
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 w-20 sm:w-28 text-center">
        <input 
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-bold text-[15px] sm:text-[17px] text-center text-emerald-700 placeholder:text-emerald-200/60"
          placeholder="数量"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 w-20 sm:w-28 text-center">
        <input 
          type="number"
          value={price}
          onChange={e => setPrice(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-black text-[15px] sm:text-[17px] text-center text-emerald-700 placeholder:text-emerald-200/60"
          placeholder="单价"
        />
      </TableCell>
      <TableCell className="w-10 sm:w-12 p-0 text-center align-middle">
        {/* 新增行无需红色的删除按钮 */}
      </TableCell>
    </TableRow>
  );
}

// ==========================================
// 主仪表盘组件
// ==========================================
export default function DashboardClient({ initialData, initialInventoryData }: { initialData: DashboardItem[], initialInventoryData: any[] }) {
  const router = useRouter();
  
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

  // 库存状态
  const [inventory, setInventory] = useState(initialInventoryData);

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

  // 普通视角的行列过滤
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

  // ----- 新版 Excel 化库存管控 -----
  const totalInvValue = inventory.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const totalInvCount = inventory.reduce((sum: number, item: any) => sum + item.quantity, 0);

  const onUpdateInventoryRow = async (id: string, data: any) => {
    // 乐观更新 UI
    setInventory(inventory.map((i: any) => i.id === id ? { ...i, ...data } : i));
    await updateInventoryItem(id, data);
  };

  const onDeleteInventoryRow = async (id: string) => {
    if(!confirm('确定移除此记录？')) return;
    setInventory(inventory.filter((i: any) => i.id !== id));
    await deleteInventoryItem(id);
  };

  const onAddNewInventoryRow = async (name: string, price: number, quantity: number) => {
    // 调用服务器创建
    const res = await createInventoryItem(name, price, quantity);
    if (res.success && res.data) {
      // 加到底部
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
            // ================= 【库存独立精简表格视图】 =================
            <div className="max-w-5xl mx-auto h-full flex flex-col">
              <div className="bg-slate-800 text-white p-4 sm:rounded-t-xl shrink-0">
                 <div className="flex justify-between items-start">
                   <div>
                     <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Amount / Count</p>
                     <div className="flex items-baseline gap-2">
                       <span className="text-sm border-r border-slate-600 pr-2">总数: <span className="font-mono text-base ml-1 text-emerald-400">{totalInvCount}</span></span>
                       <span className="text-xl font-mono text-white font-black tracking-tight">¥{totalInvValue.toLocaleString()}</span>
                     </div>
                   </div>
                 </div>
              </div>
              
              <div className="bg-white border-l border-r border-b border-slate-200 sm:rounded-b-xl shadow-sm flex-1 sm:overflow-hidden flex flex-col -mt-[1px]">
                  {/* 使用原生table构建像Excel一样密集的录入界面 */}
                  <div className="w-full overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[320px]">
                      <thead>
                        <tr className="bg-[#4a8ebf] text-white select-none">
                          <th className="w-12 py-2.5 px-0 text-center text-xs border-r border-[#3c78a3] font-black">⊕</th>
                          <th className="py-2.5 px-3 text-sm font-bold border-r border-[#3c78a3]">名称 👆</th>
                          <th className="w-20 sm:w-28 py-2.5 px-2 text-center text-sm font-bold border-r border-[#3c78a3]">数量</th>
                          <th className="w-20 sm:w-28 py-2.5 px-2 text-center text-sm font-bold border-r border-[#3c78a3]">价格</th>
                          <th className="w-10 sm:w-12 py-2.5 px-0 text-center border-r border-[#3c78a3]"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {inventory.map((item: any, i: number) => (
                          <InventoryRow 
                            key={item.id} 
                            item={item} 
                            index={i} 
                            products={initialData} 
                            onUpdate={onUpdateInventoryRow} 
                            onDelete={onDeleteInventoryRow} 
                          />
                        ))}
                        {/* 始终呈现的新增行悬停在尾部 */}
                        <InventoryNewRow 
                          index={inventory.length} 
                          products={initialData} 
                          onAdd={onAddNewInventoryRow} 
                        />
                      </tbody>
                    </table>
                  </div>
              </div>
            </div>
          ) : (
            // ================= 【常规比价视图】 =================
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

              {/* 此处省略现有的列表和网络视图代码逻辑，与上一版相同 */}
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
          )}
        </div>
      </main>
    </div>
  );
}