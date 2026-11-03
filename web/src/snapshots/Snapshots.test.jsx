import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { server } from '../test/server.js'
import Snapshots, { SnapshotBanner } from './Snapshots.jsx'

const snap = { id: 5, created_at: '2026-11-03T03:00:00Z', kind: 'auto', size: 9_600_000, rows: 1, by_user: null }

function mock(calls, canRestore) {
  server.use(
    http.get('/api/snapshots', () => HttpResponse.json({ snapshots: [snap], jobs: calls.jobs ?? [], open: null, can_restore: canRestore })),
    http.post('/api/snapshots', () => { calls.taken = true; return HttpResponse.json({ job: 1 }) }),
    http.post('/api/snapshots/5/restore', async ({ request }) => { calls.restore = await request.json(); return HttpResponse.json({ job: 2 }) }),
  )
}

describe('Снимки', () => {
  it('список, «Сделать снимок»; у админа нет «Вернуть базу»', async () => {
    const calls = {}
    mock(calls, false)
    render(<Snapshots />)
    const row = (await screen.findByText('Автоматический')).closest('tr')
    expect(within(row).getByText('9.6 МБ')).toBeInTheDocument()
    expect(within(row).queryByRole('button', { name: 'Вернуть базу' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Сделать снимок' }))
    await waitFor(() => expect(calls.taken).toBe(true))
  })

  it('суперадмин: «Вернуть базу» только после подтверждения', async () => {
    const calls = {}
    mock(calls, true)
    render(<Snapshots />)
    await userEvent.click(await screen.findByRole('button', { name: 'Вернуть базу' }))
    const dlg = screen.getByRole('alertdialog')
    expect(dlg).toHaveTextContent('пропадёт у всех')
    expect(calls.restore).toBeUndefined()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Вернуть базу' }))
    await waitFor(() => expect(calls.restore).toEqual({ confirm: true }))
  })

  it('плашка на экземпляре снимка', async () => {
    server.use(http.get('/api/snapshot-info', () => HttpResponse.json({ snapshot: snap })))
    render(<SnapshotBanner />)
    expect(await screen.findByRole('status')).toHaveTextContent('Снимок #5')
  })
})
