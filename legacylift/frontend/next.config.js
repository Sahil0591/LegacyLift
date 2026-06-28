/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow ReactFlow and react-diff-viewer to work in the browser bundle
  transpilePackages: ["reactflow"],
};

module.exports = nextConfig;
