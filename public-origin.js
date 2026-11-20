export function publicOrigin(env=process.env) {
  return new URL(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || 'https://quarts-service-iga.onrender.com').origin;
}
