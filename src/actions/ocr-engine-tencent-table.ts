import * as tencentcloud from "tencentcloud-sdk-nodejs";
import fs from 'fs/promises';
import { TENCENT_OCR_REGION, TENCENT_OCR_ENDPOINT, TENCENT_OCR_TIMEOUT } from '@/lib/constants';

const OcrClient = tencentcloud.ocr.v20181119.Client;

/**
 * 调用腾讯云 RecognizeTableAccurateOCR（表格精确识别）接口
 * 专门用于截图类表格图片的解析
 */
export async function runTencentTableOcr(source: { type: 'url' | 'file'; payload: string }) {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    throw new Error("配置缺失: 未读取到腾讯云密钥，请检查 .env 文件");
  }

  const client = new OcrClient({
    credential: {
      secretId: process.env.TENCENT_SECRET_ID,
      secretKey: process.env.TENCENT_SECRET_KEY,
    },
    region: TENCENT_OCR_REGION,
    profile: {
      httpProfile: {
        endpoint: TENCENT_OCR_ENDPOINT,
        reqTimeout: TENCENT_OCR_TIMEOUT,
      },
    },
  });

  const params: Record<string, unknown> = {};

  if (source.type === 'url') {
    params.ImageUrl = source.payload;
  } else {
    const buffer = await fs.readFile(source.payload);
    params.ImageBase64 = buffer.toString('base64');
  }

  try {
    const response = await client.RecognizeTableAccurateOCR(params);

    console.log(`[腾讯云 TableOCR] TableDetections 数量 = ${response.TableDetections?.length ?? 0}`);

    return response;
  } catch (err: any) {
    console.error("[Tencent RecognizeTableAccurateOCR Error]", err);
    throw new Error(`腾讯云表格识别失败: ${err.message}`);
  }
}
