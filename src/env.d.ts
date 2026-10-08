/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** URL of the svnz-backend (https://svnz-api.example.com). Empty = the online modes are disabled. */
  readonly PUBLIC_SVNZ_BACKEND_URL?: string;
  /** Shared token (GAME_TOKEN of the backend's .env). */
  readonly PUBLIC_SVNZ_BACKEND_TOKEN?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
