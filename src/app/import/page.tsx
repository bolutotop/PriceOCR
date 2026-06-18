'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { scanImageLocal, ParsedItem } from '@/actions/ocr';
import { scanScreenshot } from '@/actions/ocr-screenshot';
import { savePriceSheet } from '@/actions/save-sheet';
import { getLatestPrices } from '@/actions/get-latest-prices';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save, UploadCloud, X, Database, Search, Link as LinkIcon, RefreshCw, ChevronLeft, AlertTriangle, Cpu } from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';


// --- 🛠️ 新增：Debug 模式专用的极限测试数据 ---
const DEBUG_MOCK_DATA: ParsedItem[] = [
  { originalName: "湖南中烟芙蓉王(硬)", name: "芙蓉王(硬)", price: 240, confidence: "1.0", isCorrected: true, _left: 10, _top: 100 },
  { originalName: "中华(软)", name: "中华(软)", price: 650, confidence: "1.0", isCorrected: false, _left: 10, _top: 150 },
  { originalName: "测试超长名字能否完全换行显示合经典软经典短金01喜", name: "测试超长名字能否完全换行显示合经典软经典短金01喜", price: 150, confidence: "0.9", isCorrected: false, _left: 10, _top: 200 },
  { originalName: "【未匹配数字】", name: "【未匹配数字】", price: 888, confidence: "1.0", isCorrected: false, _left: 10, _top: 250 },
  { originalName: "天天向上草莓(断货版)", name: "天天向上草莓(断货版)", price: -1, confidence: "1.0", isCorrected: false, _left: 10, _top: 300 },
  { originalName: "柔情", name: "柔情", price: 530, confidence: "1.0", isCorrected: false, _left: 10, _top: 350 },
];
// ---------------------------------------------


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
  // 价格列表头的"只看未识别"勾选；勾选后仅展示 price === -1 的行
  const [onlyUnrecognized, setOnlyUnrecognized] = useState(false);
  // 上一次录入价格（按品名归一化），用于校对当前 OCR 价格是否异常
  // null 表示已查过但无历史；undefined 表示尚未查询
  const [lastPriceMap, setLastPriceMap] = useState<Record<string, number | null>>({});
  // 触发警告的差距阈值（绝对值）
  const PRICE_DIFF_ALERT_THRESHOLD = 20;

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [note, setNote] = useState('');
  const [marketType, setMarketType] = useState('EXPRESS');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // 追踪当前激活的解析模式：'photo' | 'screenshot' | null
  const [activeMode, setActiveMode] = useState<'photo' | 'screenshot' | null>(null);

  // 默认 OCR 引擎设为腾讯云 (tencent)
  const [ocrEngine, setOcrEngine] = useState('tencent');

  const [itemToDelete, setItemToDelete] = useState<number | null>(null);

  // 🛠️ 衍生状态：当引擎选择为 debug 时，开启调试模式
  const isDebugMode = ocrEngine === 'debug';


  // --- 🚨 新增：列宽控制状态与记忆逻辑 ---
  // --- 🚨 新增：PC / 移动端 双轨记忆列宽控制 ---
  const [isMobileView, setIsMobileView] = useState(false);
  const [cropWidth, setCropWidth] = useState<number | undefined>(undefined);
  const [priceWidth, setPriceWidth] = useState<number | undefined>(undefined);
  const isLoaded = useRef(false);

  // 1. 初始化与屏幕监听：区分设备读取对应的记忆
  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 640;
      setIsMobileView(mobile);

      // 核心：动态生成对应的 localStorage Key
      const cropKey = mobile ? 'ocr_crop_width_mobile' : 'ocr_crop_width_pc';
      const priceKey = mobile ? 'ocr_price_width_mobile' : 'ocr_price_width_pc';

      const savedCrop = localStorage.getItem(cropKey);
      const savedPrice = localStorage.getItem(priceKey);

      // 如果没有记忆，分别赋予各自的完美初始值
      setCropWidth(savedCrop ? Number(savedCrop) : (mobile ? 70 : 240));
      setPriceWidth(savedPrice ? Number(savedPrice) : (mobile ? 85 : 140));
    };

    handleResize(); // 首次执行
    window.addEventListener('resize', handleResize); // 监听屏幕旋转或缩放
    isLoaded.current = true;

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // 2. 宽度变化时：存入对应设备的 Key 中，互不干扰
  useEffect(() => {
    if (isLoaded.current && cropWidth !== undefined) {
      const cropKey = isMobileView ? 'ocr_crop_width_mobile' : 'ocr_crop_width_pc';
      localStorage.setItem(cropKey, cropWidth.toString());
    }
  }, [cropWidth, isMobileView]);

  useEffect(() => {
    if (isLoaded.current && priceWidth !== undefined) {
      const priceKey = isMobileView ? 'ocr_price_width_mobile' : 'ocr_price_width_pc';
      localStorage.setItem(priceKey, priceWidth.toString());
    }
  }, [priceWidth, isMobileView]);

  // 3. 拖拽核心逻辑（兼容 PC 鼠标与移动端触摸）
  const startResize = (e: React.MouseEvent | React.TouchEvent, col: 'crop' | 'price') => {
    // 仅在非触摸设备上阻止默认行为，避免触摸设备报 passive warning
    if (!('touches' in e)) {
      e.preventDefault();
    }

    // 动态获取起始 X 坐标（区分触摸点和鼠标点）
    const startX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const startWidth = col === 'crop' ? cropWidth! : priceWidth!;

    const onMove = (moveEvent: MouseEvent | TouchEvent) => {
      // 动态获取移动中的 X 坐标
      const currentX = 'touches' in moveEvent ? moveEvent.touches[0].clientX : (moveEvent as MouseEvent).clientX;
      const deltaX = currentX - startX;

      if (col === 'crop') {
        const minW = isMobileView ? 40 : 100;
        setCropWidth(Math.max(minW, startWidth + deltaX));
      } else {
        const minW = isMobileView ? 60 : 100;
        setPriceWidth(Math.max(minW, startWidth - deltaX));
      }
    };

    const onUp = () => {
      // 释放所有的鼠标和触摸监听
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
    };

    // 同时注册鼠标和触摸的移动、抬起事件
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    // passive: false 确保在拖拽列宽时，页面不会跟着意外滑动
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };
  // ----------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null);

  // marketType 切换时，如果当前已经有解析结果，重新查上次价格作为对比
  useEffect(() => {
    if (items.length === 0) return;
    fetchLastPricesFor(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketType]);

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
    setActiveMode(null);
    setItems([]);
    setLastPriceMap({});
  };

  // 抽出"OCR 完成 -> 拉取该批品名上次价格"逻辑，两个入口共用
  const fetchLastPricesFor = async (parsed: ParsedItem[]) => {
    try {
      const names = Array.from(new Set(parsed.map((p) => p.name).filter(Boolean)));
      if (names.length === 0) {
        setLastPriceMap({});
        return;
      }
      const map = await getLatestPrices(
        names,
        marketType === 'GUANGHUO' ? 'GUANGHUO' : 'EXPRESS'
      );
      setLastPriceMap(map);
    } catch (e) {
      console.warn('[import] 获取上次价格失败：', e);
      setLastPriceMap({});
    }
  };

  const handleStartOcr = async () => {
    // Debug 模式下，允许不上传图片直接空跑
    if (!file && !activeUrl && !isDebugMode) return;
    setActiveMode('photo');
    setStatus('processing');

    // 🛠️ 拦截：如果是 Debug 虚拟引擎，执行模拟流
    if (isDebugMode) {
      console.log("🛠️ [DEBUG MODE] 拦截 OCR 请求，生成本地测试数据...");
      setProgress(10);

      // 模拟云端处理延迟 (1.5秒)
      await new Promise(resolve => setTimeout(resolve, 1500));

      setItems(JSON.parse(JSON.stringify(DEBUG_MOCK_DATA)));
      setStatus('success');
      return;
    }

    const formData = new FormData();
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
        fetchLastPricesFor(res.parsedData);
      } else {
        alert('解析失败: ' + res.error);
        setStatus('error');
      }
    } catch (err) {
      alert('请求错误，请检查服务状态');
      setStatus('error');
    }
  };

  const handleStartScreenshotOcr = async () => {
    if (!file && !activeUrl) return;
    setActiveMode('screenshot');
    setStatus('processing');

    const formData = new FormData();
    if (file) {
      formData.append('file', file);
    } else if (activeUrl) {
      formData.append('imageUrl', activeUrl);
    }

    try {
      const res = await scanScreenshot(formData);
      if (res.success && res.parsedData) {
        setItems(res.parsedData);
        setStatus('success');
        fetchLastPricesFor(res.parsedData);
      } else {
        alert('截图解析失败: ' + res.error);
        setStatus('error');
      }
    } catch (err) {
      alert('截图解析请求错误，请检查服务状态');
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

  // 提交价格变更（由 PriceInput 子组件失焦/回车时调用）
  const handlePriceCommit = (actualIndex: number, draft: string) => {
    const newItems = [...items];
    let numVal: number;
    if (draft === '' || draft === '//' || draft === '/') {
      numVal = -1;
    } else {
      const n = parseFloat(draft);
      numVal = Number.isFinite(n) ? n : 0;
    }
    newItems[actualIndex].price = numVal;
    setItems(newItems);
  };

  const handleDelete = (actualIndex: number) => {
    setItems(items.filter((_, i) => i !== actualIndex));
  };

  // 1) 检索过滤；2) 若勾选"只看未识别"，再过滤 price === -1，并把未识别置顶；
  // 3) 未勾选时完全保持原顺序（即 items 原始顺序），不做置顶。
  // 注意：这里不改动 items 本身，渲染时通过 items.indexOf(item) 找回真实索引，
  // 避免影响后续的 updateItemName / handlePriceChange / handleDelete 传入的 actualIndex。
  const unrecognizedCount = items.filter((i) => i.price === -1).length;
  let filteredItems = items
    .filter((i) => i.name.includes(searchTerm))
    .filter((i) => (onlyUnrecognized ? i.price === -1 : true));
  if (onlyUnrecognized) {
    // JS 的 sort 是稳定的，未识别之外的其它顺序保持不变
    filteredItems = filteredItems.slice().sort((a, b) => {
      const aMiss = a.price === -1 ? 0 : 1;
      const bMiss = b.price === -1 ? 0 : 1;
      return aMiss - bMiss;
    });
  }

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
            确定要从本次录入列表中移除该条数据吗？<br />
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
                    {saving ? <Loader2 className="animate-spin w-5 h-5 mr-2" /> : null} 提交至数据库
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
                <SelectItem value="tencent" className="font-bold text-slate-700 focus:bg-slate-100">
                  腾讯云 (Tencent Cloud) - 水平顺序模式
                </SelectItem>
                <SelectItem value="aliyun" className="font-bold text-slate-700 focus:bg-slate-100">
                  阿里云 (Aliyun Vision) - 备用节点
                </SelectItem>
                {/* 🚨 新增：把 Debug 模式作为一种虚拟的本地引擎 */}
                <SelectItem value="debug" className="font-bold text-amber-700 focus:bg-amber-50">
                  🛠️ 本地调试模式 (Debug Mock)
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

                <div className="flex gap-2">
                  <Button
                    className={cn(
                      "flex-1 h-10 sm:h-11 text-sm sm:text-base font-bold shadow-none rounded-none transition-colors ease-out tracking-widest",
                      activeMode === 'screenshot' && (status === 'processing' || status === 'success')
                        ? 'bg-slate-400 hover:bg-slate-400'
                        : 'bg-slate-800 hover:bg-slate-900'
                    )}
                    onClick={handleStartOcr}
                    disabled={status === 'processing' || status === 'success'}
                  >
                    {activeMode === 'photo' && status === 'processing' ? <Loader2 className="animate-spin mr-2 w-4 h-4 sm:w-5 sm:h-5" /> : null}
                    {activeMode === 'photo' && status === 'success' ? '解析完毕' : activeMode === 'photo' && status === 'processing' ? '处理中' : '解析拍照'}
                  </Button>
                  <Button
                    className={cn(
                      "flex-1 h-10 sm:h-11 text-sm sm:text-base font-bold shadow-none rounded-none transition-colors ease-out tracking-widest",
                      activeMode === 'photo' && (status === 'processing' || status === 'success')
                        ? 'bg-slate-400 hover:bg-slate-400'
                        : 'bg-slate-600 hover:bg-slate-700'
                    )}
                    onClick={handleStartScreenshotOcr}
                    disabled={status === 'processing' || status === 'success'}
                  >
                    {activeMode === 'screenshot' && status === 'processing' ? <Loader2 className="animate-spin mr-2 w-4 h-4 sm:w-5 sm:h-5" /> : null}
                    {activeMode === 'screenshot' && status === 'success' ? '解析完毕' : activeMode === 'screenshot' && status === 'processing' ? '处理中' : '解析截图'}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {(status === 'processing' || status === 'success') && (
            <div className="bg-white border border-slate-200 shadow-[4px_4px_0_0_rgba(15,23,42,0.1)] p-4 sm:p-5">
              <div className="flex justify-between text-xs sm:text-sm mb-2 font-bold text-slate-700">
                <span className="flex items-center gap-2">
                  {status === 'processing' && <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin text-slate-600" />}
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

              {/* 行情归属快速切换：决定"上次价格"按哪条时间线对比，同时也是入库时的归属 */}
              <div
                className="flex items-center border border-slate-300 bg-white shadow-sm overflow-hidden"
                title="切换后会按该行情重新比对上次价格"
              >
                <button
                  type="button"
                  onClick={() => setMarketType('EXPRESS')}
                  className={cn(
                    "px-2 sm:px-2.5 h-7 sm:h-8 text-[10px] sm:text-xs font-black tracking-tight transition-colors",
                    marketType === 'EXPRESS'
                      ? 'bg-slate-800 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-100'
                  )}
                >
                  快递
                </button>
                <button
                  type="button"
                  onClick={() => setMarketType('GUANGHUO')}
                  className={cn(
                    "px-2 sm:px-2.5 h-7 sm:h-8 text-[10px] sm:text-xs font-black tracking-tight transition-colors border-l border-slate-300",
                    marketType === 'GUANGHUO'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-500 hover:bg-slate-100'
                  )}
                >
                  广货
                </button>
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
                      {/* 🚨 修改：切片列增加 style 控制，并挂载右侧拖拽手柄 */}
                      {/* 🚨 修改：切片列增加 style 控制，并挂载右侧拖拽手柄 */}
                      <th
                        style={{ width: cropWidth ? `${cropWidth}px` : 'auto' }}
                        className="relative py-2 px-1 text-center font-bold text-slate-500 uppercase text-[10px] sm:text-xs border-r border-slate-200"
                      >
                        切片
                        {/* 拖拽触发区 - 增加了 onTouchStart 并放大了热区 */}
                        <div
                          onMouseDown={(e) => startResize(e, 'crop')}
                          onTouchStart={(e) => startResize(e, 'crop')}
                          className="absolute -right-2 top-0 bottom-0 w-4 cursor-col-resize hover:bg-slate-800/20 z-10 touch-none"
                        />
                      </th>

                      <th className="w-auto py-2 px-1 sm:px-4 text-left font-bold text-slate-500 uppercase text-[10px] sm:text-xs">品名</th>

                      {/* 🚨 修改：价格列增加 style 控制，并挂载左侧拖拽手柄 */}
                      <th
                        style={{ width: priceWidth ? `${priceWidth}px` : 'auto' }}
                        className="relative py-2 px-1 sm:px-4 text-right font-bold text-slate-500 uppercase text-[10px] sm:text-xs"
                      >
                        {/* 拖拽触发区 - 增加了 onTouchStart 并放大了热区 */}
                        <div
                          onMouseDown={(e) => startResize(e, 'price')}
                          onTouchStart={(e) => startResize(e, 'price')}
                          className="absolute -left-2 top-0 bottom-0 w-4 cursor-col-resize hover:bg-slate-800/20 z-10 touch-none"
                        />
                        <div className="flex items-center justify-end gap-1 sm:gap-2">
                          <label
                            className={cn(
                              'flex items-center gap-1 cursor-pointer select-none border px-1 sm:px-1.5 py-[2px] transition-colors ease-out relative z-20',
                              onlyUnrecognized
                                ? 'border-red-400 bg-red-50 text-red-600'
                                : 'border-slate-300 bg-white text-slate-500 hover:border-slate-400'
                            )}
                            title={unrecognizedCount > 0 ? `共 ${unrecognizedCount} 条未识别` : '暂无未识别条目'}
                          >
                            <input
                              type="checkbox"
                              checked={onlyUnrecognized}
                              onChange={(e) => setOnlyUnrecognized(e.target.checked)}
                              disabled={unrecognizedCount === 0 && !onlyUnrecognized}
                              className="w-3 h-3 sm:w-3.5 sm:h-3.5 accent-red-600 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <span className="text-[9px] sm:text-[10px] font-black tracking-wider normal-case">
                              <span className="sm:hidden">空</span>
                              <span className="hidden sm:inline">未识别</span>
                            </span>
                            {unrecognizedCount > 0 && (
                              <span
                                className={cn(
                                  'font-mono font-black text-[9px] sm:text-[10px] px-0.5 sm:px-1',
                                  onlyUnrecognized
                                    ? 'bg-red-600 text-white'
                                    : 'bg-slate-200 text-slate-600'
                                )}
                              >
                                {unrecognizedCount}
                              </span>
                            )}
                          </label>
                          <span className="hidden sm:inline">价格</span>
                        </div>
                      </th>

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
                            <div className="relative flex items-center gap-1">
                              <Input
                                value={item.name || ''}
                                onChange={(e) => updateItemName(actualIndex, e.target.value)}
                                className="rounded-none border-transparent hover:border-slate-200 bg-transparent hover:bg-white focus-visible:bg-white focus-visible:ring-0 focus-visible:border-slate-800 font-black text-slate-800 text-[11px] sm:text-sm h-10 px-1 sm:px-3 transition-colors ease-out w-full shadow-none truncate"
                                placeholder="品名"
                              />
                              {item.isCorrected && item.originalName && item.originalName !== item.name && (
                                <span
                                  title={`OCR 原文：${item.originalName}，已按字典自动纠正为：${item.name}`}
                                  className="shrink-0 text-[8px] sm:text-[9px] font-black uppercase tracking-widest px-1 py-[2px] bg-amber-100 text-amber-700 border border-amber-300 cursor-help"
                                >
                                  纠错
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="p-1 sm:p-3 align-middle">
                            {(() => {
                              const cleanName = (item.name || '').replace(/\s+/g, '').trim();
                              const lastPrice = cleanName ? lastPriceMap[cleanName] : undefined;
                              const hasLast = typeof lastPrice === 'number';
                              const diff = hasLast && item.price > 0 ? item.price - (lastPrice as number) : 0;
                              const isAlert = hasLast && item.price > 0 && Math.abs(diff) > PRICE_DIFF_ALERT_THRESHOLD;
                              return (
                                <div className="relative">
                                  <PriceInput
                                    price={item.price}
                                    onCommit={(v) => handlePriceCommit(actualIndex, v)}
                                    className={cn(
                                      "rounded-none border focus-visible:border-slate-800 bg-transparent hover:bg-white focus-visible:bg-white focus-visible:ring-0 font-mono font-black text-xs sm:text-sm h-10 w-full px-1 sm:px-2 text-center sm:text-right shadow-none transition-colors ease-out outline-none",
                                      item.price === -1
                                        ? 'border-red-400 bg-red-50/60 text-red-500 placeholder:text-red-400 placeholder:font-bold'
                                        : isAlert
                                          ? 'border-red-500 bg-red-50 text-red-600 ring-1 ring-red-300'
                                          : 'border-transparent hover:border-slate-200 text-slate-800',
                                      !isAlert && item.price > 1000 ? 'text-slate-800' : ''
                                    )}
                                    placeholder={item.price === -1 ? '未识别 ?' : '0.0'}
                                  />
                                  {item.price === -1 && (
                                    <span
                                      title="OCR 未配到价格，请核对原图"
                                      className="pointer-events-none absolute left-0.5 sm:left-1 top-1/2 -translate-y-1/2 text-[8px] sm:text-[9px] font-black uppercase tracking-widest px-1 py-[1px] bg-red-600 text-white"
                                    >
                                      !
                                    </span>
                                  )}
                                  {item.price !== -1 && isAlert && (
                                    <span
                                      title={`与上次价格 ${lastPrice} 相差 ${diff > 0 ? '+' : ''}${diff.toFixed(diff % 1 === 0 ? 0 : 1)}，请核对！`}
                                      className="pointer-events-none absolute -bottom-1.5 right-0.5 sm:right-1 text-[8px] sm:text-[9px] font-black tracking-tight px-1 py-[1px] bg-red-600 text-white border border-red-700 rounded-sm shadow-sm"
                                    >
                                      上次{lastPrice}·{diff > 0 ? '+' : ''}{diff.toFixed(diff % 1 === 0 ? 0 : 1)}
                                    </span>
                                  )}
                                  {item.price !== -1 && hasLast && !isAlert && (
                                    <span
                                      title={`上次价格：${lastPrice}`}
                                      className="pointer-events-none absolute -bottom-1.5 right-0.5 sm:right-1 text-[8px] sm:text-[9px] font-bold text-slate-400"
                                    >
                                      上次{lastPrice}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
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

// =============================================================================
// PriceInput：独立的价格输入子组件
//
// 为什么独立？因为父组件每次输入都会触发整个 items 表格 re-render，
// 受控 input 在 re-render 时如果 value 来自 React state（被 parseFloat 截断过），
// 就会出现「输入 58. 立刻变 58」「中间插小数点吞后面位」「最后一位输不进」等怪现象。
//
// 这里：
//   - 输入态完全交给 input 自己（用 ref 取值），不在 onChange 中 setState
//   - 仅在 mount 时把 props.price 写进 input.value 作为初始显示
//   - 当 props.price 从外部变化（例如 OCR 重新识别）时，刷新一次 input.value
//   - 失焦或 Enter 时调用 onCommit 把字符串结果交给父组件去 parseFloat 入库
// =============================================================================
function PriceInput({
  price,
  onCommit,
  className,
  placeholder,
}: {
  price: number; // -1 表示未识别
  onCommit: (raw: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // 记录最近一次外部传入的 price，用于检测"外部变更 vs 用户自己 commit 引起的变更"
  const lastSyncedRef = useRef<number>(price);

  // 当 props.price 从外部变更（且当前 input 没在被用户编辑）时，同步进 input
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (lastSyncedRef.current === price) return; // 没变化，跳过
    // 只有在 input 没获得焦点时才覆盖（避免打字途中被外部覆盖光标）
    if (document.activeElement !== el) {
      el.value = price === -1 ? '' : String(price);
      lastSyncedRef.current = price;
    }
  }, [price]);

  // 首次挂载：把初始值写进 input
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.value = price === -1 ? '' : String(price);
    lastSyncedRef.current = price;
    // 只在 mount 时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = () => {
    const el = ref.current;
    if (!el) return;
    // 过滤掉非法字符（防止粘贴乱字符）；保留数字、点、负号、斜杠
    const cleaned = el.value.replace(/[^0-9.\-/]/g, '');
    if (cleaned !== el.value) el.value = cleaned;
    onCommit(cleaned);
    lastSyncedRef.current = cleaned === '' || cleaned === '//' || cleaned === '/'
      ? -1
      : (Number.isFinite(parseFloat(cleaned)) ? parseFloat(cleaned) : 0);
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      defaultValue={price === -1 ? '' : String(price)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
      className={className}
      placeholder={placeholder}
    />
  );
}