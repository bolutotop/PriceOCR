'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getMappingTasks, mergeProducts, getMappings, deleteMapping } from '@/actions/mapping';
import { Input } from '@/components/ui/input';
import { ArrowRightLeft, Trash2, CheckCircle2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// 自定义的可搜索下拉组件，避免依赖额外库
function SearchableSelect({ 
  options, 
  value, 
  onChange, 
  placeholder 
}: { 
  options: {id: string, name: string}[], 
  value: string, 
  onChange: (val: string) => void,
  placeholder: string 
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filtered = options.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));
  const selectedName = options.find(o => o.id === value)?.name || '';

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div 
        className="flex h-9 w-full items-center justify-between rounded-md border border-slate-200 bg-transparent px-3 py-2 text-sm shadow-sm cursor-pointer hover:bg-slate-50"
        onClick={() => { setOpen(!open); setSearch(''); }}
      >
        <span className={cn("truncate", !value && "text-slate-500")}>
          {value ? selectedName : placeholder}
        </span>
      </div>
      
      {open && (
        <div className="absolute top-full mt-1 z-50 w-full rounded-md border bg-white shadow-md max-h-60 flex flex-col">
          <div className="p-2 border-b bg-slate-50/80 sticky top-0">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
              <Input 
                autoFocus
                placeholder="搜索标准名..." 
                className="h-8 pl-8 text-xs bg-white"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-y-auto p-1 text-sm">
            {filtered.length === 0 ? (
              <div className="p-2 text-center text-slate-500 text-xs">无匹配项</div>
            ) : (
              filtered.map(opt => (
                <div 
                  key={opt.id}
                  className={cn(
                    "cursor-pointer rounded-sm px-2 py-1.5 text-slate-900 hover:bg-slate-100 hover:text-slate-900",
                    value === opt.id && "bg-slate-100 font-medium"
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

export default function MappingPage() {
  const [guanghuoProducts, setGuanghuoProducts] = useState<{ id: string; name: string }[]>([]);
  const [tasks, setTasks] = useState<{ id: string; name: string }[]>([]);
  const [mappings, setMappings] = useState<any[]>([]);
  
  // 记录每个任务选择的目标ID
  const [selections, setSelections] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  
  const [loading, setLoading] = useState(true);

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
      // 刷新已有映射
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
      await load(); // 重新加载全部
    } else {
      alert('删除失败: ' + res.error);
    }
  };

  return (
    <div className="container max-w-6xl mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">名称同步与清洗待办</h1>
          <p className="text-slate-500 mt-1 text-sm font-medium">系统已自动为你筛选出“只有快递报价、没有广货报价”的疑似异名。</p>
        </div>
        <div className="mt-4 md:mt-0 flex gap-4 text-sm">
          <div className="flex flex-col items-end">
            <span className="font-bold text-slate-800 text-lg leading-none">{tasks.length}</span>
            <span className="text-slate-400 text-xs">待处理项</span>
          </div>
          <div className="flex flex-col items-end border-l pl-4 border-slate-200">
            <span className="font-bold text-emerald-600 text-lg leading-none">{guanghuoProducts.length}</span>
            <span className="text-slate-400 text-xs">广货标准库</span>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-[2fr_1fr] gap-6 items-start">
        {/* 左侧：待办任务列表 */}
        <Card className="shadow-sm border-slate-200">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100 pb-4">
            <CardTitle className="text-[15px] flex items-center gap-2">待办：将快递专属名称挂靠至系统标准库</CardTitle>
            <CardDescription>只需为每一行选择它对应的标准名称，点击合并即可完成清洗。</CardDescription>
          </CardHeader>
          <div className="p-0">
            {loading ? (
              <div className="py-12 flex justify-center text-slate-400 text-sm">正在分析数据中...</div>
            ) : tasks.length === 0 ? (
              <div className="py-16 flex flex-col items-center justify-center text-slate-400">
                <CheckCircle2 className="w-12 h-12 text-emerald-100 mb-3" />
                <p className="font-medium text-slate-600">太棒了，目前没有孤立的快递异名数据！</p>
                <p className="text-xs mt-1">你的所有商品名称都已经非常规范。</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50/80 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-[35%] font-bold text-slate-700">快递专属名 (待接管)</TableHead>
                    <TableHead className="w-[45%] font-bold text-slate-700">为它指定一个广货名称</TableHead>
                    <TableHead className="w-[20%] text-right font-bold text-slate-700 pr-4">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tasks.map(task => (
                    <TableRow key={task.id} className="hover:bg-slate-50/80 group">
                      <TableCell className="font-bold text-slate-900">
                        {task.name}
                      </TableCell>
                      <TableCell>
                        <SearchableSelect 
                          options={guanghuoProducts} 
                          placeholder="点击搜索并选择广货名..."
                          value={selections[task.id] || ''}
                          onChange={(val) => setSelections(prev => ({...prev, [task.id]: val}))}
                        />
                      </TableCell>
                      <TableCell className="text-right pr-4">
                        <Button 
                          size="sm" 
                          onClick={() => handleMerge(task.id, task.name)}
                          disabled={!selections[task.id] || submittingId === task.id}
                          className={cn(
                            "transition-all duration-200", 
                            !selections[task.id] ? "opacity-50" : "bg-blue-600 hover:bg-blue-700 text-white shadow-sm"
                          )}
                        >
                          {submittingId === task.id ? '合并中' : '执行合并'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>

        {/* 右侧：生效中的别名表 */}
        <Card className="shadow-sm border-slate-200 bg-slate-50/30">
          <CardHeader className="pb-3 border-b border-slate-100">
            <CardTitle className="text-[15px]">已生效的拦截规则</CardTitle>
            <CardDescription className="text-xs">当新图片扫到左侧名字，自动转换成右侧。</CardDescription>
          </CardHeader>
          <CardContent className="pt-4 p-3 md:p-4">
            {loading ? (
              <div className="text-center text-sm py-4 text-slate-400">加载中...</div>
            ) : mappings.length === 0 ? (
              <div className="text-center text-sm py-8 text-slate-400 rounded-md border border-dashed border-slate-200 bg-slate-50/50">暂无任何规则</div>
            ) : (
              <div className="space-y-2.5 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar">
                {mappings.map(m => (
                  <div key={m.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-md p-2.5 shadow-sm text-sm group hover:border-slate-300 transition-colors">
                    <div className="flex items-center space-x-2 flex-1 min-w-0">
                      <span className="font-bold text-rose-600 truncate max-w-[40%] text-xs" title={m.name}>{m.name}</span>
                      <ArrowRightLeft className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />
                      <span className="font-bold text-emerald-600 truncate max-w-[40%] text-xs" title={m.product?.name}>{m.product?.name}</span>
                    </div>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-slate-300 group-hover:text-red-500 hover:bg-red-50" onClick={() => handleDeleteMapping(m.id)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
