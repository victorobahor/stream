/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `1`/`true` enables the experimental HTML rewrite proxy (breaks playback). */
  readonly VITE_EMBED_PROXY?: string;
  /** `0`/`false` disables native HLS (Chrome resolve + hls.js). Default: enabled. */
  readonly VITE_HLS_NATIVE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
