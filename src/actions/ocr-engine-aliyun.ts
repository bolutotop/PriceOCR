import { createReadStream } from 'fs';
import * as $dara from '@darabonba/typescript';
import ocr_api, * as $ocr_api from '@alicloud/ocr-api20210707';
import { $OpenApiUtil } from '@alicloud/openapi-core';
import Credential, { Config as CredentialConfig } from '@alicloud/credentials';

export async function runAliyunOcr(source: { type: 'url' | 'file', payload: string }): Promise<any> {
  if (!process.env.ALIYUN_AK_ID || !process.env.ALIYUN_AK_SECRET) {
    throw new Error("配置缺失: 未读取到阿里云密钥，请检查 .env 文件");
  }

  let credConfig = new CredentialConfig({
    type: 'access_key', 
    accessKeyId: process.env.ALIYUN_AK_ID,
    accessKeySecret: process.env.ALIYUN_AK_SECRET,
  });
  let credential = new Credential(credConfig);

  let config = new $OpenApiUtil.Config({
    credential: credential,
  });
  config.endpoint = `ocr-api.cn-hangzhou.aliyuncs.com`;
  let client = new ocr_api(config);

  let reqObj: any = { 
    type: "Table", 
    outputCoordinate: "points",
    outputOricoord: true
  };
  
  if (source.type === 'url') {
    reqObj.url = source.payload;
  } else {
    reqObj.body = createReadStream(source.payload) as any;
  }

  let recognizeAllTextRequest = new $ocr_api.RecognizeAllTextRequest(reqObj);

  let runtime = new $dara.RuntimeOptions({
    readTimeout: 60000,
    connectTimeout: 60000,
  });

  try {
    let resp = await client.recognizeAllTextWithOptions(recognizeAllTextRequest, runtime);
    
    const data = resp.body?.data;
    if (!data || !data.subImages || data.subImages.length === 0) {
      throw new Error("接口未返回有效的数据块");
    }

    return data.subImages[0];

  } catch (__err: any) {
    if (__err instanceof $dara.ResponseError) {
      throw new Error(`阿里云拒绝: ${__err.message}`);
    }
    throw new Error(`网络或解析异常: ${__err.message}`);
  }
}