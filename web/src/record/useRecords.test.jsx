import { expect, test } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import { mergeRows, useRecords } from './useRecords.js'

test('mergeRows: изменившиеся — на месте, новые — в конец', () => {
  const rows = [{ id: 1, a: 1 }, { id: 2, a: 2 }]
  expect(mergeRows(rows, [{ id: 2, a: 9 }, { id: 3, a: 3 }])).toEqual([{ id: 1, a: 1 }, { id: 2, a: 9 }, { id: 3, a: 3 }])
  expect(mergeRows(rows, [])).toBe(rows)
})

test('после правки — только изменившиеся строки по метке; таблица снова открыта — сразу из памяти', async () => {
  const seen = []
  server.use(
    http.get('/api/tables/77/fields', () => HttpResponse.json([{ column_name: 'a', title: 'А', kind: 'number', editable: true, options: {} }])),
    http.get('/api/tables/77/records', ({ request }) => {
      const since = new URL(request.url).searchParams.get('since')
      seen.push(since)
      if (since === '0') return HttpResponse.json({ token: 'b.1', full: true, rows: [{ id: 1, a: 1, updated_at: 't' }, { id: 2, a: 2, updated_at: 't' }] })
      return HttpResponse.json({ token: 'b.2', full: false, rows: [{ id: 2, a: 5, updated_at: 't2' }] })
    }),
  )
  const { result, unmount } = renderHook(() => useRecords(77, 0))
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(result.current.rows.map(r => r.a)).toEqual([1, 2])
  await act(() => result.current.refresh())
  expect(seen.at(-1)).toBe('b.1')
  expect(result.current.rows.map(r => r.a)).toEqual([1, 5])
  unmount()
  const again = renderHook(() => useRecords(77, 0))
  expect(again.result.current.loading).toBe(false)                // из памяти, без «Загрузка…»
  expect(again.result.current.rows.map(r => r.a)).toEqual([1, 5])
  await waitFor(() => expect(seen.at(-1)).toBe('b.2'))            // и догрузил изменения по метке
})
