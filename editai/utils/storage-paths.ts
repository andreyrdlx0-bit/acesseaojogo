/**
 * Layout do storage — isolamento por usuário:
 *   users/{userId}/projects/{projectId}/original/
 *   users/{userId}/projects/{projectId}/audio/
 *   users/{userId}/projects/{projectId}/versions/
 *   users/{userId}/projects/{projectId}/exports/
 *   users/{userId}/library/
 * As policies de storage (database/migrations) só permitem acesso ao prefixo
 * users/{auth.uid()}/.
 */
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertId(id: string) {
  if (!uuidRe.test(id)) throw new Error("ID inválido para caminho de storage");
}

export const storagePaths = {
  userRoot(userId: string) {
    assertId(userId);
    return `users/${userId}`;
  },
  projectRoot(userId: string, projectId: string) {
    assertId(projectId);
    return `${this.userRoot(userId)}/projects/${projectId}`;
  },
  original(userId: string, projectId: string, ext: string) {
    return `${this.projectRoot(userId, projectId)}/original/source.${ext}`;
  },
  thumbnail(userId: string, projectId: string) {
    return `${this.projectRoot(userId, projectId)}/original/thumbnail.jpg`;
  },
  audio(userId: string, projectId: string, id: string, ext: string) {
    return `${this.projectRoot(userId, projectId)}/audio/${id}.${ext}`;
  },
  version(userId: string, projectId: string, versionNumber: number) {
    return `${this.projectRoot(userId, projectId)}/versions/v${versionNumber}.mp4`;
  },
  export(userId: string, projectId: string, renderId: string) {
    return `${this.projectRoot(userId, projectId)}/exports/${renderId}.mp4`;
  },
  library(userId: string, id: string, ext: string) {
    return `${this.userRoot(userId)}/library/${id}.${ext}`;
  },
  /** Garante que um caminho recebido do cliente pertence ao usuário/projeto. */
  belongsTo(path: string, userId: string, projectId?: string) {
    const prefix = projectId ? `${this.projectRoot(userId, projectId)}/` : `${this.userRoot(userId)}/`;
    return path.startsWith(prefix) && !path.includes("..");
  },
};
