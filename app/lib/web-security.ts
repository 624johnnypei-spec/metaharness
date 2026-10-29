// Expo Router's static export emits this one fixed hydration assignment inline.
// Hash it explicitly instead of allowing arbitrary inline scripts.
export const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
