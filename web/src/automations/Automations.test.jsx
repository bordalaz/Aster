import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { expect, test } from 'vitest'
import { server } from '../test/server.js'
import Automations from './Automations.jsx'

const base = { table: 'Оборудование', trigger: 'т', action: 'д', settings: {}, runs: [], scheduled: false }
test('список, переключение, журнал и «Запустить сейчас» у расписания', async () => {
  const sent = []
  let on = true
  server.use(
    http.get('/api/automations', () => HttpResponse.json([
      { ...base, key: 'defektoskopiya', title: 'Дефектоскопия', state: 'live', enabled: on, scheduled: true,
        runs: [{ at: '2026-11-03T06:12:22Z', ok: true, message: 'Изменено «Срок НК»: 7' }] },
      { ...base, key: 'zip_foto', title: 'Cope&Paste photo ЗИП', state: 'buttons', enabled: false, note: 'Заменена кнопкой «Фото+»' }])),
    http.patch('/api/automations/:k', async ({ request }) => { const b = await request.json(); sent.push(b); on = b.enabled; return HttpResponse.json({ ok: true }) }),
    http.post('/api/automations/:k/run', () => { sent.push('run'); return HttpResponse.json({ ok: true, message: 'ok' }) }),
  )
  render(<Automations />)
  expect(await screen.findByRole('heading', { name: 'Дефектоскопия' })).toBeTruthy()
  expect(screen.getByText('Изменено «Срок НК»: 7')).toBeTruthy()
  await userEvent.click(screen.getByRole('checkbox'))
  await userEvent.click(screen.getByRole('button', { name: 'Запустить сейчас' }))
  expect(sent).toEqual([{ enabled: false }, 'run'])
  await userEvent.click(screen.getByRole('button', { name: /Cope&Paste photo ЗИП/ }))
  expect(screen.getByText('Заменена кнопкой «Фото+»')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull()   // заменённую кнопками не включают
})
