import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { listIssues } from '@/actions/issues';
import IssueBoardClient from './board-client';

export const dynamic = 'force-dynamic';

export default async function IssueBoardPage() {
  const issues = await listIssues();
  const open = issues.filter((i) => i.status === 'OPEN');
  const resolved = issues.filter((i) => i.status === 'RESOLVED');

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      <header className="bg-white/95 backdrop-blur-md border-b border-slate-200/60 sticky top-0 z-40 px-3 sm:px-5 flex items-center h-[60px] shadow-sm">
        <Link href="/">
          <button className="rounded-none -ml-2 p-2 text-slate-600 hover:bg-slate-100">
            <ChevronLeft className="w-5 h-5 stroke-[2.5]" />
          </button>
        </Link>
        <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight ml-1">问题看板</h1>
        <p className="hidden sm:block ml-3 text-xs text-slate-500 font-medium border-l border-slate-300 pl-3 uppercase tracking-widest">
          ISSUE TRACKER
        </p>
      </header>

      <div className="max-w-5xl mx-auto p-3 sm:p-6">
        <IssueBoardClient initialOpen={open} initialResolved={resolved} />
      </div>
    </div>
  );
}
