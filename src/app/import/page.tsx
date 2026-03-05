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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, UploadCloud, ImageIcon, X, AlertTriangle, Search, Link as LinkIcon, RefreshCw, ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';

export default function ImportPage() {
  const router = useRouter();
  
  const [file, setFile] = useState<File | null>(null);
  const [activeUrl, setActiveUrl] = useState<string | null>(null); 
  const [urlInput, setUrlInput] = useState(''); 
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const [items, setItems] = useState<ParsedItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState(''); 
  const [marketType, setMarketType] = useState('EXPRESS'); 
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'processing') {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 30) { setProgressText('正在读取结构数据...'); return prev + 10; }
          if (prev < 70) { setProgressText('云端结构解析中...'); return prev + 5; }
          if (prev < 90) { setProgressText('单元格提取与切片...'); return prev + 2; }
          return prev;
        });
      }, 200);
    } else if (status === 'success') {
      setProgress(100);
      setProgressText('结构解析完毕');
    }
    return () => clearInterval(interval);
  }, [status]);

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
      alert('请求错误，请检查服务状态');
      setStatus('error');
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await savePriceSheet(items, date, note, marketType);
      if (res.success) {
        setIsDialogOpen(false);
        if (confirm('数据录入成功！返回看盘页面？')) {
           router.push('/');
        } else {
           handleClearSelection();
        }
      } else {
        alert('录入拦截: ' + res.message);
      }
    } catch (e) {
      alert('录入异常');
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200/50 pb-20">
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-30 px-5 py-3 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-none -ml-2 text-slate-600 hover:bg-slate-100 transition-colors ease-out">
              <ChevronLeft className="w-5 h-5" />
            </Button>
          </Link>
          <h1 className="text-lg font-black text-slate-800 tracking-tight">录入新单</h1>
          <p className="text-xs text-slate-500 font-medium hidden sm:block border-l border-slate-300 pl-3">结构化解析与入库</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="rounded-none bg-slate-800 hover:bg-slate-900 transition-all ease-out shadow-none font-bold">
                  <Save className="w-4 h-4 mr-1.5" /> 确认入库
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-none border-slate-200">
                <DialogHeader><DialogTitle className="font-black">入库参数配置</DialogTitle></DialogHeader>
                
                <div className="grid gap-5 py-4">
                  <div className="grid gap-2">
                    <Label className="text-slate-700 font-bold">行情归属</Label>
                    <Select value={marketType} onValueChange={setMarketType}>
                      <SelectTrigger className="w-full h-11 border-slate-200 rounded-none focus:ring-0">
                        <SelectValue placeholder="选择行情" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none">
                        <SelectItem value="EXPRESS" className="font-bold text-slate-700 focus:bg-slate-100">快递行情 (EXPRESS)</SelectItem>
                        <SelectItem value="GUANGHUO" className="font-bold text-slate-700 focus:bg-slate-100">广货行情 (GUANGHUO)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label className="text-slate-700 font-bold">业务日期</Label>
                      <Input type="date" className="h-10 rounded-none border-slate-200 focus-visible:ring-0" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-700 font-bold">标识 / 备注</Label>
                      <Input placeholder="可留空" className="h-10 rounded-none border-slate-200 focus-visible:ring-0" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={handleSave} disabled={saving} className="bg-slate-800 hover:bg-slate-900 w-full h-11 text-base rounded-none shadow-none font-bold transition-colors ease-out">
                    {saving ? <Loader2 className="animate-spin w-5 h-5 mr-2"/> : null} 提交至数据库
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-5">
        
        {/* 左侧控制区 */}
        <div className="lg:col-span-4 space-y-5">
          <Card className={cn("rounded-none border-slate-200 shadow-sm bg-white transition-opacity ease-out duration-200", status === 'processing' ? 'opacity-70 pointer-events-none' : '')}>
            <CardContent className="p-5">
              <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
              
              {!file && !activeUrl ? (
                <div className="space-y-5">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 h-40 flex flex-col items-center justify-center text-slate-500 transition-colors ease-out cursor-pointer group"
                  >
                    <UploadCloud className="w-8 h-8 text-slate-400 group-hover:text-slate-600 mb-3 transition-colors ease-out" />
                    <p className="text-sm font-bold text-slate-600">选取本地表格图像</p>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-px bg-slate-200 flex-1"></div>
                    <span className="text-xs text-slate-400 font-bold tracking-widest uppercase">or</span>
                    <div className="h-px bg-slate-200 flex-1"></div>
                  </div>

                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <LinkIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <Input 
                        placeholder="输入外部 URL 链接" 
                        value={urlInput}
                        onChange={(e) => setUrlInput(e.target.value)}
                        className="pl-9 bg-slate-50 rounded-none border-slate-200 focus-visible:ring-0 focus-visible:border-slate-400"
                      />
                    </div>
                    <Button variant="secondary" className="rounded-none font-bold border border-slate-200 shadow-none hover:bg-slate-200 transition-colors ease-out" onClick={handleLoadUrl} disabled={!urlInput.trim()}>
                      获取
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-5">
                  <div className="relative overflow-hidden bg-slate-100 border border-slate-200 group flex justify-center items-center">
                    <img src={imagePreview!} className="max-h-[300px] w-auto object-contain" />
                    <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity ease-out flex items-center justify-center">
                       <Button variant="secondary" size="sm" className="rounded-none bg-white font-bold hover:bg-slate-100" onClick={handleClearSelection}>
                         <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 重置文件
                       </Button>
                    </div>
                  </div>
                  
                  <Button 
                    className="w-full h-11 text-base font-bold shadow-none rounded-none bg-slate-800 hover:bg-slate-900 transition-colors ease-out" 
                    onClick={handleStartOcr}
                    disabled={status === 'processing' || status === 'success'}
                  >
                    {status === 'processing' ? <Loader2 className="animate-spin mr-2"/> : null}
                    {status === 'success' ? '解析完毕' : status === 'processing' ? '云端节点处理中' : '执行解析程序'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {(status === 'processing' || status === 'success') && (
            <Card className="rounded-none border-slate-200 bg-white shadow-sm">
              <CardContent className="p-5">
                <div className="flex justify-between text-sm mb-2 font-bold text-slate-700">
                  <span className="flex items-center gap-2">
                    {status === 'processing' && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600"/>}
                    {progressText}
                  </span>
                  <span className="text-slate-900">{progress}%</span>
                </div>
                <Progress value={progress} className="h-1.5 bg-slate-100 rounded-none" indicatorClassName="bg-slate-800" />
              </CardContent>
            </Card>
          )}
        </div>

        {/* 右侧数据核对区 */}
        <div className="lg:col-span-8 flex flex-col h-[calc(100vh-140px)]">
          <Card className="rounded-none flex-1 flex flex-col border-slate-200 shadow-sm overflow-hidden bg-white">
            <div className="py-3 px-4 border-b border-slate-100 bg-white flex flex-row justify-between items-center shrink-0 z-20">
              <div className="text-base flex items-center gap-2 font-black text-slate-800 tracking-tight">
                数据核对区
                {items.length > 0 && <span className="bg-slate-100 text-slate-600 px-2 py-0.5 font-bold text-xs border border-slate-200">{items.length} ITEM</span>}
              </div>
              <div className="relative w-40 md:w-56">
                <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
                <Input 
                  placeholder="检索单元格..." 
                  className="pl-9 h-8 text-sm bg-slate-50 border-slate-200 focus-visible:ring-0 rounded-none shadow-inner" 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                />
              </div>
            </div>

            <div className="flex-1 overflow-auto relative scrollbar-hide bg-white">
              {items.length === 0 && status !== 'processing' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 select-none">
                  <div className="p-5 border border-slate-100 bg-slate-50 mb-4 rounded-none">
                    <UploadCloud className="w-10 h-10 opacity-20" />
                  </div>
                  <p className="text-sm font-bold tracking-wide">等待执行解析程序</p>
                </div>
              )}

              {items.length > 0 && (
                <Table>
                  <TableHeader className="sticky top-0 z-30 bg-slate-50 border-b border-slate-200 shadow-sm">
                    <TableRow className="h-12 hover:bg-slate-50 border-none">
                      <TableHead className="pl-4 md:pl-6 w-auto font-bold text-slate-700">图像切片</TableHead>
                      <TableHead className="pl-2 md:pl-4">
                        <span className="font-bold text-slate-700">键 (名称)</span>
                      </TableHead>
                      <TableHead className="w-[100px] md:w-[140px] text-right pr-4 md:pr-6 font-bold text-slate-700">值 (价格)</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item, idx) => (
                      <TableRow key={idx} className="group text-sm hover:bg-slate-50 transition-colors ease-out border-b border-slate-100">
                        <TableCell className="py-3 pl-4 md:pl-6 align-middle">
                          {item.cropDataUri ? (
                            <div className="h-10 md:h-12 w-auto inline-block border border-slate-200 bg-slate-50">
                               <img src={item.cropDataUri} className="h-full w-auto object-contain" />
                            </div>
                          ) : <ImageIcon className="w-5 h-5 text-slate-300"/>}
                        </TableCell>
                        <TableCell className="py-3 pl-2 md:pl-4 align-middle">
                          <input 
                            value={item.name} 
                            onChange={(e) => {
                              const newI = [...items]; newI[idx].name = e.target.value; setItems(newI);
                            }}
                            className="font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-slate-400 focus:outline-none w-full transition-colors ease-out py-1 text-base truncate" 
                          />
                        </TableCell>
                        <TableCell className="py-3 text-right pr-4 md:pr-6 align-middle">
                          <input 
                             value={item.price === -1 ? "//" : item.price}
                             onChange={(e) => handlePriceChange(idx, e.target.value)}
                             className={`text-right w-full bg-transparent border-b border-transparent focus:border-slate-400 focus:outline-none font-mono text-lg font-black py-1 ${item.price > 1000 ? 'text-slate-800' : 'text-slate-600'} ${item.price === -1 ? 'text-slate-300' : ''}`}
                          />
                        </TableCell>
                        <TableCell className="py-3 align-middle text-right px-0 md:pr-4">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="rounded-none h-8 w-8 text-slate-300 lg:opacity-0 group-hover:opacity-100 hover:text-red-600 hover:bg-red-50 transition-colors ease-out" 
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