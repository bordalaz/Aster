export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

// Один вход для всех запросов: cookie-сессия, JSON туда-обратно, единый тип ошибки.
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let b = null
    try { b = await r.json() } catch { /* тело не JSON — неважно */ }
    throw new ApiError(r.status, b)
  }
  return r.status === 204 ? null : r.json()
}

// Загрузка файла сырым телом (R27): до привязки к записи файл виден только загрузившему.
export async function uploadFile(file) {
  const r = await fetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
  })
  if (!r.ok) {
    let b = null
    try { b = await r.json() } catch { /* не JSON */ }
    throw new ApiError(r.status, b)
  }
  return r.json()
}
