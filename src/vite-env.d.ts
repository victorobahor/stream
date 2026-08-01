/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1`/`true` enables the experimental HTML rewrite proxy (breaks playback). */
  readonly VITE_EMBED_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
