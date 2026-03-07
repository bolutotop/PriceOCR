'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scanImageLocal, ParsedItem } from '@/actions/ocr';
import { savePriceSheet } from '@/actions/save-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, UploadCloud, X, Database, Search, Link as LinkIcon, RefreshCw, ChevronLeft, AlertTriangle, Cpu } from 'lucide-react';
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

  // 默认 OCR 引擎设为腾讯云 (tencent)
  const [ocrEngine, setOcrEngine] = useState('tencent');
  
  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (status === 'processing') {
      setProgress(0);
      interval = setInterval(() => {
        setProgress((prev) => {
          if (prev < 30) { setProgressText('正在读取结构数据...'); return prev + 10; }
          // 🚨 修改：更新进度条文案，展示底层正在使用的“水平顺序扫描”算法
          if (prev < 70) { setProgressText('执行水平顺序扫描配对...'); return prev + 5; }
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
    
    // 注入用户选择的 OCR 引擎参数，供后端识别
    formData.append('engine', ocrEngine);

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

  const updateItemName = (actualIndex: number, newName: string) => {
    const newItems = [...items];
    newItems[actualIndex].name = newName;
    setItems(newItems);
  };

  const handlePriceChange = (actualIndex: number, val: string) => {
    const newItems = [...items];
    newItems[actualIndex].price = val === '//' ? -1 : parseFloat(val) || 0;
    setItems(newItems);
  };
  
  const handleDelete = (actualIndex: number) => {
    setItems(items.filter((_, i) => i !== actualIndex));
  };

  const filteredItems = items.filter(i => i.name.includes(searchTerm));

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-slate-200/50 pb-20 font-sans">
      
      {/* 全局删除确认弹窗控制台 */}
      <Dialog open={itemToDelete !== null} onOpenChange={(open) => !open && setItemToDelete(null)}>
        <DialogContent className="sm:max-w-md rounded-none border-slate-200 shadow-[8px_8px_0_0_rgba(15,23,42,0.1)] w-[90vw] sm:w-full">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-800 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600 stroke-[2.5]" />
              移除数据确认
            </DialogTitle>
          </DialogHeader>
          <div className="py-4 text-sm text-slate-600 font-bold bg-slate-50 border border-slate-100 p-4">
            确定要从本次录入列表中移除该条数据吗？<br/>
            <span className="text-red-500 text-xs mt-1 block tracking-wider uppercase">警告: 移除后将无法通过撤销恢复该切片。</span>
          </div>
          <DialogFooter className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setItemToDelete(null)} className="rounded-none border-slate-200 font-bold shadow-none flex-1 sm:flex-none">
              取消操作
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                if (itemToDelete !== null) handleDelete(itemToDelete);
                setItemToDelete(null);
              }} 
              className="rounded-none font-bold shadow-none bg-red-600 hover:bg-red-700 flex-1 sm:flex-none"
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 顶部主导航 */}
      <div className="bg-white/95 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-3 sm:px-5 flex justify-between items-center shadow-sm h-[60px]">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="rounded-none -ml-2 text-slate-600 hover:bg-slate-100 transition-colors ease-out">
              <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
            </Button>
          </Link>
          <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">录入新单</h1>
          <p className="text-xs text-slate-500 font-medium hidden sm:block border-l border-slate-300 pl-3 uppercase tracking-widest">DATA IMPORT</p>
        </div>
        <div className="flex gap-2">
          {items.length > 0 && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="rounded-none bg-slate-800 hover:bg-slate-900 transition-all ease-out shadow-[2px_2px_0_0_rgba(15,23,42,0.1)] font-bold px-2 sm:px-3">
                  <Save className="w-4 h-4 sm:mr-1.5" /> <span className="hidden sm:inline">确认入库</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md rounded-none border-slate-200 shadow-[8px_8px_0_0_rgba(15,23,42,0.1)] w-[95vw] sm:w-full">
                <DialogHeader><DialogTitle className="font-black text-slate-800">入库参数配置</DialogTitle></DialogHeader>
                
                <div className="grid gap-5 py-4">
                  <div className="grid gap-2">
                    <Label className="text-slate-700 font-bold uppercase text-[10px] sm:text-xs tracking-wider">行情归属</Label>
                    <Select value={marketType} onValueChange={setMarketType}>
                      <SelectTrigger className="w-full h-11 border-slate-200 rounded-none focus:ring-0 focus:border-slate-800 transition-colors ease-out font-bold">
                        <SelectValue placeholder="选择行情" />
                      </SelectTrigger>
                      <SelectContent className="rounded-none border-slate-200">
                        <SelectItem value="EXPRESS" className="font-bold text-slate-700 focus:bg-slate-100">快递行情 (EXPRESS)</SelectItem>
                        <SelectItem value="GUANGHUO" className="font-bold text-slate-700 focus:bg-slate-100">广货行情 (GUANGHUO)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:gap-4">
                    <div className="grid gap-2">
                      <Label className="text-slate-700 font-bold uppercase text-[10px] sm:text-xs tracking-wider">业务日期</Label>
                      <Input type="date" className="h-11 rounded-none border-slate-200 focus-visible:ring-0 focus:border-slate-800 transition-colors ease-out font-mono font-bold text-xs sm:text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-slate-700 font-bold uppercase text-[10px] sm:text-xs tracking-wider">标识 / 备注</Label>
                      <Input placeholder="可留空" className="h-11 rounded-none border-slate-200 focus-visible:ring-0 focus:border-slate-800 transition-colors ease-out text-xs sm:text-sm" value={note} onChange={(e) => setNote(e.target.value)} />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button onClick={handleSave} disabled={saving} className="bg-slate-800 hover:bg-slate-900 w-full h-11 text-sm sm:text-base rounded-none shadow-none font-bold transition-colors ease-out">
                    {saving ? <Loader2 className="animate-spin w-5 h-5 mr-2"/> : null} 提交至数据库
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <div className="max-w-[1600px] mx-auto p-2 sm:p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-5">
        
        {/* 左侧控制区 */}
        <div className="lg:col-span-4 space-y-3 sm:space-y-5 lg:sticky lg:top-[84px] h-fit z-10">
          
          {/* 引擎选择面板 */}
          <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] p-4">
            <div className="flex items-center gap-2 mb-3">
              <Cpu className="w-4 h-4 text-slate-800 stroke-[2.5]" />
              <Label className="text-slate-800 font-black uppercase text-xs tracking-wider">解析引擎 (OCR Engine)</Label>
            </div>
            <Select value={ocrEngine} onValueChange={setOcrEngine} disabled={status === 'processing' || status === 'success'}>
              <SelectTrigger className="w-full h-10 border-slate-200 rounded-none focus:ring-0 focus:border-slate-800 transition-colors ease-out font-bold text-xs sm:text-sm bg-slate-50">
                <SelectValue placeholder="选择计算节点" />
              </SelectTrigger>
              <SelectContent className="rounded-none border-slate-200">
                {/* 🚨 修改：明确标识出腾讯云使用的是最新的水平顺序识别模式 */}
                <SelectItem value="tencent" className="font-bold text-slate-700 focus:bg-slate-100">
                  腾讯云 (Tencent Cloud) - 水平顺序模式
                </SelectItem>
                <SelectItem value="aliyun" className="font-bold text-slate-700 focus:bg-slate-100">
                  阿里云 (Aliyun Vision) - 备用节点
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className={cn("bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] transition-opacity ease-out duration-200 p-4 sm:p-5", status === 'processing' ? 'opacity-70 pointer-events-none' : '')}>
            <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
            
            {!file && !activeUrl ? (
              <div className="space-y-4 sm:space-y-5">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-slate-400 h-28 sm:h-40 flex flex-col items-center justify-center text-slate-500 transition-colors ease-out cursor-pointer group"
                >
                  <UploadCloud className="w-6 h-6 sm:w-8 sm:h-8 text-slate-400 group-hover:text-slate-600 mb-2 sm:mb-3 transition-colors ease-out stroke-[2]" />
                  <p className="text-xs sm:text-sm font-bold text-slate-600 uppercase tracking-widest">选取本地表格图像</p>
                </div>

                <div className="flex items-center gap-2 sm:gap-3">
                  <div className="h-px bg-slate-200 flex-1"></div>
                  <span className="text-[10px] sm:text-xs text-slate-400 font-bold tracking-widest uppercase">OR</span>
                  <div className="h-px bg-slate-200 flex-1"></div>
                </div>

                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="absolute left-2 sm:left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input 
                      placeholder="输入外部 URL" 
                      value={urlInput}
                      onChange={(e) => setUrlInput(e.target.value)}
                      className="pl-7 sm:pl-9 h-10 sm:h-11 bg-slate-50 rounded-none border-slate-200 focus-visible:ring-0 focus-visible:border-slate-800 transition-colors ease-out text-xs sm:text-sm"
                    />
                  </div>
                  <Button variant="secondary" className="h-10 sm:h-11 rounded-none font-bold border border-slate-200 shadow-none hover:bg-slate-200 transition-colors ease-out text-xs sm:text-sm px-3 sm:px-4" onClick={handleLoadUrl} disabled={!urlInput.trim()}>
                    获取
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4 sm:space-y-5">
                <div className="relative overflow-hidden bg-slate-100 border border-slate-200 group flex justify-center items-center min-h-[120px] sm:min-h-[160px]">
                  <img src={imagePreview!} className="max-h-[200px] sm:max-h-[300px] w-auto object-contain mix-blend-multiply" />
                  <div className="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity ease-out flex items-center justify-center">
                     <Button variant="secondary" size="sm" className="rounded-none bg-white font-bold hover:bg-slate-100 border-none" onClick={handleClearSelection}>
                       <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> 重置文件
                     </Button>
                  </div>
                </div>
                
                <Button 
                  className="w-full h-10 sm:h-11 text-sm sm:text-base font-bold shadow-none rounded-none bg-slate-800 hover:bg-slate-900 transition-colors ease-out tracking-widest" 
                  onClick={handleStartOcr}
                  disabled={status === 'processing' || status === 'success'}
                >
                  {status === 'processing' ? <Loader2 className="animate-spin mr-2 w-4 h-4 sm:w-5 sm:h-5"/> : null}
                  {status === 'success' ? '解析完毕' : status === 'processing' ? '云端节点处理中' : '执行解析程序'}
                </Button>
              </div>
            )}
          </div>

          {(status === 'processing' || status === 'success') && (
            <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] p-4 sm:p-5">
              <div className="flex justify-between text-xs sm:text-sm mb-2 font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  {status === 'processing' && <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-slate-600"/>}
                  {progressText}
                </span>
                <span className="text-slate-900 font-mono">{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5 sm:h-2 bg-slate-100 rounded-none border border-slate-200" indicatorClassName="bg-slate-800" />
            </div>
          )}
        </div>

        {/* 右侧数据核对区 */}
        <div className="lg:col-span-8 flex flex-col min-w-0">
          <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] w-full">
            
            {/* 搜索控制栏 */}
            <div className="py-2.5 sm:py-3 px-3 sm:px-4 border-b border-slate-200 bg-slate-50/80 flex flex-row gap-3 justify-between items-center z-20">
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <Database className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-800 stroke-[2.5]" /> 
                <h2 className="text-xs sm:text-sm font-black text-slate-800 tracking-tight uppercase hidden sm:block">数据核对控制台</h2>
                <h2 className="text-xs font-black text-slate-800 tracking-tight uppercase sm:hidden">核对</h2>
                <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 bg-slate-200 px-1.5 py-0.5 border border-slate-300">
                  {items.length} R
                </span>
              </div>
              
              <div className="relative flex-1 max-w-[180px] sm:max-w-56">
                <Search className="absolute left-2 sm:left-2.5 top-1.5 sm:top-2 h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400" />
                <Input 
                  placeholder="检索..." 
                  className="pl-7 sm:pl-9 h-7 sm:h-8 text-xs sm:text-sm bg-white border-slate-200 focus-visible:ring-0 focus-visible:border-slate-800 rounded-none shadow-none transition-colors ease-out font-bold text-slate-600 placeholder:font-normal" 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)} 
                />
              </div>
            </div>

            <div className="w-full bg-white">
              {items.length === 0 && status !== 'processing' && (
                <div className="flex flex-col items-center justify-center text-slate-400 select-none bg-slate-50/50 py-20 sm:py-32 border-b border-slate-100">
                  <div className="p-3 sm:p-4 border-2 border-dashed border-slate-200 mb-3 sm:mb-4 bg-white">
                    <Database className="w-6 h-6 sm:w-8 sm:h-8 opacity-20 stroke-[2]" />
                  </div>
                  <p className="text-[10px] sm:text-xs font-bold tracking-widest uppercase">等待源数据接入</p>
                </div>
              )}

              {items.length > 0 && (
                <table className="w-full table-fixed border-collapse">
                  <thead className="sticky top-[60px] z-30 bg-slate-100 shadow-sm border-b border-slate-200">
                    <tr>
                      <th className="w-[180px] sm:w-[300px] py-2 px-1 text-center font-bold text-slate-500 uppercase text-[10px] sm:text-xs border-r border-slate-200">切片</th>
                      <th className="w-auto py-2 px-2 sm:px-4 text-left font-bold text-slate-500 uppercase text-[10px] sm:text-xs">品名</th>
                      <th className="w-[70px] sm:w-[140px] py-2 px-1 sm:px-4 text-right font-bold text-slate-500 uppercase text-[10px] sm:text-xs">价格</th>
                      <th className="w-[36px] sm:w-[50px] py-2 border-l border-slate-200"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item, index) => {
                      const actualIndex = items.indexOf(item);
                      
                      return (
                        <tr key={actualIndex} className="group hover:bg-slate-50 transition-colors ease-out border-b border-slate-100">
                          
                          <td className="p-1 sm:p-2 align-middle border-r border-slate-100">
                            <div className="w-full h-11 sm:h-14 bg-slate-50 border border-slate-200 mx-auto flex items-center justify-center overflow-hidden">
                              {item.cropDataUri ? (
                                <img src={item.cropDataUri} alt="IMG" className="w-full h-full object-contain mix-blend-multiply grayscale contrast-125 p-0.5" />
                              ) : (
                                <span className="text-[8px] sm:text-[10px] text-slate-400 font-bold uppercase">NO IMG</span>
                              )}
                            </div>
                          </td>
                          
                          <td className="p-1 sm:p-3 align-middle">
                            <Input 
                              value={item.name || ''}
                              onChange={(e) => updateItemName(actualIndex, e.target.value)}
                              className="rounded-none border-transparent hover:border-slate-200 bg-transparent hover:bg-white focus-visible:bg-white focus-visible:ring-0 focus-visible:border-slate-800 font-black text-slate-800 text-[11px] sm:text-sm h-10 px-1 sm:px-3 transition-colors ease-out w-full shadow-none truncate"
                              placeholder="品名"
                            />
                          </td>
                          
                          <td className="p-1 sm:p-3 align-middle">
                            <Input 
                              type="text"
                              value={item.price === -1 ? '' : item.price}
                              onChange={(e) => handlePriceChange(actualIndex, e.target.value)}
                              className={`rounded-none border border-transparent hover:border-slate-200 focus-visible:border-slate-800 bg-transparent hover:bg-white focus-visible:bg-white focus-visible:ring-0 font-mono font-black text-slate-800 text-xs sm:text-sm h-10 w-full px-1 sm:px-2 text-center sm:text-right shadow-none transition-colors ease-out ${item.price > 1000 ? 'text-slate-800' : 'text-slate-600'} ${item.price === -1 ? 'text-slate-300' : ''}`}
                              placeholder="0.0"
                            />
                          </td>
                          
                          <td className="p-0 sm:p-2 align-middle text-center border-l border-slate-100">
                            <button 
                              onClick={() => setItemToDelete(actualIndex)}
                              className="p-2 sm:p-2.5 text-slate-300 hover:text-white hover:bg-red-600 hover:border-red-600 border border-transparent transition-all ease-out mx-auto flex items-center justify-center"
                            >
                              <X className="w-4 h-4 sm:w-5 sm:h-5 stroke-[2.5]" />
                            </button>
                          </td>
                          
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}