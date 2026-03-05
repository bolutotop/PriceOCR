'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { getUploadHistory, deletePriceSheet } from '@/actions/history';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, 
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { Trash2, Calendar, Clock, Loader2, ChevronLeft, Database, FileText } from 'lucide-react';
import Link from 'next/link';

type HistoryItem = {
  id: string;
  title: string | null;
  marketType?: string; 
  recordDate: Date;
  createdAt: Date;
  _count: { items: number };
};

export default function HistoryPage() {
  const [data, setData] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const res = await getUploadHistory();
    setData(res as any); 
    setLoading(false);
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await deletePriceSheet(id);
    if (res.success) {
      setData(prev => prev.filter(item => item.id !== id));
    } else {
      alert('删除失败，请检查网络或控制台');
    }
    setDeletingId(null);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200/50 pb-10">
      
      {/* 顶部导航：硬朗直边、强左对齐 */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 px-4 md:px-5 py-3 sticky top-0 z-20 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3 md:gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-none -ml-2 text-slate-600 hover:bg-slate-100 transition-colors ease-out">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 md:w-5 md:h-5 text-slate-700" />
            <h1 className="font-black text-slate-800 text-base md:text-lg tracking-tight">数据管理中心</h1>
          </div>
        </div>
        <div className="text-xs font-bold text-slate-500">
          共 {data.length} 份单据
        </div>
      </div>

      <div className="max-w-5xl mx-auto p-4 md:p-6 mt-2 md:mt-4">
        <Card className="rounded-none border-slate-200 shadow-sm bg-white overflow-hidden">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-20"><Loader2 className="animate-spin text-slate-400 w-8 h-8" /></div>
            ) : (
              <div className="overflow-x-auto scrollbar-hide">
                <Table className="w-full">
                  <TableHeader className="bg-slate-100/80 border-b border-slate-200 whitespace-nowrap">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="font-bold text-slate-700 w-[140px] md:w-[160px]">
                        业务日期 <span className="md:hidden text-slate-400 font-normal">/ 备注</span>
                      </TableHead>
                      <TableHead className="font-bold text-slate-700 w-[110px] md:w-[130px]">
                        单据归属 <span className="md:hidden text-slate-400 font-normal">/ 规模</span>
                      </TableHead>
                      <TableHead className="font-bold text-slate-700 hidden md:table-cell">标识 / 备注</TableHead>
                      <TableHead className="font-bold text-slate-700 hidden md:table-cell">包含品种</TableHead>
                      <TableHead className="font-bold text-slate-700 text-right pr-4 md:pr-6">操作执行</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((sheet) => {
                      const isExpress = sheet.marketType === 'EXPRESS';
                      return (
                        <TableRow key={sheet.id} className="hover:bg-slate-50 border-b border-slate-100 transition-colors ease-out group">
                          
                          {/* 1. 日期列 (移动端折叠显示备注) */}
                          <TableCell className="align-top md:align-middle py-3 md:py-4">
                            <div className="flex items-center gap-1.5 md:gap-2 font-mono text-slate-800 text-sm md:text-base font-bold">
                              <Calendar className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-400" />
                              {format(new Date(sheet.recordDate), 'yyyy-MM-dd')}
                            </div>
                            <div className="flex items-center gap-1.5 md:gap-2 text-slate-400 text-[10px] md:text-xs mt-1 md:mt-1.5 pl-0.5">
                              <Clock className="w-3 h-3" />
                              {format(new Date(sheet.createdAt), 'HH:mm')}
                            </div>
                            
                            {/* 📱 移动端专属：合并显示备注信息 */}
                            <div className="md:hidden mt-2.5 pt-2 border-t border-slate-100 text-xs text-slate-600 truncate max-w-[140px]">
                              {sheet.title || <span className="text-slate-400 font-normal">系统默认抓取</span>}
                            </div>
                          </TableCell>

                          {/* 2. 归属列 (移动端折叠显示条目数) */}
                          <TableCell className="align-top md:align-middle py-3 md:py-4">
                            <div className="mb-2 md:mb-0">
                              <span className={`text-[10px] md:text-xs font-bold px-1.5 py-0.5 md:px-2 md:py-1 border ${isExpress ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                {isExpress ? '快递行情' : '广货行情'}
                              </span>
                            </div>
                            
                            {/* 📱 移动端专属：合并显示条目数量 */}
                            <div className="md:hidden mt-2 pt-1">
                              <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 border border-slate-200 px-1.5 py-0.5">
                                共 {sheet._count.items} 款
                              </span>
                            </div>
                          </TableCell>

                          {/* 💻 桌面端专属：独立显示备注 */}
                          <TableCell className="text-slate-600 font-medium hidden md:table-cell align-middle">
                            {sheet.title || <span className="text-slate-400 font-normal">系统默认抓取</span>}
                          </TableCell>

                          {/* 💻 桌面端专属：独立显示条目数 */}
                          <TableCell className="font-mono font-bold text-slate-700 hidden md:table-cell align-middle">
                            {sheet._count.items}
                          </TableCell>

                          {/* 3. 操作列 */}
                          <TableCell className="text-right pr-3 md:pr-4 align-top md:align-middle py-3 md:py-4">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="rounded-none text-slate-400 opacity-100 md:opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-all ease-out h-8 px-2 md:px-3">
                                  {deletingId === sheet.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4" />}
                                  <span className="ml-1.5 font-bold hidden sm:inline">清除</span>
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent className="rounded-none border-slate-200 w-[90vw] max-w-md">
                                <AlertDialogHeader className="text-left">
                                  <AlertDialogTitle className="font-black text-lg">高危操作指令</AlertDialogTitle>
                                  <AlertDialogDescription className="text-slate-600 font-medium leading-relaxed mt-2 text-sm">
                                    即将抹除 <span className="font-bold text-slate-900 border-b border-slate-300 pb-0.5">{format(new Date(sheet.recordDate), 'yyyy-MM-dd')}</span> 的 
                                    <span className="font-bold text-slate-900 mx-1">{isExpress ? '快递' : '广货'}</span> 
                                    行情记录，共包含 <span className="font-bold text-red-600">{sheet._count.items}</span> 条核心数据。<br/>
                                    <span className="text-red-600 mt-2 block">此操作将造成永久性数据丢失，并连带影响大盘趋势图表，请再次确认。</span>
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter className="mt-5 flex-row justify-end gap-2 sm:gap-3">
                                  <AlertDialogCancel className="rounded-none font-bold border-slate-300 hover:bg-slate-100 transition-colors ease-out mt-0">驳回</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => handleDelete(sheet.id)}
                                    className="rounded-none bg-red-600 hover:bg-red-700 text-white font-bold transition-colors ease-out"
                                  >
                                    确认清除
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    
                    {data.length === 0 && !loading && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center py-20 text-slate-400">
                          <FileText className="w-8 h-8 mb-3 opacity-20 mx-auto" />
                          <p className="font-medium text-sm">系统存储库尚无记录</p>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}