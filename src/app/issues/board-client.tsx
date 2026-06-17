'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, CheckCircle2, RotateCcw, Wrench, Image as ImageIcon, Calendar, User, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { confirmIssueDone, reopenIssue, resolveIssue, type IssueDTO } from '@/actions/issues';

type Props = {
  initialOpen: IssueDTO[];
  initialResolved: IssueDTO[];
};

export default function IssueBoardClient({ initialOpen, initialResolved }: Props) {
  const [openList, setOpenList] = useState<IssueDTO[]>(initialOpen);
  const [resolvedList, setResolvedList] = useState<IssueDTO[]>(initialResolved);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resolutionDraft, setResolutionDraft] = useState<Record<string, string>>({});

  // 移动端 tab：'open' | 'resolved'
  const [activeTab, setActiveTab] = useState<'open' | 'resolved'>('open');

  const handleResolve = async (id: string) => {
    const note = (resolutionDraft[id] || '').trim();
    setBusyId(id);
    const res = await resolveIssue(id, note);
    setBusyId(null);
    if (!res.success) { alert('标记失败：' + res.error); return; }
    setOpenList((prev) => prev.filter((i) => i.id !== id));
    const moved = openList.find((i) => i.id === id);
    if (moved) {
      setResolvedList((prev) => [
        { ...moved, status: 'RESOLVED', resolution: note || null, resolvedAt: new Date().toISOString() },
        ...prev,
      ]);
    }
  };

  const handleReopen = async (id: string) => {
    setBusyId(id);
    const res = await reopenIssue(id);
    setBusyId(null);
    if (!res.success) { alert('重开失败：' + res.error); return; }
    const moved = resolvedList.find((i) => i.id === id);
    setResolvedList((prev) => prev.filter((i) => i.id !== id));
    if (moved) {
      setOpenList((prev) => [{ ...moved, status: 'OPEN', resolvedAt: null }, ...prev]);
    }
  };

  const handleConfirm = async (id: string) => {
    if (!confirm('确认这个问题已经修复完成吗？\n确认后该问题及上传的所有截图将被永久删除。')) return;
    setBusyId(id);
    const res = await confirmIssueDone(id);
    setBusyId(null);
    if (!res.success) { alert('删除失败：' + res.error); return; }
    setResolvedList((prev) => prev.filter((i) => i.id !== id));
  };

  const total = openList.length + resolvedList.length;

  return (
    <div className="space-y-4">
      {/* 顶部统计 */}
      <div className="flex items-center gap-3">
        <div className="bg-white border border-slate-200 rounded-md px-3 py-2 shadow-sm">
          <div className="text-[10px] uppercase tracking-widest font-bold text-slate-400">总数</div>
          <div className="text-xl font-black text-slate-800">{total}</div>
        </div>
        <div className="bg-white border border-amber-200 rounded-md px-3 py-2 shadow-sm">
          <div className="text-[10px] uppercase tracking-widest font-bold text-amber-500">待修复</div>
          <div className="text-xl font-black text-amber-700">{openList.length}</div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-md px-3 py-2 shadow-sm">
          <div className="text-[10px] uppercase tracking-widest font-bold text-emerald-500">已修复</div>
          <div className="text-xl font-black text-emerald-700">{resolvedList.length}</div>
        </div>
      </div>

      {/* 移动端 tab */}
      <div className="md:hidden flex p-1 bg-slate-200/60 rounded-lg">
        <button
          onClick={() => setActiveTab('open')}
          className={cn(
            'flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5',
            activeTab === 'open' ? 'bg-white text-amber-700 shadow-sm' : 'text-slate-500',
          )}
        >
          待修复 <span className="text-[10px] px-1.5 py-0.5 rounded-full font-black bg-amber-100 text-amber-700">{openList.length}</span>
        </button>
        <button
          onClick={() => setActiveTab('resolved')}
          className={cn(
            'flex-1 py-2 text-sm font-bold rounded-md transition-all flex items-center justify-center gap-1.5',
            activeTab === 'resolved' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500',
          )}
        >
          已修复 <span className="text-[10px] px-1.5 py-0.5 rounded-full font-black bg-emerald-100 text-emerald-700">{resolvedList.length}</span>
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* 待修复列 */}
        <section className={cn('space-y-3', activeTab === 'open' ? '' : 'hidden md:block')}>
          <div className="flex items-center justify-between border-b border-amber-200 pb-2">
            <h2 className="font-black text-amber-700 uppercase tracking-widest text-sm">待修复</h2>
            <span className="text-xs font-bold text-amber-500">{openList.length}</span>
          </div>
          {openList.length === 0 ? (
            <EmptyHint text="暂无待修复问题" />
          ) : (
            openList.map((it) => (
              <IssueCard
                key={it.id}
                issue={it}
                busy={busyId === it.id}
                resolutionDraft={resolutionDraft[it.id] || ''}
                onResolutionChange={(v) => setResolutionDraft((prev) => ({ ...prev, [it.id]: v }))}
                onResolve={() => handleResolve(it.id)}
              />
            ))
          )}
        </section>

        {/* 已修复列 */}
        <section className={cn('space-y-3', activeTab === 'resolved' ? '' : 'hidden md:block')}>
          <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
            <h2 className="font-black text-emerald-700 uppercase tracking-widest text-sm">已修复</h2>
            <span className="text-xs font-bold text-emerald-500">{resolvedList.length}</span>
          </div>
          {resolvedList.length === 0 ? (
            <EmptyHint text="暂无已修复问题" />
          ) : (
            resolvedList.map((it) => (
              <IssueCard
                key={it.id}
                issue={it}
                busy={busyId === it.id}
                onReopen={() => handleReopen(it.id)}
                onConfirm={() => handleConfirm(it.id)}
              />
            ))
          )}
        </section>
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="border-2 border-dashed border-slate-200 bg-white rounded-md p-8 text-center text-slate-400 text-xs font-bold tracking-widest uppercase">
      {text}
    </div>
  );
}

function IssueCard({
  issue,
  busy,
  resolutionDraft,
  onResolutionChange,
  onResolve,
  onReopen,
  onConfirm,
}: {
  issue: IssueDTO;
  busy: boolean;
  resolutionDraft?: string;
  onResolutionChange?: (v: string) => void;
  onResolve?: () => void;
  onReopen?: () => void;
  onConfirm?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = issue.status === 'OPEN';
  const created = new Date(issue.createdAt).toLocaleString('zh-CN', { hour12: false });
  const resolvedAt = issue.resolvedAt ? new Date(issue.resolvedAt).toLocaleString('zh-CN', { hour12: false }) : '';

  return (
    <article className={cn(
      'bg-white border rounded-md shadow-sm overflow-hidden',
      isOpen ? 'border-amber-200' : 'border-emerald-200'
    )}>
      <header className={cn(
        'px-3 py-2 flex items-center gap-2 text-xs',
        isOpen ? 'bg-amber-50/70' : 'bg-emerald-50/70'
      )}>
        <span className={cn(
          'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black tracking-widest uppercase',
          isOpen ? 'bg-amber-600 text-white' : 'bg-emerald-600 text-white'
        )}>
          {isOpen ? 'OPEN' : 'FIXED'}
        </span>
        <span className="font-mono text-[10px] text-slate-400">#{issue.id.slice(-6)}</span>
        <span className="ml-auto flex items-center gap-1 text-slate-500">
          <Calendar className="w-3 h-3" /> {created}
        </span>
      </header>

      <div className="p-3 space-y-3">
        <p className="text-sm text-slate-800 whitespace-pre-wrap font-medium leading-relaxed break-words">
          {issue.description}
        </p>

        {issue.reporter && (
          <div className="text-[10px] text-slate-400 flex items-center gap-1">
            <User className="w-3 h-3" /> reporter: {issue.reporter}
          </div>
        )}

        {issue.images.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800"
            >
              <ImageIcon className="w-3.5 h-3.5" />
              截图 {issue.images.length} 张
              {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {expanded && (
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {issue.images.map((url, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block border border-slate-200 rounded overflow-hidden bg-slate-50 hover:border-blue-400"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`截图${idx + 1}`} className="w-full h-24 object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}

        {!isOpen && issue.resolution && (
          <div className="bg-emerald-50/70 border border-emerald-200 rounded p-2 text-xs text-emerald-800">
            <div className="font-black uppercase tracking-widest text-[10px] text-emerald-600 mb-1">修复说明</div>
            <p className="whitespace-pre-wrap">{issue.resolution}</p>
            {resolvedAt && <div className="text-[10px] text-emerald-500 mt-1.5">修复时间：{resolvedAt}</div>}
          </div>
        )}
      </div>

      {/* 操作区 */}
      <footer className={cn(
        'border-t px-3 py-2 flex flex-col sm:flex-row sm:items-center gap-2',
        isOpen ? 'border-amber-100 bg-amber-50/30' : 'border-emerald-100 bg-emerald-50/30'
      )}>
        {isOpen ? (
          <>
            <Input
              value={resolutionDraft}
              onChange={(e) => onResolutionChange?.(e.target.value)}
              placeholder="可选：填写修复说明"
              className="h-8 text-xs flex-1"
            />
            <Button
              size="sm"
              onClick={onResolve}
              disabled={busy}
              className="h-8 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Wrench className="w-3.5 h-3.5 mr-1" />}
              标记已修复
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={onReopen}
              disabled={busy}
              className="h-8 text-xs font-bold"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <RotateCcw className="w-3.5 h-3.5 mr-1" />}
              还有问题
            </Button>
            <Button
              size="sm"
              onClick={onConfirm}
              disabled={busy}
              className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs ml-auto"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              确认完成 (清理)
            </Button>
          </>
        )}
      </footer>
    </article>
  );
}
