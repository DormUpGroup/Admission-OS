import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    staleTimes: {
      dynamic: 30,
    },
  },
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "bcryptjs",
    "@napi-rs/canvas",
    "@napi-rs/canvas-win32-x64-msvc",
    "pdfjs-dist",
    "tesseract.js",
    "pdf-parse",
  ],
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/.prisma/client/**",
      "./node_modules/@prisma/client/**",
    ],
  },
};

export default nextConfig;
