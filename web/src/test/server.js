import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { tables, fields1, records1, me } from './fixtures.js'

// Изменяемая копия записей — PATCH-хендлер её правит, чтобы тесты видели эффект.
let recs = structuredClone(records1)
export function resetDb() { recs = structuredClone(records1) }

export const handlers = [
  http.get('/api/auth/me', () => HttpResponse.json(me)),
  http.post('/api/auth/login', async ({ request }) => {
    const { password } = await request.json()
    return password === 'secret' ? HttpResponse.json({ ok: true }) : new HttpResponse(null, { status: 401 })
  }),
  http.post('/api/auth/logout', () => HttpResponse.json({ ok: true })),
  http.get('/api/tables', () => HttpResponse.json(tables)),
  http.get('/api/tables/1/fields', () => HttpResponse.json(fields1)),
  http.get('/api/tables/1/records', () => HttpResponse.json(recs)),
  http.patch('/api/tables/1/records/:rid', async ({ request, params }) => {
    const body = await request.json()
    const row = recs.find(r => r.id === Number(params.rid))
    if (!row) return new HttpResponse(null, { status: 404 })
    if (row.updated_at !== body.updated_at) return new HttpResponse(null, { status: 409 })
    Object.assign(row, body.values)
    row.updated_at = new Date(Date.parse(row.updated_at) + 1000).toISOString()
    return HttpResponse.json({ id: row.id, updated_at: row.updated_at })
  }),
]

export const server = setupServer(...handlers)
