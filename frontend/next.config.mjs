/** @type {import('next').NextConfig} */
const nextConfig = {
  // 정적 export → FastAPI 가 frontend/out 을 서빙 (DESIGN.md §3)
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;
