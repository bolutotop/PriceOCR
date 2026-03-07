import * as tencentcloud from "tencentcloud-sdk-nodejs";
import fs from 'fs/promises';

const OcrClient = tencentcloud.ocr.v20181119.Client;

export async function runTencentOcr(source: { type: 'url' | 'file', payload: string }): Promise<any> {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    throw new Error("配置缺失: 未读取到腾讯云密钥，请检查 .env 文件");
  }

  // 走香港同城节点，保证速度
  const clientConfig = {
    credential: {
      secretId: process.env.TENCENT_SECRET_ID,
      secretKey: process.env.TENCENT_SECRET_KEY,
    },
    region: "ap-hongkong", 
    profile: {
      httpProfile: {
        endpoint: "ocr.ap-hongkong.tencentcloudapi.com",
        reqTimeout: 60000, 
      },
    },
  };
  const client = new OcrClient(clientConfig);

  const params: any = {};
  
  if (source.type === 'url') {
    params.ImageUrl = source.payload;
  } else {
    const buffer = await fs.readFile(source.payload);
    params.ImageBase64 = buffer.toString('base64');
  }

  try {
    // 调用最新的通用文字识别（高精度版）
    const response = await client.GeneralAccurateOCR(params);
    
    if (!response.TextDetections || response.TextDetections.length === 0) {
        throw new Error("腾讯云未识别到有效的文本内容");
    }

    // ==========================================
    // 🚨 坐标探针日志：打印前 10 条原始数据
    // ==========================================
    console.log("\n\n👀👀👀 [腾讯云原始坐标探测 - 前10条] 👀👀👀");
    const sampleLogs = response.TextDetections.slice(20, 30).map((item: any) => ({
        Text: item.DetectedText,
        Polygon: item.Polygon
    }));
    console.log(JSON.stringify(sampleLogs, null, 2));
    console.log("👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀👀\n\n");


    // 物理坐标转换适配器
    const fakeBlocks: any[] = [];

    for (const item of response.TextDetections) {
        if (!item.DetectedText) continue;

        const rawText = item.DetectedText.trim();
        const lines = rawText.split(/\r?\n/).map((l: string) => l.trim()).filter((l: string) => l);
        const pts = item.Polygon?.map((p: any) => ({ x: p.X, y: p.Y })) || [];

        if (lines.length <= 1 || pts.length < 4) {
            fakeBlocks.push({ blockContent: rawText, blockPoints: pts });
        } else {
            const minX = Math.min(...pts.map((p: any) => p.x));
            const maxX = Math.max(...pts.map((p: any) => p.x));
            const minY = Math.min(...pts.map((p: any) => p.y));
            const maxY = Math.max(...pts.map((p: any) => p.y));

            const totalHeight = maxY - minY;
            const lineHeight = totalHeight / lines.length;

            lines.forEach((line, idx) => {
                const curTop = minY + idx * lineHeight;
                const curBottom = curTop + lineHeight;
                
                fakeBlocks.push({
                    blockContent: line,
                    blockPoints: [
                        { x: minX, y: Math.round(curTop) },
                        { x: maxX, y: Math.round(curTop) },
                        { x: maxX, y: Math.round(curBottom) },
                        { x: minX, y: Math.round(curBottom) }
                    ]
                });
            });
        }
    }

    return {
        tableInfo: null,
        blockInfo: { blockDetails: fakeBlocks }
    };

  } catch (err: any) {
    console.error("[Tencent GeneralAccurateOCR Error]", err);
    throw new Error(`腾讯云节点处理失败: ${err.message}`);
  }
}