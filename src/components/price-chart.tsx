'use client';

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { format } from 'date-fns';

type ChartData = {
  date: string;
  displayDate: Date;
  price: number;
  sheetTitle: string | null;
};

export function PriceChart({ data }: { data: ChartData[] }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center bg-slate-50 rounded-lg border border-dashed text-slate-400">
        暂无价格历史数据
      </div>
    );
  }

  // 计算Y轴范围，让曲线看起来波动更明显，而不是缩成一条直线
  const prices = data.map(d => d.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const domainMin = Math.floor(minPrice * 0.95); // Y轴下限留一点空隙
  const domainMax = Math.ceil(maxPrice * 1.05);  // Y轴上限留一点空隙

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis 
            dataKey="date" 
            tickFormatter={(str) => format(new Date(str), 'MM-dd')}
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
            dy={10}
          />
          <YAxis 
            domain={[domainMin, domainMax]} 
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelFormatter={(label) => format(new Date(label), 'yyyy年MM月dd日')}
          />
          <Line 
            type="monotone" 
            dataKey="price" 
            stroke="#2563eb" 
            strokeWidth={3} 
            dot={{ r: 4, fill: '#2563eb', strokeWidth: 2, stroke: '#fff' }}
            activeDot={{ r: 6 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}