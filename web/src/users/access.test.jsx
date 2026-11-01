import { expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import App from '../App.jsx'
import Users from './Users.jsx'

const users = [
  { id: 1, login: 'boss', name: 'Босс', role: 'superadmin', blocked: false, must_change_password: false },
  { id: 2, login: 'ivan', name: 'Иван', role: 'admin', blocked: false, must_change_password: false },
  { id: 3, login: 'petr', name: 'Пётр', role: 'user', blocked: false, must_change_password: true },
]

test('временный пароль — сначала смена пароля, потом рабочий экран (E3)', async () => {
  let must = true
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json({ id: 3, login: 'petr', name: 'Пётр', role: 'user', must_change_password: must })),
    http.post('/api/auth/password', async ({ request }) => {
      const b = await request.json()
      if (b.old !== 'temp-pass-1') return HttpResponse.json({ detail: 'x' }, { status: 403 })
      must = false
      return HttpResponse.json({ ok: true })
    }),
  )
  render(<App />)
  expect(await screen.findByText(/временным паролем/)).toBeInTheDocument()
  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'temp-pass-1')
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'my-own-pass')
  await userEvent.type(screen.getByLabelText('Новый пароль ещё раз'), 'my-own-pass')
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
  expect(await screen.findByRole('tab', { name: 'Ведомость ЗИП' })).toBeInTheDocument()
})

test('несовпадающие пароли не отправляются', async () => {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 3, login: 'p', name: 'П', role: 'user', must_change_password: true })))
  render(<App />)
  await screen.findByText(/временным паролем/)
  await userEvent.type(screen.getByLabelText('Текущий пароль'), 'x')
  await userEvent.type(screen.getByLabelText('Новый пароль'), 'aaaaaaaa')
  await userEvent.type(screen.getByLabelText('Новый пароль ещё раз'), 'bbbbbbbb')
  await userEvent.click(screen.getByRole('button', { name: 'Сменить пароль' }))
  expect(screen.getByText('Пароли не совпадают')).toBeInTheDocument()
})

test('вход вне офиса — сообщение сервера (E2)', async () => {
  server.use(
    http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })),
    http.post('/api/auth/login', () => HttpResponse.json({ detail: 'Вход вне офиса доступен только администраторам' }, { status: 403 })),
  )
  render(<App />)
  await userEvent.type(await screen.findByLabelText('Логин'), 'petr')
  await userEvent.type(screen.getByLabelText('Пароль'), 'x')
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByText('Вход вне офиса доступен только администраторам')).toBeInTheDocument()
})

test('кнопка «Пользователи» — только админам', async () => {
  server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 3, login: 'petr', name: 'Пётр', role: 'user', must_change_password: false })))
  render(<App />)
  await screen.findByRole('tab', { name: 'Ведомость ЗИП' })
  expect(screen.queryByRole('button', { name: 'Пользователи' })).toBeNull()
})

test('админ: суперадмина и себя не трогает, пользователя — может; создаёт с временным паролем', async () => {
  let created = null
  server.use(
    http.get('/api/users', () => HttpResponse.json(users)),
    http.post('/api/users', async ({ request }) => { created = await request.json(); return HttpResponse.json({ id: 9 }) }),
  )
  render(<Users me={{ id: 2, role: 'admin' }} />)
  const boss = (await screen.findByText('boss')).closest('tr')
  expect(within(boss).queryByRole('button')).toBeNull()
  expect(within(screen.getByText('ivan').closest('tr')).queryByRole('button')).toBeNull()
  const petr = screen.getByText('petr').closest('tr')
  expect(within(petr).getByRole('button', { name: 'Заблокировать' })).toBeInTheDocument()
  // админ не может назначить админа — в списке ролей его нет
  expect(within(petr).queryByRole('option', { name: 'Админ' })).toBeNull()

  await userEvent.type(screen.getByLabelText('Логин'), 'new')
  await userEvent.type(screen.getByLabelText('ФИО'), 'Новый')
  await userEvent.type(screen.getByLabelText('Временный пароль'), 'temp-pass-1')
  await userEvent.click(screen.getByRole('button', { name: 'Создать' }))
  await screen.findByText('boss')
  expect(created).toEqual({ login: 'new', name: 'Новый', role: 'user', password: 'temp-pass-1' })
})

test('отказ сервера показывается текстом', async () => {
  server.use(
    http.get('/api/users', () => HttpResponse.json(users)),
    http.patch('/api/users/3', () => HttpResponse.json({ detail: 'Суперадмина изменить нельзя' }, { status: 403 })),
  )
  render(<Users me={{ id: 2, role: 'admin' }} />)
  const petr = (await screen.findByText('petr')).closest('tr')
  await userEvent.click(within(petr).getByRole('button', { name: 'Заблокировать' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Суперадмина изменить нельзя')
})

test('доступ к финансам: галочку видит и меняет только суперадмин; у админов — всегда есть', async () => {
  let patched = null
  server.use(
    http.get('/api/users', () => HttpResponse.json(users)),
    http.patch('/api/users/3', async ({ request }) => { patched = await request.json(); return HttpResponse.json({ ok: true }) }),
  )
  const { unmount } = render(<Users me={{ id: 2, role: 'admin' }} />)
  await screen.findByText('petr')
  expect(screen.queryByLabelText('Финансы petr')).toBeNull()
  unmount()

  render(<Users me={{ id: 1, role: 'superadmin' }} />)
  await screen.findByText('petr')
  expect(screen.queryByLabelText('Финансы ivan')).toBeNull()   // админ видит финансы по роли
  await userEvent.click(screen.getByLabelText('Финансы petr'))
  await screen.findByText('petr')
  expect(patched).toEqual({ finance_access: true })
})
