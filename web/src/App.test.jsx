import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from './test/server.js'
import App from './App.jsx'

test('залогинен — виден список таблиц', async () => {
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Ведомость ЗИП' })).toBeInTheDocument()
})

test('не залогинен (401 на /me) — виден экран входа', async () => {
  server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })))
  render(<App />)
  expect(await screen.findByLabelText('Логин')).toBeInTheDocument()
})

test('вход по паролю показывает рабочий экран', async () => {
  server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })))
  render(<App />)
  await screen.findByLabelText('Логин')
  await userEvent.type(screen.getByLabelText('Логин'), 'ivan')
  await userEvent.type(screen.getByLabelText('Пароль'), 'secret')
  // после входа /me снова отвечает (дефолтный хендлер) — грузим реальную сессию
  server.resetHandlers()
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByRole('button', { name: 'Ведомость ЗИП' })).toBeInTheDocument()
})
