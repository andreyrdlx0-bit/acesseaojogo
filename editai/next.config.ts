import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O binário do FFmpeg (ffmpeg-static) não é empacotado pelo webpack: é copiado
  // como arquivo para a função que processa vídeos (/api/jobs/run), junto com
  // a fonte usada nas legendas.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/jobs/run": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**/*"],
  },
  // A transcrição no navegador (transformers.js) só roda no cliente; nada dela
  // pode ir para as funções do servidor (o onnxruntime-node tem 288 MB).
  outputFileTracingExcludes: {
    "*": ["./node_modules/onnxruntime-node/**", "./node_modules/onnxruntime-web/**", "./node_modules/@huggingface/**"],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.alias = { ...config.resolve.alias, "onnxruntime-node$": false, sharp$: false };
    }
    return config;
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
