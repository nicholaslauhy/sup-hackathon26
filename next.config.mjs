/** @type {import('next').NextConfig} */
const nextConfig = {
  // tesseract.js spawns a Node worker and pdfjs-dist loads its own runtime
  // assets by path. Bundling them rewrites those paths into .next/ and breaks
  // resolution (e.g. "Cannot find module .next/worker-script/node/index.js").
  // Keeping them external lets each resolve its files from node_modules.
  serverExternalPackages: ["tesseract.js", "pdfjs-dist"],
};

export default nextConfig;
