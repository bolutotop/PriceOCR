import * as tencentcloud from "tencentcloud-sdk-nodejs";
import fs from 'fs/promises';

const OcrClient = tencentcloud.ocr.v20181119.Client;

/**
 * 调用腾讯云 GeneralAccurateOCR（通用印刷体识别·高精度版）接口
 * 用于截图类图片的文字识别，返回 TextDetections 数组
 */
export async function runTencentGeneralOcr(source: { type: 'url' | 'file' | 'buffer', payload: string }): Promise<any> {
  if (!process.env.TENCENT_SECRET_ID || !process.env.TENCENT_SECRET_KEY) {
    throw new Error("配置缺失: 未读取到腾讯云密钥，请检查 .env 文件");
  }

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
  } else if (source.type === 'buffer') {
    params.ImageBase64 = source.payload;
  } else {
    const buffer = await fs.readFile(source.payload);
    params.ImageBase64 = buffer.toString('base64');
  }

  try {
    const response = await client.GeneralAccurateOCR(params);

    console.log(`[腾讯云 GeneralAccurateOCR] TextDetections 数量 = ${response.TextDetections?.length ?? 0}`);

    return response;
  } catch (err: any) {
    console.error("[Tencent GeneralAccurateOCR Error]", err);
    throw new Error(`腾讯云通用高精度识别失败: ${err.message}`);
  }
}
