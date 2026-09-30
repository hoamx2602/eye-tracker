/** @type {import('next').NextConfig} */

/**
 * Screens of the eye-tracking flow that used to live at the site root. They
 * moved under /eye-tracking when the site was split into modules; these keep
 * old bookmarks and shared links (e.g. /tracking?sessionId=…) working. Next
 * carries the query string across a redirect.
 */
const LEGACY_EYE_TRACKING_PATHS = ['consent', 'demographics', 'calibration', 'setup', 'choice', 'tracking'];

const nextConfig = {
  reactStrictMode: true,
  // Allow same-origin /api when running `next dev` (no VITE_API_URL needed)
  transpilePackages: ['@mediapipe/tasks-vision', '@mediapipe/camera_utils'],
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  async redirects() {
    return [
      ...LEGACY_EYE_TRACKING_PATHS.map((segment) => ({
        source: `/${segment}`,
        destination: `/eye-tracking/${segment}`,
        permanent: false,
      })),
      { source: '/neuro/:path*', destination: '/eye-tracking/neuro/:path*', permanent: false },
      { source: '/facial-speech', destination: '/facial-droop', permanent: false },
    ];
  },
};

export default nextConfig;
