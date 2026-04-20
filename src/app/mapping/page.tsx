'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMappingTasks, mergeProducts, getMappings, deleteMapping } from '@/actions/mapping';
import { Input } from '@/components/ui/input';
import { ArrowRightLeft, Trash2, CheckCircle2, Search, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

// =========================================================
// 自定义可搜索下拉组件 (移动端适配强化版)
// =========================================================
// =========================================================
// 自定义可搜索下拉组件 (合二为一 丝滑版)
// =========================================================
function SearchableSelect({
  options,
  value,
  onChange,
  placeholder
}: {
  options: { id: string, name: string }[],
  value: string,
  onChange: (val: string) => void,
  placeholder: string
}) {
  const [open, setOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  // 获取当前选中项的真实名称
  const selectedName = options.find(o => o.id === value)?.name || '';

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 聚焦时：展开下拉列表，并清空搜索词（方便直接看全量数据或重新搜索）
  const handleFocus = () => {
    setOpen(true);
    setSearchTerm('');
  };

  const filtered = options.filter(o => o.name.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div className={cn("relative w-full", open ? "z-[100]" : "z-10")} ref={wrapperRef}>
      <div className="relative">
        <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 transition-colors", open ? "text-blue-500" : "text-slate-400")} />
        <Input
          type="text"
          placeholder={placeholder}
          // 🚨 核心逻辑：打开时输入框显示当前正在搜索的词，关闭时显示已经绑定选中的名称
          value={open ? searchTerm : selectedName}
          onChange={e => {
            setSearchTerm(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={handleFocus}
          className={cn(
            "h-10 md:h-9 pl-9 w-full bg-white transition-all text-sm shadow-sm cursor-text font-medium",
            open ? "border-blue-400 ring-1 ring-blue-400 text-slate-900" : "border-slate-200 hover:border-slate-300 text-slate-700",
            !value && !open && "text-slate-400 font-normal"
          )}
        />
      </div>

      {open && (
        <div className="absolute top-full mt-1 w-full rounded-md border border-slate-200 bg-white shadow-[0_8px_30px_rgb(0,0,0,0.12)] max-h-[250px] flex flex-col overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="overflow-y-auto p-1.5 text-sm custom-scrollbar flex-1">
            {filtered.length === 0 ? (
              <div className="p-3 text-center text-slate-400 text-xs">无匹配项</div>
            ) : (
              filtered.map(opt => (
                <div
                  key={opt.id}
                  className={cn(
                    "cursor-pointer rounded-md px-2.5 py-2 text-slate-700 hover:bg-blue-50 hover:text-blue-700 transition-colors mb-0.5",
                    value === opt.id && "bg-blue-50 text-blue-700 font-bold"
                  )}
                  onClick={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                >
                  {opt.name}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================
// 主页面组件
// =========================================================
export default function MappingPage() {
  const [guanghuoProducts, setGuanghuoProducts] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 🚨 新增：移动端专属的 Tab 切换状态
  const [activeTab, setActiveTab] = useState<'tasks' | 'rules'>('tasks');

  // 🚨 新增：全局搜索状态与过滤计算
  const [globalSearch, setGlobalSearch] = useState('');

  const filteredTasks = tasks.filter(t =>
    t.name.toLowerCase().includes(globalSearch.toLowerCase())
  );

  const filteredMappings = mappings.filter(m =>
    m.name.toLowerCase().includes(globalSearch.toLowerCase()) ||
    (m.product?.name || '').toLowerCase().includes(globalSearch.toLowerCase())
  );
  async function load() {
    setLoading(true);
    const [tasksRes, mapRes] = await Promise.all([
      getMappingTasks(),
      getMappings()
    ]);

    if (tasksRes.success && tasksRes.data) {
      setGuanghuoProducts(tasksRes.data.guanghuoProducts);
      setTasks(tasksRes.data.expressOnlyProducts);
    }
    if (mapRes.success && mapRes.data) {
      setMappings(mapRes.data);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const handleMerge = async (sourceId: string, sourceName: string) => {
    const targetId = selections[sourceId];
    if (!targetId) return alert('请先为它选择一个广货名字');

    setSubmittingId(sourceId);
    const res = await mergeProducts(targetId, sourceId);
    if (res.success) {
      setTasks(prev => prev.filter(t => t.id !== sourceId));
      setSelections(prev => {
        const next = { ...prev };
        delete next[sourceId];
        return next;
      });
      const mapRes = await getMappings();
      if (mapRes.success && mapRes.data) setMappings(mapRes.data);
    } else {
      alert('合并失败: ' + res.error);
    }
    setSubmittingId(null);
  };

  const handleDeleteMapping = async (id: string) => {
    if (!confirm('确定要删除这条规则吗？这不会撤销以前合并的数据，只会让未来的扫描不再自动转换。')) return;
    const res = await deleteMapping(id);
    if (res.success) {
      await load();
    } else {
      alert('删除失败: ' + res.error);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20">

      {/* 🚨 新增：移动端专属顶部导航条 */}
      <div className="md:hidden bg-white/95 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-3 flex items-center shadow-sm h-[60px]">
        <Link href="/">
          <Button variant="ghost" size="icon" className="rounded-none -ml-2 text-slate-600 hover:bg-slate-100 transition-colors">
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </Button>
        </Link>
        <h1 className="text-base font-black text-slate-800 tracking-tight ml-1">名称同步映射</h1>
      </div>

      <div className="container max-w-6xl mx-auto py-4 md:py-8 px-3 md:px-4 space-y-4 md:space-y-6">

        {/* 标题说明区 */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-4 mt-2 md:mt-0">
          <div>
            <h1 className="hidden md:block text-2xl font-black tracking-tight text-slate-900">名称同步与清洗待办</h1>
            <p className="text-slate-500 mt-1 text-xs md:text-sm font-medium leading-relaxed">
              系统已自动为你筛选出“只有快递报价、没有广货报价”的疑似异名。
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex gap-4 text-sm w-full md:w-auto">
            <div className="flex flex-col flex-1 md:flex-none items-start md:items-end bg-white md:bg-transparent p-3 md:p-0 rounded-md border md:border-none border-slate-200">
              <span className="font-bold text-slate-800 text-lg md:text-xl leading-none">{tasks.length}</span>
              <span className="text-slate-400 text-xs mt-1">待处理项</span>
            </div>
            <div className="flex flex-col flex-1 md:flex-none items-start md:items-end bg-white md:bg-transparent p-3 md:p-0 rounded-md border md:border-none border-slate-200 md:border-l md:pl-4">
              <span className="font-bold text-emerald-600 text-lg md:text-xl leading-none">{guanghuoProducts.length}</span>
              <span className="text-slate-400 text-xs mt-1">广货标准库</span>
            </div>
          </div>
        </div>
        {/* 🚨 新增：全局检索搜索框 */}
        <div className="relative w-full mt-4 mb-2 md:mb-4">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="全局检索：输入待办名称、或已映射的标准名..."
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            className="pl-10 h-11 bg-white border-slate-200 focus-visible:ring-1 focus-visible:ring-blue-500 shadow-sm w-full font-medium text-sm transition-all"
          />
        </div>
        {/* 🚨 新增：移动端专属 Tab 切换器 (仅在小于 lg 屏幕时显示) */}
        <div className="lg:hidden flex p-1 bg-slate-200/60 rounded-lg mb-2">
          <button
            onClick={() => setActiveTab('tasks')}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5",
              activeTab === 'tasks' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            待办清洗 <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-black", activeTab === 'tasks' ? "bg-blue-100 text-blue-700" : "bg-slate-300/50 text-slate-500")}>{tasks.length}</span>
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={cn(
              "flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5",
              activeTab === 'rules' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            已生效规则 <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-black", activeTab === 'rules' ? "bg-emerald-100 text-emerald-700" : "bg-slate-300/50 text-slate-500")}>{mappings.length}</span>
          </button>
        </div>
        <div className="grid lg:grid-cols-[2fr_1fr] gap-4 md:gap-6 items-start">

          {/* 左侧：待办任务列表 */}
          <Card className={cn("shadow-sm border-slate-200 overflow-hidden", activeTab !== 'tasks' && "hidden lg:block")}>
            <CardHeader className="bg-slate-50/80 border-b border-slate-100 pb-4 px-4 md:px-6">
              <CardTitle className="text-[15px] flex items-center gap-2">待办清洗列表</CardTitle>
              <CardDescription className="text-xs md:text-sm">为每一行选择它对应的标准名称，点击合并完成清洗。</CardDescription>
            </CardHeader>
            <div className="p-0 bg-white">
              {loading ? (
                <div className="py-12 flex justify-center text-slate-400 text-sm">正在分析数据中...</div>
              ) : filteredTasks.length === 0 ? (
                <div className="py-16 flex flex-col items-center justify-center text-slate-400 px-4 text-center">
                  <CheckCircle2 className="w-12 h-12 text-emerald-100 mb-3" />
                  <p className="font-medium text-slate-600">太棒了，目前没有孤立的快递异名数据！</p>
                  <p className="text-xs mt-1">你的所有商品名称都已经非常规范。</p>
                </div>
              ) : (
                <div className="flex flex-col w-full">
                  {/* 🚨 修改：响应式表格表头 (仅在 md 及以上屏幕显示) */}
                  <div className="hidden md:flex flex-row bg-slate-50/80 sticky top-0 z-10 border-b border-slate-200 px-4 py-3">
                    <div className="w-[35%] font-bold text-slate-700 text-sm">快递专属名 (待接管)</div>
                    <div className="w-[45%] font-bold text-slate-700 text-sm pl-2">为它指定一个广货名称</div>
                    <div className="w-[20%] text-right font-bold text-slate-700 text-sm pr-2">操作</div>
                  </div>

                  {/* 🚨 修改：响应式数据行 */}
                  <div className="divide-y divide-slate-100">
                    {filteredTasks.map(task => (
                      <div key={task.id} className="flex flex-col md:flex-row items-start md:items-center p-3 md:px-4 md:py-3 hover:bg-slate-50/80 transition-colors group gap-2 md:gap-0">

                        {/* 名字区 */}
                        <div className="w-full md:w-[35%] font-black md:font-bold text-slate-900 text-[13px] md:text-sm pt-1 md:pt-0 pr-2 truncate">
                          <span className="md:hidden text-slate-400 font-normal mr-1 border border-slate-200 rounded px-1 text-[10px]">原名</span>
                          {task.name}
                        </div>
                        {/* 操作区 (移动端并排) */}
                        <div className="w-full md:w-[65%] flex flex-row items-center gap-2 md:gap-0 mt-1 md:mt-0">
                          {/* 🚨 核心修复：删除 relative z-20，让内部的 z-[100] 能穿透出来 */}
                          <div className="flex-1 md:w-[70%] md:pr-4">
                            <SearchableSelect
                              options={guanghuoProducts}
                              placeholder="选择广货标准名..."
                              value={selections[task.id] || ''}
                              onChange={(val) => setSelections(prev => ({ ...prev, [task.id]: val }))}
                            />
                          </div>

                          <div className="md:w-[30%] flex justify-end text-right shrink-0">
                            <Button
                              size="sm"
                              onClick={() => handleMerge(task.id, task.name)}
                              disabled={!selections[task.id] || submittingId === task.id}
                              className={cn(
                                "h-10 md:h-9 px-3 md:px-4 transition-all duration-200 font-bold",
                                !selections[task.id] ? "opacity-50" : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                              )}
                            >
                              {submittingId === task.id ? '合并中' : '合并'}
                            </Button>
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* 右侧：生效中的别名表 */}
          <Card className={cn("shadow-sm border-slate-200 bg-slate-50/30 overflow-hidden", activeTab !== 'rules' && "hidden lg:block")}>
            <CardHeader className="pb-3 border-b border-slate-100 px-4 md:px-6 bg-white">
              <CardTitle className="text-[15px]">已生效的拦截规则</CardTitle>
              <CardDescription className="text-xs">当扫描到左侧名字，自动映射为右侧。</CardDescription>
            </CardHeader>
            <CardContent className="p-3 md:p-4 bg-slate-50/50">
              {loading ? (
                <div className="text-center text-sm py-4 text-slate-400">加载中...</div>
              ) : filteredMappings.length === 0 ? (
                <div className="text-center text-sm py-8 text-slate-400 rounded-md border border-dashed border-slate-200 bg-white">暂无任何规则</div>
              ) : (
                <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                  {filteredMappings.map(m => (
                    <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-md p-3 shadow-sm text-sm group hover:border-slate-300 transition-colors gap-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 flex-1 min-w-0">
                        <span className="font-bold text-rose-600 truncate sm:max-w-[40%] text-xs" title={m.name}>{m.name}</span>
                        <ArrowRightLeft className="hidden sm:block w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                        <span className="font-bold text-emerald-600 truncate sm:max-w-[40%] text-xs" title={m.product?.name}>{m.product?.name}</span>
                      </div>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 group-hover:text-red-500 hover:bg-red-50 shrink-0" onClick={() => handleDeleteMapping(m.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  );
}