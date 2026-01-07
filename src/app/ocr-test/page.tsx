'use client';

import { useState, useMemo } from 'react';
import { scanImageLocal, ParsedItem } from '@/actions/ocr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, UploadCloud, AlertTriangle, Search, X, ImageIcon } from 'lucide-react';

export default function OcrTestPage() {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState({ total: 0, corrected: 0 });

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setItems([]);
    setStats({ total: 0, corrected: 0 });

    const formData = new FormData(e.currentTarget);
    const file = formData.get('file') as File;
    if (file) {
      setImagePreview(URL.createObjectURL(file));
    }

    try {
      const res = await scanImageLocal(formData);
      if (res.success && res.parsedData) {
        setItems(res.parsedData);
        setStats({
          total: res.parsedData.length,
          corrected: res.parsedData.filter(i => i.isCorrected).length,
        });
      } else {
        alert('识别失败: ' + res.error);
      }
    } catch (err) {
      alert('请求发生错误');
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    return items.filter(item => 
      item.name.includes(searchTerm) || item.originalName.includes(searchTerm)
    );
  }, [items, searchTerm]);

  // 修改价格的处理逻辑
  const handlePriceChange = (index: number, value: string) => {
    const newItems = [...items];
    let numVal = -1;
    
    // 如果用户输入 // 或者 /，存为 -1
    if (value === '//' || value === '/') {
      numVal = -1;
    } else {
      // 否则尝试解析数字，如果解析失败(比如删空了)设为0
      numVal = parseFloat(value);
      if (isNaN(numVal)) numVal = 0;
    }

    newItems[index] = { ...newItems[index], price: numVal };
    setItems(newItems);
  };

  const handleNameChange = (index: number, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], name: value };
    setItems(newItems);
  };

  const handleDelete = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">OCR 智能校对台</h1>
            <p className="text-sm text-slate-500">智能分栏排序 + 支持识别"//" + 高精截图</p>
          </div>
          {items.length > 0 && (
            <div className="flex gap-3">
              <Badge variant="outline" className="px-3 py-1 bg-white text-slate-600">
                总数: <span className="font-bold ml-1">{stats.total}</span>
              </Badge>
              <Badge variant="outline" className="px-3 py-1 bg-white text-yellow-600">
                已纠错: <span className="font-bold ml-1">{stats.corrected}</span>
              </Badge>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-180px)]">
          {/* 左侧：原图预览 */}
          <div className="lg:col-span-4 flex flex-col gap-4 h-full">
            <Card className="flex-shrink-0">
              <CardContent className="pt-6">
                <form onSubmit={handleUpload} className="flex gap-2">
                  <Input type="file" name="file" accept="image/*" required className="bg-white text-sm" />
                  <Button type="submit" disabled={loading} size="sm">
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : '开始识别'}
                  </Button>
                </form>
              </CardContent>
            </Card>
            <Card className="flex-1 overflow-hidden bg-slate-100 border-2 border-dashed relative">
              {imagePreview ? (
                <div className="w-full h-full overflow-auto p-2">
                  <img src={imagePreview} alt="Original" className="max-w-none w-full object-contain shadow-sm" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400">
                  <UploadCloud className="w-12 h-12 mb-2 opacity-50" />
                  <p className="text-sm">上传图片以预览</p>
                </div>
              )}
            </Card>
          </div>

          {/* 右侧：校对表格 */}
          <Card className="lg:col-span-8 flex flex-col h-full overflow-hidden bg-white">
            <CardHeader className="py-3 px-4 border-b flex flex-row justify-between items-center space-y-0">
              <CardTitle className="text-base m-0">识别结果明细</CardTitle>
              {items.length > 0 && (
                <div className="relative w-64">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-slate-400" />
                  <Input 
                    placeholder="搜索品名..." 
                    className="pl-8 h-9 text-sm bg-slate-50 border-slate-200"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              )}
            </CardHeader>
            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-slate-50/80 backdrop-blur z-10">
                  <TableRow className="text-xs hover:bg-transparent">
                    <TableHead className="w-[50px]">序号</TableHead>
                    <TableHead className="w-[180px]">参考截图</TableHead>
                    <TableHead>品名 (可编辑)</TableHead>
                    <TableHead className="w-[100px] text-right">价格</TableHead>
                    <TableHead className="w-[90px] text-center">状态</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                     <TableRow>
                       <TableCell colSpan={6} className="h-32 text-center">
                         <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary mb-2" />
                         <span className="text-xs text-slate-500">正在生成高精度切片...</span>
                       </TableCell>
                     </TableRow>
                  ) : filteredItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-sm text-slate-400">
                        暂无数据
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredItems.map((item, index) => (
                      <TableRow key={index} className="hover:bg-slate-50/50 text-sm group">
                        <TableCell className="text-xs text-slate-400 font-mono">{index + 1}</TableCell>
                        
                        <TableCell className="py-1">
                          {item.cropDataUri ? (
                            <div className="h-10 flex items-center justify-start group/img relative">
                              <img 
                                src={item.cropDataUri} 
                                alt="Crop" 
                                className="h-full w-auto object-contain border border-slate-200 rounded-sm bg-white p-[1px] transition-transform origin-left hover:scale-[2.5] hover:z-50 hover:shadow-lg"
                              />
                            </div>
                          ) : (
                            <div className="h-10 flex items-center text-slate-300">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </TableCell>

                        <TableCell>
                          <div className="flex flex-col justify-center h-full py-0.5">
                            {item.isCorrected && (
                              <div className="text-[10px] text-yellow-600/80 flex items-center gap-0.5 mb-0.5">
                                <AlertTriangle className="w-2.5 h-2.5" />
                                原: {item.originalName}
                              </div>
                            )}
                            <input 
                              value={item.name} 
                              onChange={(e) => handleNameChange(index, e.target.value)}
                              className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-primary focus:outline-none px-0 py-0 font-medium text-slate-700 w-full leading-tight"
                            />
                          </div>
                        </TableCell>

                        <TableCell className="text-right font-mono">
                          {/* 价格输入框：将 -1 显示为 // */}
                          <input 
                            type="text" // 改为 text 类型以支持输入 //
                            value={item.price === -1 ? "//" : item.price}
                            onChange={(e) => handlePriceChange(index, e.target.value)}
                            className={`bg-transparent text-right border-b border-transparent hover:border-slate-300 focus:border-primary focus:outline-none px-0 py-0 w-24 leading-tight ${
                              item.price === -1 ? 'text-slate-400 font-bold' :
                              item.price > 2000 ? 'text-red-600 font-bold' : ''
                            }`}
                          />
                        </TableCell>

                        <TableCell className="text-center">
                          {item.isCorrected ? (
                            <Badge variant="secondary" className="bg-yellow-50 text-yellow-700 hover:bg-yellow-100 font-normal text-[10px] px-1.5 py-0 leading-4">
                              已纠错
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-slate-400">原始</span>
                          )}
                        </TableCell>
                        
                        <TableCell>
                          <Button
                            variant="ghost" size="icon"
                            className="h-6 w-6 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                            onClick={() => handleDelete(index)}
                          >
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}