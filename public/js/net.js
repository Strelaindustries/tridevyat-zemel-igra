// Связь с сервером: поток событий плюс короткие POST-запросы.
export function listen(url, handlers) {
  const source = new EventSource(url);
  for (const [type, fn] of Object.entries(handlers)) {
    source.addEventListener(type, e => fn(JSON.parse(e.data)));
  }
  return source;
}

export async function post(path, body = {}) {
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
