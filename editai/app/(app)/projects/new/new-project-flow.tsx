"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { api } from "@/api/client";
import { VideoUploader } from "@/components/project/video-uploader";
import type { Project } from "@/types/domain";

export function NewProjectFlow({ maxMb }: { maxMb: number }) {
  const router = useRouter();
  const created = useRef<string | null>(null);

  const ensureProject = useCallback(async (fileName: string) => {
    if (created.current) return created.current;
    const name = fileName.replace(/\.[^.]+$/, "").slice(0, 120) || "Novo projeto";
    const { project } = await api.post<{ project: Project }>("/api/projects", { name });
    created.current = project.id;
    return project.id;
  }, []);

  return (
    <VideoUploader
      maxMb={maxMb}
      ensureProject={ensureProject}
      onUploaded={(id) => setTimeout(() => router.push(`/projects/${id}`), 900)}
    />
  );
}
