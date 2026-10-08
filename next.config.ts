import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/*": ["./node_modules/@fontsource/inter/files/inter-latin-*-normal.woff2"],
  },
};

export default nextConfig;
