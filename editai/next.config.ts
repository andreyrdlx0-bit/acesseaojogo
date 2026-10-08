import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O binário do FFmpeg (ffmpeg-static) não é empacotado pelo webpack: é copiado
  // como arquivo para a função que processa vídeos (/api/jobs/run), junto com
  // a fonte usada nas legendas.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/jobs/run": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**/*"],
  },
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
