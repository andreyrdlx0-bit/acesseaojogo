import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FFmpeg roda apenas no worker; o app web nunca importa child_process.
  serverExternalPackages: [],
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Microfone precisa ser liberado para o próprio domínio (VoiceCommandBox).
          { key: "Permissions-Policy", value: "microphone=(self), camera=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
