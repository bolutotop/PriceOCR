import * as tencentcloud from "tencentcloud-sdk-nodejs";
import fs from 'fs/promises';

const OcrClient = tencentcloud.ocr.v20181119.Client;

export async function runTencentOcr(source: { type: 'url' | 'file', payload: string }): Promise<any> {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    throw new Error("配置缺失: 未读取到腾讯云密钥，请检查 .env 文件");
  }

  // 实例化腾讯云客户端，强制走香港内网节点
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
    // 🚨 核心战术转移：放弃表格引擎，改用“通用高精度文本识别”
    // 这样引擎只会按“纯物理行”吐出坐标，绝不会擅自合并所谓的“单元格”！
    const response = await client.GeneralAccurateOCR(params);
    
    if (!response.TextDetections || response.TextDetections.length === 0) {
        throw new Error("腾讯云未识别到有效的文本内容");
    }

    // ==========================================
    // 🚨 将“纯物理行”数据无缝适配到阿里云 blockInfo 格式
    // ==========================================
    const fakeBlocks: any[] = [];

    // 遍历每一个独立的文本行
    for (const item of response.TextDetections) {
        if (!item.DetectedText) continue;

        // 提取精确的多边形物理坐标
        const points = item.Polygon?.map((p: any) => ({ x: p.X, y: p.Y })) || [];

        // 塞入物理坐标块数组
        fakeBlocks.push({
            blockContent: item.DetectedText,  // 比如单独的一行 "软兰楼"
            blockPoints: points
        });
    }

    // 伪装成阿里云的散落文本块（blockInfo）数据结构
    const fakeAliyunSubImage = {
        tableInfo: null, // 彻底关闭脆弱的表格网格逻辑
        blockInfo: {
            blockDetails: fakeBlocks // 强制主算法使用无敌的物理坐标匹配
        }
    };

    return fakeAliyunSubImage;

  } catch (err: any) {
    console.error("[Tencent OCR Error]", err);
    throw new Error(`腾讯云节点处理失败: ${err.message}`);
  }
}