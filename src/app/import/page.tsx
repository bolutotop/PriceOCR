'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scanImageLocal, ParsedItem } from '@/actions/ocr';
import { savePriceSheet } from '@/actions/save-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Loader2, Save, UploadCloud, ImageIcon, X, AlertTriangle, Search, Link as LinkIcon, RefreshCw, TableProperties } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function ImportPage() {
  const router = useRouter();
  
  // --- 状态管理 ---
  const [file, setFile] = useState<File | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null); 
  const [urlInput, setUrlInput] = useState(''); 
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const [items, setItems] = useState<ParsedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // 保存相关
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- 拟真进度条逻辑 (匹配新的表格识别工作流) ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'processing') {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 30) { setProgressText('正在上传并预处理图像...'); return prev + 10; }
          if (prev < 70) { setProgressText('阿里云 AI 表格结构解析中...'); return prev + 5; }
          if (prev < 90) { setProgressText('提取单元格数据与切片截图...'); return prev + 2; }
          return prev;
        });
      }, 200);
    } else if (status === 'success') {
      setProgress(100);
      setProgressText('表格解析完成！');
    }
    return () => clearInterval(interval);
  }, [status]);

  // --- 事件处理 ---
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setActiveUrl(null); 
      setImagePreview(URL.createObjectURL(selectedFile));
      setStatus('idle');
      setItems([]);
    }
  };

  const handleLoadUrl = () => {
    if (!urlInput.trim()) return;
    setFile(null); 
    setActiveUrl(urlInput.trim());
    setImagePreview(urlInput.trim());
    setStatus('idle');
    setItems([]);
  };

  const handleClearSelection = () => {
    setFile(null);
    setActiveUrl(null);
    setImagePreview(null);
    setUrlInput('');
    setStatus('idle');
    setItems([]);
  };

  const handleStartOcr = async () => {
    if (!file && !activeUrl) return;
    setStatus('processing');
    
    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    } else if (activeUrl) {
      formData.append('imageUrl', activeUrl);
    }

    try {
      const res = await scanImageLocal(formData);
      if (res.success && res.parsedData) {
        setItems(res.parsedData);
        setStatus('success');
      } else {
        alert('解析失败: ' + res.error);
        setStatus('error');
      }
    } catch (err) {
      alert('请求错误，请检查网络或控制台日志');
      setStatus('error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await savePriceSheet(items, date, note);
      if (res.success) {
        setIsDialogOpen(false);
        if (confirm('保存成功！是否查看历史记录？')) {
           router.push('/history');
        } else {
           handleClearSelection();
        }
      } else {
        alert('保存失败: ' + res.message);
      }
    } catch (e) {
      alert('保存异常');
    } finally {
      setSaving(false);
    }
  };

  const handlePriceChange = (index: number, val: string) => {
    const newItems = [...items];
    newItems[index].price = val === '//' ? -1 : parseFloat(val) || 0;
    setItems(newItems);
  };
  
  const handleDelete = (index: number) => setItems(items.filter((_, i) => i !== index));

  const filteredItems = items.filter(i => i.name.includes(searchTerm));

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* 顶部栏 */}
      <div className="bg-white border-b sticky top-0 z-30 px-4 md:px-6 py-3 flex justify-between items-center shadow-sm">
        <div>
          <h1 className="text-lg font-bold text-slate-800">导入报价单</h1>
          <p className="text-xs text-slate-500 hidden sm:block">AI 表格解析 &rarr; 智能矫正 &rarr; 确认保存</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="bg-blue-600 hover:bg-blue-700 transition-all shadow-sm font-medium">
                  <Save className="w-4 h-4 mr-1" /> 保存数据
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>保存当前报价</DialogTitle></DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>报价日期</Label>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label>备注</Label>
                    <Input placeholder="例如：晚班交接" value={note} onChange={(e) => setNote(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
                    {saving ? <Loader2 className="animate-spin w-4 h-4 mr-2"/> : null} 确认入库
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto p-2 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        
        {/* 左侧：操作区 */}
        <div className="lg:col-span-4 space-y-4">
          <Card className={cn("transition-all duration-300 border-slate-200 shadow-sm", status === 'processing' ? 'opacity-80 pointer-events-none' : '')}>
            <CardContent className="p-4">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              
              {!file && !activeUrl ? (
                <div className="space-y-4">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 rounded-xl h-40 flex flex-col items-center justify-center text-slate-500 bg-slate-50/50 hover:bg-slate-100 hover:border-blue-400 transition cursor-pointer gap-3 group"
                  >
                    <div className="p-3 bg-white rounded-full shadow-sm group-hover:scale-110 transition-transform group-hover:text-blue-600">
                      <UploadCloud className="w-8 h-8 text-blue-500" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-slate-700">点击选择本地表格图片</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-px bg-slate-200 flex-1"></div>
                    <span className="text-xs text-slate-400 font-medium">或通过链接导入</span>
                    <div className="h-px bg-slate-200 flex-1"></div>
                  </div>

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                      <Input 
                        placeholder="输入图片公网 URL..." 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        className="pl-9 bg-slate-50"
                      />
                    </div>
                    <Button variant="secondary" onClick={handleLoadUrl} disabled={!urlInput.trim()}>
                      加载
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="relative rounded-xl overflow-hidden bg-slate-100 border border-slate-200 group flex justify-center items-center">
                    <img src={imagePreview!} className="max-h-[300px] w-auto object-contain" />
                    
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                       <Button variant="secondary" size="sm" className="bg-white/90 shadow-sm backdrop-blur-sm hover:bg-white" onClick={handleClearSelection}>
                         <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 重新选择图片
                       </Button>
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full h-11 text-base font-bold shadow-md bg-blue-600 hover:bg-blue-700 transition-all" 
                    onClick={handleStartOcr}
                    disabled={status === 'processing' || status === 'success'}
                  >
                    {status === 'processing' ? <Loader2 className="animate-spin mr-2"/> : <TableProperties className="w-5 h-5 mr-2"/>}
                    {status === 'success' ? '解析成功' : status === 'processing' ? '云端表格解析中...' : '开始智能提取'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 进度状态 */}
          {(status === 'processing' || status === 'success') && (
            <Card className="animate-in fade-in slide-in-from-top-2 duration-300 border-blue-100 bg-blue-50/80 shadow-sm">
              <CardContent className="p-4">
                <div className="flex justify-between text-sm mb-2 font-medium text-slate-700">
                  <span className="flex items-center gap-2">
                    {status === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600"/>}
                    {progressText}
                  </span>
                  <span className="font-bold text-blue-700">{progress}%</span>
                </div>
                <Progress value={progress} className="h-2 bg-blue-200/50" indicatorClassName="bg-blue-600" />
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧：结果列表 */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-140px)]">
          <Card className="flex-1 flex flex-col border-slate-200 shadow-sm overflow-hidden bg-white">
            <div className="py-3 px-3 md:px-4 border-b bg-white flex flex-row justify-between items-center shrink-0 z-20">
              <div className="text-base flex items-center gap-2 font-bold text-slate-800">
                解析明细 
                {items.length > 0 && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-bold">{items.length}</span>}
              </div>
              <div className="relative w-36 md:w-56">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="搜索品名..." 
                  className="pl-9 h-9 text-sm bg-slate-50 border-slate-100 focus:bg-white focus:border-blue-300 transition-colors rounded-full" 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto relative scrollbar-hide bg-white">
              {items.length === 0 && status !== 'processing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 select-none">
                  <div className="p-5 bg-slate-50 rounded-full mb-4">
                    <TableProperties className="w-12 h-12 opacity-40" />
                  </div>
                  <p className="text-sm font-medium">请在左侧上传带有表格的图片</p>
                </div>
              )}

              {items.length > 0 && (
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-white shadow-md border-b border-slate-200">
                    <TableRow className="h-14 hover:bg-white border-none">
                      <TableHead className="pl-3 md:pl-6 w-auto font-bold text-slate-800">原图切片</TableHead>
                      <TableHead className="pl-2 md:pl-4">
                        <span className="font-bold text-slate-800 text-sm md:text-base">品名</span>
                        <span className="text-xs font-normal text-slate-400 ml-1 scale-90 inline-block">(点击可改)</span>
                      </TableHead>
                      <TableHead className="w-[90px] md:w-[120px] text-right pr-3 md:pr-6 font-bold text-slate-800">价格</TableHead>
                      <TableHead className="w-[40px] md:w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item, idx) => (
                      <TableRow key={idx} className="group text-sm hover:bg-blue-50/30 transition-colors border-b border-slate-100">
                        <TableCell className="py-4 pl-3 md:pl-6 align-middle">
                          {item.cropDataUri ? (
                            <div className="h-10 md:h-14 w-auto inline-block rounded overflow-hidden border border-slate-200 bg-slate-50">
                               <img src={item.cropDataUri} className="h-full w-auto object-contain" />
                            </div>
                          ) : <ImageIcon className="w-5 h-5 text-slate-200"/>}
                        </TableCell>
                        <TableCell className="py-4 pl-2 md:pl-4 align-middle">
                          <div className="flex flex-col gap-1 justify-center">
                            <input 
                              value={item.name} 
                              onChange={(e) => {
                                const newI = [...items]; newI[idx].name = e.target.value; setItems(newI);
                              }}
                              className="font-bold text-slate-800 bg-transparent border-b-2 border-transparent focus:border-blue-500 focus:outline-none w-full transition-all py-1 text-base truncate" 
                            />
                            {item.isCorrected && (
                              <span className="text-xs text-amber-600 flex items-center gap-1 bg-amber-50 w-fit px-1.5 py-0.5 rounded-sm">
                                <AlertTriangle className="w-3 h-3 shrink-0"/> 原: {item.originalName}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-4 text-right pr-3 md:pr-6 align-middle">
                          <input 
                             value={item.price === -1 ? "//" : item.price}
                             onChange={(e) => handlePriceChange(idx, e.target.value)}
                             className={`text-right w-full bg-transparent border-b-2 border-transparent focus:border-blue-500 focus:outline-none font-mono text-lg font-extrabold py-1 ${item.price > 1000 ? 'text-red-500' : 'text-slate-800'} ${item.price === -1 ? 'text-slate-400 font-bold' : ''}`}
                          />
                        </TableCell>
                        <TableCell className="py-4 align-middle text-right px-0 md:pr-2">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-slate-300 lg:opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50" 
                            onClick={() => handleDelete(idx)}
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}