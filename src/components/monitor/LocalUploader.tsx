'use client';

import { useState } from 'react';
import { scanImageLocal } from '@/actions/ocr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2 } from 'lucide-react';

export default function LocalUploader() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string[]>([]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    
    // 调用刚才写的 Server Action
    const res = await scanImageLocal(formData);

    if (res.success && res.lines) {
      setResult(res.lines);
    } else {
      alert('识别失败: ' + res.error);
    }
    
    setLoading(false);
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* 左侧：上传区 */}
      <Card>
        <CardHeader>
          <CardTitle>本地 OCR 识别 (Tesseract.js)</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUpload} className="space-y-4">
            <Input type="file" name="file" accept="image/*" required />
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  识别中 (本地运算可能较慢)...
                </>
              ) : (
                '开始识别'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 右侧：结果展示区 */}
      <Card>
        <CardHeader>
          <CardTitle>识别结果 (原始行数据)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] overflow-auto bg-slate-950 text-slate-50 p-4 rounded-md text-xs font-mono">
            {result.length > 0 ? (
              result.map((line, index) => (
                <div key={index} className="border-b border-slate-800 py-1">
                  {line}
                </div>
              ))
            ) : (
              <p className="text-gray-500">等待上传...</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}