import { useMemo } from 'react';
import { DashboardItem } from '@/actions/get-dashboard-data';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Activity, ArrowUpRight, ArrowDownRight, FileText, Box } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function MarketTrendView({ data }: { data: DashboardItem[] }) {
    const stats = useMemo(() => {
        let expUp = 0, expDown = 0, expFlat = 0;
        let expUpAmount = 0, expDownAmount = 0;

        let ghUp = 0, ghDown = 0, ghFlat = 0;
        let ghUpAmount = 0, ghDownAmount = 0;

        const expList: { name: string, diff: number, price: number }[] = [];
        const ghList: { name: string, diff: number, price: number }[] = [];

        data.forEach(item => {
            // 快递统计
            if (item.expressPrice && item.expressPrev) {
                const diff = item.expressPrice - item.expressPrev;
                if (diff > 0) {
                    expUp++;
                    expUpAmount += diff;
                } else if (diff < 0) {
                    expDown++;
                    expDownAmount += Math.abs(diff); // 累计绝对值
                } else {
                    expFlat++;
                }

                if (diff !== 0) expList.push({ name: item.name, diff, price: item.expressPrice });
            }

            // 广货统计
            if (item.guanghuoPrice && item.guanghuoPrev) {
                const diff = item.guanghuoPrice - item.guanghuoPrev;
                if (diff > 0) {
                    ghUp++;
                    ghUpAmount += diff;
                } else if (diff < 0) {
                    ghDown++;
                    ghDownAmount += Math.abs(diff);
                } else {
                    ghFlat++;
                }

                if (diff !== 0) ghList.push({ name: item.name, diff, price: item.guanghuoPrice });
            }
        });

        const totalUp = expUp + ghUp;
        const totalDown = expDown + ghDown;
        const totalFlat = expFlat + ghFlat;
        const totalUpAmount = expUpAmount + ghUpAmount;
        const totalDownAmount = expDownAmount + ghDownAmount;

        // 排序生成龙虎榜
        const expTopGainers = [...expList].sort((a, b) => b.diff - a.diff).slice(0, 5);
        const expTopLosers = [...expList].sort((a, b) => a.diff - b.diff).slice(0, 5);
        const ghTopGainers = [...ghList].sort((a, b) => b.diff - a.diff).slice(0, 5);
        const ghTopLosers = [...ghList].sort((a, b) => a.diff - b.diff).slice(0, 5);

        return {
            overall: { up: totalUp, down: totalDown, flat: totalFlat, upAmount: totalUpAmount, downAmount: totalDownAmount },
            express: { up: expUp, down: expDown, flat: expFlat, upAmount: expUpAmount, downAmount: expDownAmount, gainers: expTopGainers, losers: expTopLosers },
            guanghuo: { up: ghUp, down: ghDown, flat: ghFlat, upAmount: ghUpAmount, downAmount: ghDownAmount, gainers: ghTopGainers, losers: ghTopLosers }
        };
    }, [data]);

    // 🚨 核心逻辑更新：按金额计算进度条，平盘固定占位，顺序改为 [跌] - [平] - [涨]
    const renderTrendBar = (upAmount: number, downAmount: number, flatCount: number) => {
        const totalAmount = upAmount + downAmount;

        // 如果有平盘数据，给它固定 15% 的排版空间防止消失；否则为 0
        let flatWidth = flatCount > 0 ? 15 : 0;
        // 如果全天一点涨跌金额都没有，平盘独占 100%
        if (totalAmount === 0) flatWidth = 100;

        const remainingWidth = 100 - flatWidth;
        const downWidth = totalAmount > 0 ? (downAmount / totalAmount) * remainingWidth : 0;
        const upWidth = totalAmount > 0 ? (upAmount / totalAmount) * remainingWidth : 0;

        return (
            <div className="w-full flex h-2 rounded-full overflow-hidden mt-4 bg-slate-100">
                <div style={{ width: `${downWidth}%` }} className="bg-emerald-500 transition-all duration-500" />
                <div style={{ width: `${flatWidth}%` }} className="bg-slate-300 transition-all duration-500" />
                <div style={{ width: `${upWidth}%` }} className="bg-red-500 transition-all duration-500" />
            </div>
        );
    };

    const renderList = (items: { name: string, diff: number, price: number }[], type: 'up' | 'down') => {
        if (items.length === 0) return <div className="text-center text-xs text-slate-400 py-4">暂无数据</div>;
        return (
            <div className="space-y-2 mt-2">
                {items.map((item, i) => (
                    <div key={i} className="flex justify-between items-center text-sm py-1 border-b border-slate-50 last:border-0">
                        <span className="font-bold text-slate-700 truncate pr-2">{item.name}</span>
                        <div className="flex items-center gap-3 shrink-0 font-mono font-black">
                            <span className="text-slate-900 w-12 text-right">{item.price}</span>
                            <span className={cn("w-14 text-right flex justify-end items-center", type === 'up' ? 'text-red-500' : 'text-emerald-500')}>
                                {type === 'up' ? <ArrowUpRight className="w-3 h-3 mr-0.5" /> : <ArrowDownRight className="w-3 h-3 mr-0.5" />}
                                {Math.abs(item.diff).toFixed(1)}
                            </span>
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6 pb-[120px]">

            {/* 核心大盘 */}
            <h2 className="text-lg font-black text-slate-800 flex items-center gap-2 px-1">
                <Activity className="w-5 h-5 text-blue-600 stroke-[2.5]" /> 烟价行情温度计
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                    { title: '整体烟价行情', data: stats.overall },
                    { title: '快递烟价行情', data: stats.express },
                    { title: '广货烟价行情', data: stats.guanghuo },
                ].map((market, idx) => (
                    <Card key={idx} className="shadow-sm border-slate-200">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-[15px] text-slate-700">{market.title}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {/* 🚨 位置调换：左边绿色下跌，中间灰色平盘，右边红色上涨 */}
                            <div className="flex justify-between items-end text-center mt-2">

                                {/* 下跌区 (移至左侧) */}
                                <div className="flex flex-col items-center">
                                    <div className="text-2xl sm:text-3xl font-black text-emerald-500 font-mono">
                                        -{market.data.downAmount.toFixed(1)}
                                    </div>
                                    <div className="text-xs text-slate-500 font-bold mt-1">
                                        下跌 <span className="text-emerald-600">{market.data.down}</span> 家
                                    </div>
                                </div>

                                {/* 平盘区 (居中) */}
                                <div className="flex flex-col items-center pb-[2px]">
                                    <div className="text-lg font-black text-slate-400 font-mono">
                                        {market.data.flat}
                                    </div>
                                    <div className="text-[10px] text-slate-400 font-bold mt-1">
                                        平盘家数
                                    </div>
                                </div>

                                {/* 上涨区 (移至右侧) */}
                                <div className="flex flex-col items-center">
                                    <div className="text-2xl sm:text-3xl font-black text-red-500 font-mono">
                                        +{market.data.upAmount.toFixed(1)}
                                    </div>
                                    <div className="text-xs text-slate-500 font-bold mt-1">
                                        上涨 <span className="text-red-600">{market.data.up}</span> 家
                                    </div>
                                </div>

                            </div>

                            {/* 传入金额数据，生成资金进度条 */}
                            {renderTrendBar(market.data.upAmount, market.data.downAmount, market.data.flat)}
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* 龙虎榜 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
                {/* 快递市场龙虎榜 */}
                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                        <CardTitle className="text-[15px] flex items-center gap-2 text-slate-800">
                            <FileText className="w-4 h-4 text-blue-500" /> 快递行情龙虎榜
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                        <div>
                            <div className="text-xs font-black text-emerald-600 bg-emerald-50 py-1 px-2 rounded-sm inline-block mb-2">领跌前五</div>
                            {renderList(stats.express.losers, 'down')}
                        </div>
                        <div>
                            <div className="text-xs font-black text-red-500 bg-red-50 py-1 px-2 rounded-sm inline-block mb-2">领涨前五</div>
                            {renderList(stats.express.gainers, 'up')}
                        </div>
                    </CardContent>
                </Card>

                {/* 广货市场龙虎榜 */}
                <Card className="shadow-sm border-slate-200">
                    <CardHeader className="bg-slate-50/50 border-b border-slate-100">
                        <CardTitle className="text-[15px] flex items-center gap-2 text-slate-800">
                            <Box className="w-4 h-4 text-purple-500" /> 广货行情龙虎榜
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                        <div>
                            <div className="text-xs font-black text-emerald-600 bg-emerald-50 py-1 px-2 rounded-sm inline-block mb-2">领跌前五</div>
                            {renderList(stats.guanghuo.losers, 'down')}
                        </div>
                        <div>
                            <div className="text-xs font-black text-red-500 bg-red-50 py-1 px-2 rounded-sm inline-block mb-2">领涨前五</div>
                            {renderList(stats.guanghuo.gainers, 'up')}
                        </div>
                    </CardContent>
                </Card>
            </div>

        </div>
    );
}