'use client';

import { useState, useMemo, useRef } from 'react';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { TableRow, TableCell } from '@/components/ui/table';
import { Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

// ==========================================
// 提取可复用的库存行组件 (单行内联编辑)
// ==========================================
export function InventoryRow({
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
    return products.filter(p => p.name.includes(name)).slice(0, 10);
  }, [name, products]);

  const commitSave = () => {
    const numPrice = parseFloat(price) || 0;
    const numQty = parseInt(qty, 10) || 0;
    if (name !== item.name || numPrice !== item.price || numQty !== item.quantity) {
      onUpdate(item.id, { name, price: numPrice, quantity: numQty });
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    setTimeout(() => {
      setShowSuggestions(false);
      commitSave();
    }, 150);
  };

  const handleSelectProduct = (p: DashboardItem) => {
    setName(p.name);
    const bestPrice = p.expressPrice || p.guanghuoPrice;
    if (bestPrice) setPrice(String(bestPrice));

    setShowSuggestions(false);
    const finalPrice = bestPrice || parseFloat(price) || 0;
    onUpdate(item.id, { name: p.name, price: finalPrice, quantity: parseInt(qty) || 0 });
  };

  const total = (parseFloat(price) || 0) * (parseInt(qty, 10) || 0);

  return (
    <TableRow
      ref={rowRef}
      onBlur={handleBlur}
      className={cn("hover:bg-blue-50/50 group border-b border-blue-50/50 relative", index % 2 !== 0 && "bg-slate-50/40")}
    >
      <TableCell className="text-center font-bold text-slate-400 w-10 sm:w-12 border-r border-blue-50/50 p-0 text-xs">
        {index + 1}
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 relative group/name focus-within:z-[60]">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="w-full h-11 px-2 sm:px-3 bg-transparent outline-none font-bold text-[13px] sm:text-[14px] text-slate-800 placeholder:text-slate-300"
          placeholder="输入名称"
        />
        {showSuggestions && filteredProducts.length > 0 && (
          <div className="absolute top-[105%] left-0 w-full min-w-[200px] bg-white border border-slate-200 shadow-xl max-h-48 overflow-y-auto rounded-md custom-scrollbar">
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
      <TableCell className="p-0 border-r border-blue-50/50 w-16 sm:w-20 text-center">
        <input
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-bold text-[14px] sm:text-[16px] text-center text-blue-700"
          placeholder="0"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center">
        <input
          type="number"
          value={price}
          onChange={e => setPrice(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-black text-[14px] sm:text-[16px] text-center text-rose-600"
          placeholder="0.0"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-blue-50/50 w-20 sm:w-24 text-center bg-slate-50/80">
        <div className="w-full h-11 flex items-center justify-center font-mono font-black text-[14px] sm:text-[16px] text-slate-700 select-all">
          {total > 0 ? total.toLocaleString() : '-'}
        </div>
      </TableCell>
      <TableCell className="w-10 sm:w-12 p-0 text-center align-middle">
        <div className="flex h-full w-full justify-center items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            type="button"
            className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full"
            onClick={() => onDelete(item.id)}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ==========================================
// 底部新增行组件
// ==========================================
export function InventoryNewRow({
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
    if (name.trim() !== '' && numQty > 0) {
      onAdd(name, numPrice, numQty);
      setName('');
      setPrice('');
      setQty('');
    }
  };

  const handleBlur = (e: React.FocusEvent) => {
    if (rowRef.current?.contains(e.relatedTarget as Node)) return;
    setTimeout(() => {
      setShowSuggestions(false);
      commitAdd();
    }, 150);
  };

  const handleSelectProduct = (p: DashboardItem) => {
    setName(p.name);
    const bestPrice = p.expressPrice || p.guanghuoPrice;
    if (bestPrice) setPrice(String(bestPrice));
    setShowSuggestions(false);
  };

  const total = (parseFloat(price) || 0) * (parseInt(qty, 10) || 0);

  return (
    <TableRow
      ref={rowRef}
      onBlur={handleBlur}
      className="bg-emerald-50/30 hover:bg-emerald-50/60 transition-colors border-b-2 border-emerald-100 relative"
    >
      <TableCell className="text-center text-emerald-500 w-10 sm:w-12 border-r border-emerald-100/50 p-0 text-sm">
        <Plus className="w-4 h-4 mx-auto" />
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 relative focus-within:z-[60]">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onFocus={() => setShowSuggestions(true)}
          className="w-full h-11 px-2 sm:px-3 bg-transparent outline-none font-bold text-[13px] sm:text-[14px] text-emerald-900 placeholder:text-emerald-300"
          placeholder="追加名字..."
        />
        {showSuggestions && filteredProducts.length > 0 && (
          <div className="absolute top-[105%] left-0 w-full min-w-[200px] bg-white border border-emerald-200 shadow-xl max-h-48 overflow-y-auto rounded-md custom-scrollbar">
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
      <TableCell className="p-0 border-r border-emerald-100/50 w-16 sm:w-20 text-center">
        <input
          type="number"
          value={qty}
          onChange={e => setQty(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-bold text-[14px] sm:text-[16px] text-center text-emerald-700 placeholder:text-emerald-200/60"
          placeholder="数目"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 w-20 sm:w-24 text-center">
        <input
          type="number"
          value={price}
          onChange={e => setPrice(e.target.value)}
          className="w-full h-11 px-1 bg-transparent outline-none font-mono font-black text-[14px] sm:text-[16px] text-center text-emerald-700 placeholder:text-emerald-200/60"
          placeholder="单价"
        />
      </TableCell>
      <TableCell className="p-0 border-r border-emerald-100/50 w-20 sm:w-24 text-center bg-emerald-100/30">
        <div className="w-full h-11 flex items-center justify-center font-mono font-black text-[14px] sm:text-[16px] text-emerald-800/60">
          {total > 0 ? total.toLocaleString() : '-'}
        </div>
      </TableCell>
      <TableCell className="w-10 sm:w-12 p-0 text-center align-middle"></TableCell>
    </TableRow>
  );
}

// ==========================================
// 库存大表视图容器
// ==========================================
export default function InventoryView({
  inventory,
  products,
  onUpdateInventoryRow,
  onDeleteInventoryRow,
  onAddNewInventoryRow
}: {
  inventory: any[];
  products: DashboardItem[];
  onUpdateInventoryRow: (id: string, data: any) => void;
  onDeleteInventoryRow: (id: string) => void;
  onAddNewInventoryRow: (name: string, price: number, qty: number) => void;
}) {
  const totalInvValue = inventory.reduce((sum: number, item: any) => sum + item.price * item.quantity, 0);
  const totalInvCount = inventory.reduce((sum: number, item: any) => sum + item.quantity, 0);

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col pb-[120px]">
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

      {/* 移除导致截断的 overflow-hidden，让子元素的 absolute 菜单可以不受限地盖住下方 */}
      <div className="bg-white border-l border-r border-b border-slate-200 sm:rounded-b-xl shadow-sm flex-1 flex flex-col -mt-[1px]">
        <div className="w-full">
          <table className="w-full text-left border-collapse min-w-[320px]">
            <thead className="sticky top-[52px] lg:top-[60px] z-40 shadow-sm">
              <tr className="bg-[#4a8ebf] text-white select-none">
                <th className="w-10 sm:w-12 py-2.5 px-0 text-center text-xs border-r border-[#3c78a3] font-black"></th>
                <th className="py-2.5 px-2 sm:px-3 text-xs sm:text-sm font-bold border-r border-[#3c78a3]">名称</th>
                <th className="w-16 sm:w-20 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3]">数量</th>
                <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3]">单价</th>
                <th className="w-20 sm:w-24 py-2.5 px-1 text-center text-xs sm:text-sm font-bold border-r border-[#3c78a3]">金额</th>
                <th className="w-10 sm:w-12 py-2.5 px-0 text-center border-r border-[#3c78a3]"></th>
              </tr>
            </thead>
            <tbody>
              {inventory.map((item: any, i: number) => (
                <InventoryRow
                  key={item.id}
                  item={item}
                  index={i}
                  products={products}
                  onUpdate={onUpdateInventoryRow}
                  onDelete={onDeleteInventoryRow}
                />
              ))}
              <InventoryNewRow
                index={inventory.length}
                products={products}
                onAdd={onAddNewInventoryRow}
              />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
