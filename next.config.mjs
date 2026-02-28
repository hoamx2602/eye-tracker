/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow same-origin /api when running `next dev` (no VITE_API_URL needed)
  transpilePackages: ['@mediapipe/tasks-vision', '@mediapipe/camera_utils'],
};

export default nextConfig;
