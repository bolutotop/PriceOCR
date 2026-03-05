'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend
} from 'recharts';

export function PriceChart({ data }: { data: any[] }) {
  // 找出最大值和最小值，用于让折线图的上下留出一点空间，不要贴边
  const allPrices = data.flatMap(d => [d.expressPrice, d.guanghuoPrice]).filter(p => p !== undefined && p !== null);
  const minPrice = allPrices.length > 0 ? Math.min(...allPrices) * 0.95 : 0;
  
  return (
    <div className="h-[300px] w-full mt-4">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis 
            dataKey="date" 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: '#64748b' }} 
            dy={10}
          />
          <YAxis 
            domain={[minPrice, 'auto']} 
            axisLine={false} 
            tickLine={false} 
            tick={{ fontSize: 12, fill: '#64748b' }}
            tickFormatter={(val) => `¥${val}`}
          />
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
            labelStyle={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '8px' }}
            formatter={(value: number, name: string) => {
              if (name === 'expressPrice') return [`¥${value}`, '🚀 快递价'];
              if (name === 'guanghuoPrice') return [`¥${value}`, '📦 广货价'];
              return [value, name];
            }}
          />
          <Legend wrapperStyle={{ paddingTop: '20px', fontSize: '12px' }} />
          
          <Line 
            name="expressPrice"
            type="monotone" 
            dataKey="expressPrice" 
            stroke="#2563eb" // 快递用蓝色
            strokeWidth={3} 
            dot={{ r: 4, strokeWidth: 2 }} 
            activeDot={{ r: 6 }}
            connectNulls={true} // 如果某天没发快递报价，线条直接连过去
          />
          <Line 
            name="guanghuoPrice"
            type="monotone" 
            dataKey="guanghuoPrice" 
            stroke="#059669" // 广货用绿色
            strokeWidth={3} 
            dot={{ r: 4, strokeWidth: 2 }} 
            activeDot={{ r: 6 }}
            connectNulls={true}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}