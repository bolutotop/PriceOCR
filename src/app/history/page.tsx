'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getUploadHistory, deletePriceSheet } from '@/actions/history';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, 
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger 
} from '@/components/ui/alert-dialog';
import { Trash2, Calendar, Clock, FileText, Loader2, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

// 定义数据类型
type HistoryItem = {
  id: string;
  title: string | null;
  recordDate: Date;
  createdAt: Date;
  _count: { items: number };
};

export default function HistoryPage() {
  const [data, setData] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 加载数据
  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const res = await getUploadHistory();
    // Prisma 返回的 Date 是对象，但在 Client 组件里有时需要序列化，不过这里直接用即可
    setData(res as any); 
    setLoading(false);
  }

  // 处理删除
  async function handleDelete(id: string) {
    setDeletingId(id);
    const res = await deletePriceSheet(id);
    if (res.success) {
      // 从前端列表移除，不必重新请求后端
      setData(prev => prev.filter(item => item.id !== id));
    } else {
      alert('删除失败');
    }
    setDeletingId(null);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* 顶部导航 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Link href="/">
              <Button variant="ghost" size="icon"><ChevronLeft /></Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">数据管理</h1>
              <p className="text-sm text-slate-500">查看上传历史，删除错误数据</p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>上传记录列表</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex justify-center py-8"><Loader2 className="animate-spin text-slate-400" /></div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>行情日期 (Day)</TableHead>
                    <TableHead>上传时间 (Time)</TableHead>
                    <TableHead>备注/标题</TableHead>
                    <TableHead className="text-center">包含条目</TableHead>
                    <TableHead className="text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.map((sheet) => (
                    <TableRow key={sheet.id}>
                      {/* 1. 行情日期：这是这批价格所属的日期 */}
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-slate-400" />
                          {format(new Date(sheet.recordDate), 'yyyy-MM-dd')}
                        </div>
                      </TableCell>

                      {/* 2. 上传时间：这是你实际点击上传操作的时间点 */}
                      <TableCell className="text-slate-500 text-sm">
                        <div className="flex items-center gap-2">
                          <Clock className="w-3 h-3" />
                          {format(new Date(sheet.createdAt), 'HH:mm:ss')}
                        </div>
                      </TableCell>

                      <TableCell>
                        {sheet.title || <span className="text-slate-300 italic">无备注</span>}
                      </TableCell>

                      <TableCell className="text-center">
                        <Badge variant="secondary">{sheet._count.items} 条</Badge>
                      </TableCell>

                      <TableCell className="text-right">
                        {/* 删除确认弹窗 */}
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="sm" className="text-slate-400 hover:text-red-600 hover:bg-red-50">
                              {deletingId === sheet.id ? <Loader2 className="w-4 h-4 animate-spin"/> : <Trash2 className="w-4 h-4" />}
                              <span className="ml-1 hidden sm:inline">删除</span>
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>确定要删除这条记录吗？</AlertDialogTitle>
                              <AlertDialogDescription>
                                删除后，<span className="font-bold text-red-600">{format(new Date(sheet.recordDate), 'yyyy-MM-dd')}</span> 
                                的这 <span className="font-bold">{sheet._count.items}</span> 条价格数据将永久消失。
                                <br/>这会影响到价格走势图。
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>取消</AlertDialogCancel>
                              <AlertDialogAction 
                                onClick={() => handleDelete(sheet.id)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                确认删除
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </TableCell>
                    </TableRow>
                  ))}
                  {data.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-slate-400">暂无上传记录</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}