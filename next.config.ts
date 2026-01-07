import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,

experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // 2. 【关键修复】告诉 Next.js 不要打包 tesseract.js
    serverComponentsExternalPackages: ['tesseract.js'],
  },
};

export default nextConfig;
