'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, MessageSquare, Send, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createIssue } from '@/actions/issues';

const REPORTER_KEY = 'priceocr_issue_reporter';

function getOrCreateReporter(): string {
  if (typeof window === 'undefined') return '';
  let v = localStorage.getItem(REPORTER_KEY);
  if (!v) {
    v = 'u_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem(REPORTER_KEY, v);
  }
  return v;
}

/**
 * 浮动「问题反馈」按钮：右下角圆角胶囊。
 * 点击弹出 Dialog，里面可输入文字 + 上传 1~5 张图片。
 * 提交成功后重置表单并自动关闭，可选地跳转到 /issues。
 */
export default function FeedbackFab() {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 同步生成预览图（blob URL）
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [files]);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files ? Array.from(e.target.files) : [];
    if (list.length === 0) return;
    const merged = [...files, ...list].slice(0, 5);
    const oversize = list.find((f) => f.size > 5 * 1024 * 1024);
    if (oversize) {
      setErrorMsg(`图片 ${oversize.name} 超过 5MB`);
      return;
    }
    setErrorMsg(null);
    setFiles(merged);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const reset = () => {
    setDescription('');
    setFiles([]);
    setErrorMsg(null);
  };

  const handleSubmit = async () => {
    if (!description.trim()) {
      setErrorMsg('请先描述一下问题');
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const fd = new FormData();
      fd.append('description', description.trim());
      fd.append('reporter', getOrCreateReporter());
      for (const f of files) fd.append('images', f);
      const res = await createIssue(fd);
      if (res.success) {
        reset();
        setOpen(false);
        // 跳转到看板让用户立即看到刚提交的问题
        if (typeof window !== 'undefined') window.location.href = '/issues';
      } else {
        setErrorMsg(res.error || '提交失败');
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '提交异常');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'fixed z-[60] bottom-20 right-4 lg:bottom-6 lg:right-6 group',
          'flex items-center gap-1.5 px-3 py-2.5 rounded-full',
          'bg-slate-900 text-white shadow-[0_8px_24px_-8px_rgba(15,23,42,0.6)]',
          'hover:bg-slate-800 transition-all',
          'border border-slate-700'
        )}
        title="提交问题反馈"
      >
        <MessageSquare className="w-4 h-4" strokeWidth={2.5} />
        <span className="text-xs font-black tracking-wider hidden sm:inline">反馈</span>
      </button>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent className="sm:max-w-md w-[95vw] rounded-md border-slate-200 shadow-xl">
          <DialogHeader>
            <DialogTitle className="font-black text-slate-800 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-blue-600" />
              提交问题反馈
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">问题描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="请尽量详细地描述：在哪个页面、做了什么操作、看到什么、期望什么"
              className="w-full min-h-[120px] border border-slate-200 rounded-md p-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 resize-y"
              maxLength={2000}
            />

            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">截图（最多 5 张，单张 ≤ 5MB）</label>
              <span className="text-[10px] font-mono font-bold text-slate-400">{files.length}/5</span>
            </div>

            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {previews.map((url, idx) => (
                  <div key={idx} className="relative group border border-slate-200 rounded-md overflow-hidden bg-slate-50 aspect-square">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`截图${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 p-0.5 bg-slate-900/80 hover:bg-red-600 text-white rounded transition-colors"
                      title="移除"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {files.length < 5 && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={onPickFiles}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-20 border-2 border-dashed border-slate-300 hover:border-blue-400 hover:bg-blue-50/50 rounded-md flex flex-col items-center justify-center text-slate-500 hover:text-blue-600 transition-colors"
                >
                  <Upload className="w-5 h-5 mb-1" />
                  <span className="text-xs font-bold">点击添加截图</span>
                </button>
              </div>
            )}

            {errorMsg && (
              <div className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {errorMsg}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setOpen(false); reset(); }}
              disabled={submitting}
              className="font-bold"
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              {submitting ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

