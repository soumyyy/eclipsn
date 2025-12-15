/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_GATEWAY_URL: process.env.NEXT_PUBLIC_GATEWAY_URL || '/api'
  },
  async rewrites() {
    if (process.env.NEXT_PUBLIC_GATEWAY_URL && process.env.NEXT_PUBLIC_GATEWAY_URL !== '/api') {
      return [];
    }
    const target = process.env.GATEWAY_PROXY_TARGET || 'http://localhost:4000';
    return [
      {
        source: '/api/:path*',
        destination: `${target}/api/:path*`
      }
    ];
  }
};

export default nextConfig;
