/**
 * Kept in its own module so `app.ts` can check for saved state without
 * statically importing — and therefore eagerly bundling — all of multiview.
 */
export const MULTIVIEW_STORAGE_KEY = 'streamzone_multiview';
