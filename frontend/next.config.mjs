/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 백엔드(FastAPI, 8080)로 API/WS 프록시 — dev에서 동일 출처처럼 사용.
  // 배포 시 NEXT_PUBLIC_API_BASE 로 직접 지정 가능.
  async rewrites() {
    const backend = process.env.BACKEND_ORIGIN || "http://192.168.34.202:8080";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};
export default nextConfig;
