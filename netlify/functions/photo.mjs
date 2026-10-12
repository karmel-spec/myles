// /photo/<name> — serves a photo out of the site's Blob store.
import { getStore } from '@netlify/blobs';

export const config = { path: '/photo/:name' };

export default async (req, context) => {
  const name = String((context && context.params && context.params.name) || new URL(req.url).pathname.split('/').pop() || '');
  if (!/^[A-Za-z0-9.-]+$/.test(name)) return new Response('not found', { status: 404 });
  const store = globalThis.__babybookStore || getStore({ name: 'babybook', consistency: 'strong' });
  const r = await store.getWithMetadata('photo/' + name, { type: 'arrayBuffer' });
  if (!r || !r.data) return new Response('not found', { status: 404 });
  return new Response(r.data, { headers: { 'content-type': (r.metadata && r.metadata.type) || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
};
