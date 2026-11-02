import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../test/server.js'
import SendDialog from './SendDialog.jsx'

const fields = [{ column_name: 'name', title: 'Наименование', kind: 'singleLineText' }, { column_name: 'qty', title: 'Кол-во', kind: 'number', options: { precision: 0 } }]
const rows = [{ id: 1, name: 'Кольцо', qty: 5 }, { id: 2, name: 'Втулка', qty: 7 }]
const props = { tableId: 3, table: 'Ведомость ЗИП', rows, columns: ['name', 'qty'], fields, user: { name: 'Денис' }, onClose: vi.fn() }

describe('«Отправить запись», как Send record Airtable', () => {
  it('тема и сообщение подставлены, предпросмотр — поле под полем, письмо уходит на сервер', async () => {
    let sent = null
    server.use(
      http.get('/api/mail/status', () => HttpResponse.json({ configured: true })),
      http.post('/api/tables/3/send', async ({ request }) => { sent = await request.json(); return HttpResponse.json({ ok: true, sent: 2 }) }),
    )
    render(<SendDialog {...props} />)
    expect(screen.getByRole('dialog', { name: 'Отправить записи' })).toBeInTheDocument()
    expect(screen.getByLabelText('Тема')).toHaveValue('Денис отправил(а) 2 записи из таблицы «Ведомость ЗИП»')
    expect(screen.getByText('Кольцо')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Отправить' })
    await userEvent.type(screen.getByLabelText('Кому'), 'boss@hydro, x')
    expect(screen.getByText(/Неверный адрес/)).toBeInTheDocument()
    expect(send).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Кому'))
    await userEvent.type(screen.getByLabelText('Кому'), 'boss@hydro.ru, zam@hydro.ru')
    await userEvent.click(screen.getByLabelText('Табличный вид'))
    expect(screen.getByRole('columnheader', { name: 'Кол-во' })).toBeInTheDocument()
    await waitFor(() => expect(send).toBeEnabled())
    await userEvent.click(send)
    await waitFor(() => expect(sent).toMatchObject({ ids: [1, 2], columns: ['name', 'qty'], to: ['boss@hydro.ru', 'zam@hydro.ru'], grid: true }))
    expect(await screen.findByText(/Письмо отправлено/)).toBeInTheDocument()
  })

  it('почта не настроена — предупреждение, отправить нельзя', async () => {
    server.use(http.get('/api/mail/status', () => HttpResponse.json({ configured: false })))
    render(<SendDialog {...props} rows={[rows[0]]} />)
    expect(await screen.findByText(/Почта не настроена/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Кому'), 'boss@hydro.ru')
    expect(screen.getByRole('button', { name: 'Отправить' })).toBeDisabled()
  })
})
