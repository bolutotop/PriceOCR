'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DashboardCategory } from '@/actions/get-dashboard-data';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Plus, Search, TrendingUp, Calendar ,History} from 'lucide-react';


export default function DashboardClient({ initialData }: { initialData: DashboardCategory[] }) {
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const [searchTerm, setSearchTerm] = useState('');

  // 1. 计算所有分类用于渲染侧边栏/标签条
  const categoryNames = ['全部', ...initialData.map(c => c.name)];

  // 2. 根据当前选中的分类和搜索词过滤数据
  const filteredProducts = initialData.flatMap(cat => 
    cat.products.map(p => ({ ...p, categoryName: cat.name }))
  ).filter(item => {
    const matchesCategory = activeCategory === '全部' || item.categoryName === activeCategory;
    const matchesSearch = item.name.includes(searchTerm);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="flex flex-col lg:flex-row min-h-screen bg-slate-50">
      
      {/* === 侧边栏 (PC端显示) === */}
      <aside className="hidden lg:block w-64 bg-white border-r h-screen sticky top-0 overflow-y-auto">
        <div className="p-6">
          <h1 className="text-2xl font-extrabold text-slate-900 flex items-center gap-2">
            <TrendingUp className="text-blue-600" /> 烟价看板
          </h1>
          <p className="text-sm text-slate-500 mt-1">实时掌握行情波动</p>
        </div>
        <nav className="px-4 space-y-1">
          {categoryNames.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`w-full text-left px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                activeCategory === cat 
                  ? 'bg-blue-50 text-blue-700' 
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {cat}
            </button>
          ))}
        </nav>
      </aside>

      {/* === 主要内容区 === */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        
        {/* 顶部 Header */}
        <header className="bg-white border-b px-4 py-3 flex items-center justify-between shrink-0 z-20">
          <div className="lg:hidden font-bold text-slate-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" /> 烟价看板
          </div>
          
          <div className="flex-1 max-w-md mx-4 hidden sm:block">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="搜索香烟名称..." 
                className="pl-9 bg-slate-100 border-none" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
<Link href="/history">
    <Button variant="outline" className="hidden sm:flex">
      <History className="w-4 h-4 mr-1" /> 历史记录
    </Button>
  </Link>
          <Link href="/import">
            <Button className="bg-blue-600 hover:bg-blue-700 shadow-sm">
              <Plus className="w-4 h-4 mr-1" /> 导入报价
            </Button>
          </Link>
        </header>

        {/* 手机端搜索栏 (独立一行) */}
        <div className="sm:hidden px-4 py-2 bg-white border-b">
           <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input 
                placeholder="搜索..." 
                className="pl-9 bg-slate-100 border-none h-9 text-sm" 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
        </div>

        {/* === 顶部标签栏 (手机端显示) === */}
        <div className="lg:hidden bg-white border-b overflow-x-auto whitespace-nowrap scrollbar-hide">
          <div className="flex px-4 py-2 gap-2">
            {categoryNames.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  activeCategory === cat 
                    ? 'bg-blue-600 text-white border-blue-600 shadow-sm' 
                    : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 内容滚动区 */}
        <div className="flex-1 overflow-auto p-4 lg:p-8">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredProducts.map(item => (
              // 关键修改：在这里包裹 Link 组件
              <Link href={`/product/${item.id}`} key={item.id} className="block h-full">
                <Card className="hover:shadow-md transition-shadow group border-slate-200 h-full">
                  <CardContent className="p-4 flex flex-col justify-between h-full space-y-3">
                    <div>
                      <div className="flex justify-between items-start mb-1">
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-slate-400 border-slate-200 font-normal">
                          {item.categoryName}
                        </Badge>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base leading-tight group-hover:text-blue-600 transition-colors">
                        {item.name}
                      </h3>
                    </div>
                    
                    <div className="pt-2 border-t border-dashed border-slate-100">
                      <div className="flex items-end justify-between">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-400 mb-0.5">最新价</span>
                          <span className={`text-lg font-mono font-bold leading-none ${
                            !item.latestPrice ? 'text-slate-300' : item.latestPrice > 1000 ? 'text-red-600' : 'text-slate-900'
                          }`}>
                            {item.latestPrice === -1 ? '//' : item.latestPrice || '--'}
                          </span>
                        </div>
                        {item.lastUpdate && (
                          <div className="text-[10px] text-slate-400 flex items-center bg-slate-50 px-1.5 py-0.5 rounded">
                            <Calendar className="w-3 h-3 mr-1 opacity-70" />
                            {new Date(item.lastUpdate).getMonth() + 1}-{new Date(item.lastUpdate).getDate()}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
          
          {filteredProducts.length === 0 && (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400">
              <Search className="w-8 h-8 mb-2 opacity-20" />
              <p>暂无相关数据</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}