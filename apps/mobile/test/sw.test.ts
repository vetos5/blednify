/**
 * The web offline shell (public/sw.js) run against an in-memory Cache Storage and a scripted network.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(import.meta.dir, '../public/sw.js'), 'utf8');
const ORIGIN = 'https://music.example';

type Handler = (e: unknown) => void;

function setup(network: (url: string) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name)!;
    return {
      match: async (r: Request | string) => m.get(key(r))?.clone(),
      put: async (r: Request | string, res: Response) => void m.set(key(r), res),
      keys: async () => [...m.keys()].map((p) => new Request(ORIGIN + p)),
      delete: async (r: Request | string) => m.delete(key(r)),
    };
  };
  const caches = { open, keys: async () => [...stores.keys()], delete: async (n: string) => stores.delete(n) };
  const fetched: string[] = [];
  const fetchFn = (r: Request | string) => {
    const url = new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
    fetched.push(url);
    return network(url);
  };
  const handlers: Record<string, Handler> = {};
  const self = {
    location: { origin: ORIGIN },
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
  };
  new Function('self', 'caches', 'fetch', SRC)(self, caches, fetchFn);

  /** Dispatches a fetch event; undefined when the worker leaves the request to the network. */
  async function request(path: string, init: { navigate?: boolean; headers?: Record<string, string> } = {}) {
    let responded: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    const request = new Request(ORIGIN + path, { headers: init.headers });
    Object.defineProperty(request, 'mode', { value: init.navigate ? 'navigate' : 'cors' });
    handlers.fetch({
      request,
      respondWith: (p: Promise<Response>) => (responded = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    const res = responded ? await responded : undefined;
    await Promise.all(waits);
    return res;
  }
  return { request, stores, fetched };
}

const HTML = '<html><script src="/_expo/static/js/web/index-abc.js" defer></script><link href="/assets/font-1.ttf"></html>';
const html = () =>
  new Response(HTML, { headers: { 'content-type': 'text/html; charset=utf-8', 'cross-origin-embedder-policy': 'require-corp' } });

describe('offline shell (sw.js)', () => {
  test('online: the page comes from the network, and the shell and its bundles are stored', async () => {
    const sw = setup(async (url) => (url === '/' || url === '/album/1' ? html() : new Response(`file ${url}`)));
    const res = await sw.request('/album/1', { navigate: true });
    expect(await res!.text()).toBe(HTML);
    expect([...sw.stores.get('blednify-shell-v1')!.keys()]).toEqual(['/']);
    expect([...sw.stores.get('blednify-assets-v1')!.keys()].sort()).toEqual(['/_expo/static/js/web/index-abc.js', '/assets/font-1.ttf']);
  });

  test('offline: the stored shell is served, headers included, and bundles come from the cache', async () => {
    let online = true;
    const sw = setup(async (url) => {
      if (!online) throw new TypeError('Network request failed');
      return url.startsWith('/_expo/') || url.startsWith('/assets/') ? new Response(`file ${url}`) : html();
    });
    await sw.request('/', { navigate: true });
    online = false;
    const page = await sw.request('/settings', { navigate: true });
    expect(await page!.text()).toBe(HTML);
    expect(page!.headers.get('cross-origin-embedder-policy')).toBe('require-corp');
    const js = await sw.request('/_expo/static/js/web/index-abc.js');
    expect(await js!.text()).toBe('file /_expo/static/js/web/index-abc.js');
  });

  test('offline with nothing stored yet: the network failure goes through as it would have', async () => {
    const sw = setup(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(sw.request('/', { navigate: true })).rejects.toThrow('Network request failed');
  });

  test('a newer shell replaces the stored one (no stale app while online)', async () => {
    let body = HTML;
    const sw = setup(async (url) =>
      url === '/' ? new Response(body, { headers: { 'content-type': 'text/html' } }) : new Response('x'),
    );
    await sw.request('/', { navigate: true });
    body = '<html>v2</html>';
    expect(await (await sw.request('/', { navigate: true }))!.text()).toBe('<html>v2</html>');
    expect(await sw.stores.get('blednify-shell-v1')!.get('/')!.text()).toBe('<html>v2</html>');
  });

  test('the API, streams with a Range header and other origins are left alone', async () => {
    const sw = setup(async () => new Response('net'));
    expect(await sw.request('/api/tracks')).toBeUndefined();
    expect(await sw.request('/api/tracks/1/stream', { headers: { range: 'bytes=0-' } })).toBeUndefined();
    expect(await sw.request('/assets/song.mp3', { headers: { range: 'bytes=0-' } })).toBeUndefined();
  });

  test('error answers for hashed files are not cached', async () => {
    let status = 404;
    const sw = setup(async () => new Response('nope', { status }));
    expect((await sw.request('/_expo/static/js/web/missing.js'))!.status).toBe(404);
    status = 200;
    expect((await sw.request('/_expo/static/js/web/missing.js'))!.status).toBe(200);
  });
});
