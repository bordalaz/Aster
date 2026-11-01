import { expect, test } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { useRecords } from './useRecords.js'
import { server } from '../test/server.js'
import { records1 } from '../test/fixtures.js'

test('грузит поля (связи и формулы — да, прочие виртуальные — нет) и записи', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const kinds = result.current.fields.map(f => f.kind)
  expect(kinds).toContain('formula')
  expect(kinds).toContain('multipleRecordLinks')
  expect(result.current.fields).toHaveLength(7)
  expect(result.current.rows).toHaveLength(2)
})

test('после правки строки тихо перечитываются — сервер досчитал формулы', async () => {
  const { result } = renderHook(() => useRecords(1, 20))
  await waitFor(() => expect(result.current.loading).toBe(false))
  await act(() => result.current.patch(result.current.rows[0], { f_fld00000000000002: 9 }))
  server.use(http.get('/api/tables/1/records', () =>
    HttpResponse.json(records1.map(r => r.id === 1 ? { ...r, f_fld00000000000007: 'Кольцо_9' } : r))))
  await waitFor(() => expect(result.current.rows[0].f_fld00000000000007).toBe('Кольцо_9'))
  expect(result.current.loading).toBe(false)
})

test('patch обновляет строку и updated_at', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.rows[0].updated_at
  await act(() => result.current.patch(result.current.rows[0], { f_fld00000000000002: 42 }))
  const row = result.current.rows.find(r => r.id === 1)
  expect(row.f_fld00000000000002).toBe(42)
  expect(row.updated_at).not.toBe(before)
})

test('patch при устаревшем updated_at бросает 409 и перезагружает', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const stale = { ...result.current.rows[0], updated_at: '2000-01-01T00:00:00+00:00' }
  await expect(Promise.resolve(act(() => result.current.patch(stale, { f_fld00000000000002: 1 })))).rejects.toMatchObject({ status: 409 })
})
