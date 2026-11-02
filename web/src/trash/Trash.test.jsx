import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server.js'
import Trash from './Trash.jsx'

const item = { id: 7, table_id: 3, table_title: 'Персонал', record_id: 42, title: 'Соков_К.А.', deleted_by: 'Денис',
  deleted_at: '2026-11-02T10:00:00Z', expires_at: '2027-11-02T10:00:00Z' }

function mock(calls) {
  server.use(
    http.get('/api/trash', () => HttpResponse.json(calls.restored ? [] : [item])),
    http.get('/api/tables', () => HttpResponse.json([{ id: 3, title: 'Персонал' }])),
    http.post('/api/trash/restore', async ({ request }) => { calls.restored = await request.json(); return HttpResponse.json({ restored: [] }) }),
    http.delete('/api/trash/7', () => { calls.purged = true; calls.restored = true; return HttpResponse.json({ ok: true }) }),
  )
}

describe('Корзина', () => {
  it('что, откуда, кто удалил; «Восстановить» у админа, «Удалить навсегда» — нет', async () => {
    const calls = {}
    mock(calls)
    render(<Trash user={{ role: 'admin' }} />)
    const row = (await screen.findByRole('button', { name: 'Соков_К.А.' })).closest('tr')
    expect(within(row).getByText('Персонал')).toBeInTheDocument()
    expect(within(row).getByText('Денис')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Удалить навсегда' })).toBeNull()
    await userEvent.click(within(row).getByRole('button', { name: 'Восстановить' }))
    await waitFor(() => expect(calls.restored).toEqual({ ids: [7] }))
    expect(await screen.findByText('Корзина пуста')).toBeInTheDocument()
  })

  it('суперадмин удаляет навсегда — только после подтверждения', async () => {
    const calls = {}
    mock(calls)
    render(<Trash user={{ role: 'superadmin' }} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Удалить навсегда' }))
    expect(calls.purged).toBeUndefined()
    const dlg = screen.getByRole('alertdialog', { name: 'Удалить навсегда' })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Удалить навсегда' }))
    await waitFor(() => expect(calls.purged).toBe(true))
  })
})
