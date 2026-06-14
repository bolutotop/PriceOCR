import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

  // 告诉 Next.js 不要打包 tesseract.js（仅在服务端运行）
  serverExternalPackages: ['tesseract.js'],

  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
};

export default nextConfig;
