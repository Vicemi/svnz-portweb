// Where the online backend lives. Both values are set as build environment variables (see the README, "Online backend").
//   PUBLIC_SVNZ_BACKEND_URL    https://svnz-api.example.com   (http(s) address of svnz-backend; the websocket address is derived from it)
//   PUBLIC_SVNZ_BACKEND_TOKEN  the GAME_TOKEN of the backend's .env
// PUBLIC_ variables end up inside the page, so the token is a "game key" (it keeps casual traffic and other sites out), not a password.

const rawUrl = (import.meta.env.PUBLIC_SVNZ_BACKEND_URL ?? '').trim();
const rawToken = (import.meta.env.PUBLIC_SVNZ_BACKEND_TOKEN ?? '').trim();

function normalize(u: string): string {
  if (!u) return '';
  const withScheme = /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
  return withScheme.replace(/^ws/i, 'http').replace(/\/+$/, '');
}

const http = normalize(rawUrl);

export const backend = {
  configured: !!http && !!rawToken,
  http,
  ws: http.replace(/^http/i, 'ws') + '/ws',
  token: rawToken,
  /** what is missing, for the message shown to the player / the host of the site */
  problem: !http ? 'PUBLIC_SVNZ_BACKEND_URL' : !rawToken ? 'PUBLIC_SVNZ_BACKEND_TOKEN' : '',
};
