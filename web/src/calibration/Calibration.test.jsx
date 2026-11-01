import { expect, test } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import Calibration, { due } from './Calibration.jsx'
import CalibrationList from './CalibrationList.jsx'

test('срок калибровки (R20): год; ≤ 5 дней — оранжевый, прошёл — красный, иначе «осталось N дн.»', () => {
  const today = new Date('2026-11-01')
  expect(due('2025-10-30', today)).toMatchObject({ tone: 'red' })
  expect(due('2025-11-04', today)).toMatchObject({ tone: 'orange', text: 'осталось 3 дн.' })
  expect(due('2026-05-01', today)).toMatchObject({ tone: 'gray', text: 'осталось 181 дн.' })
})

const eq = {
  mirs: [{ id: 1, name: 'МИР_№_99', size: null }],
  housings: [{ id: 2, name: 'Кожух резистивиметра 121/130/З-102_№_145', size: '4.75' }],
  singles: [{ id: 3, name: 'Инклинометр_№_12', size: null }],
  unknown_sizes: ['190/203'],
}

function setup(user = { role: 'user' }) {
  const posts = []
  server.use(
    http.get('/api/calibration/equipment', () => HttpResponse.json(eq)),
    http.get('/api/calibration/matrix', () => HttpResponse.json({
      mirs: eq.mirs, housings: eq.housings, cells: [{ mir: 1, housing: 2, date: '2025-06-01', count: 2, id: 40 }],
    })),
    http.get('/api/calibrations', () => HttpResponse.json([{ id: 40, date: '2025-06-01', equipment: { id: 1, name: 'МИР_№_99' },
      housing: { id: 2, name: 'Кожух…145' }, note: null, by: 'Мастер', files: [{ id: 7, name: 'МИР-099_КОЖУХ-145_4.75_2025-06-01.cal', size: 10, mime: 'application/octet-stream' }] }])),
    http.post('/api/uploads', () => HttpResponse.json({ id: 50, name: 'x.cal', size: 3 })),
    http.post('/api/calibrations', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ id: 41 }) }),
    http.put('/api/calibration/sizes', async ({ request }) => { posts.push(await request.json()); return HttpResponse.json({ ok: true }) }),
  )
  render(<Calibration user={user} />)
  return posts
}

test('пара МИР × кожух: кожух обязателен, файлы уходят id, после записи — сообщение', async () => {
  const posts = setup()
  await userEvent.selectOptions(await screen.findByLabelText('Прибор'), '1')
  await userEvent.click(screen.getByRole('button', { name: 'Записать калибровку' }))
  expect(screen.getByRole('alert')).toHaveTextContent('Выберите кожух')
  await userEvent.selectOptions(screen.getByLabelText('Кожух'), '2')
  await userEvent.upload(screen.getByLabelText('Файлы: Файлы калибровки'), new File(['x'], 'x.cal'))
  await screen.findByRole('link', { name: 'x.cal' })
  await userEvent.click(screen.getByRole('button', { name: 'Записать калибровку' }))
  expect(await screen.findByText('Калибровка записана')).toBeInTheDocument()
  expect(posts[0]).toMatchObject({ equipment_id: 1, housing_id: 2, files: [50] })
  expect(posts[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
})

test('одиночный прибор (R23): только дата — без кожуха и файлов', async () => {
  const posts = setup()
  await userEvent.selectOptions(await screen.findByLabelText('Прибор'), '3')
  expect(screen.queryByLabelText('Кожух')).toBeNull()
  expect(screen.queryByLabelText('Файлы: Файлы калибровки')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Записать калибровку' }))
  await screen.findByText('Калибровка записана')
  expect(posts[0]).toMatchObject({ equipment_id: 3, files: [] })
  expect(posts[0].housing_id).toBeUndefined()
})

test('матрица: дата пары, «+1» при нескольких, клик открывает калибровку с файлами', async () => {
  setup()
  const cell = await screen.findByRole('button', { name: /2025-06-01/ })
  expect(cell).toHaveTextContent('+1')
  await userEvent.click(cell)
  expect(await screen.findByRole('link', { name: 'МИР-099_КОЖУХ-145_4.75_2025-06-01.cal' })).toBeInTheDocument()
})

test('админ видит подсказку про неизвестный габарит и добавляет его (E14)', async () => {
  const posts = setup({ role: 'admin' })
  const hint = await screen.findByText(/Добавьте габарит для 190\/203/)
  await userEvent.type(within(hint.closest('div')).getByLabelText('Габарит 190/203'), '7')
  await userEvent.click(within(hint.closest('div')).getByRole('button', { name: 'Сохранить' }))
  await screen.findByLabelText('Прибор')
  expect(posts.at(-1)).toEqual({ pattern: '190/203', size: '7' })
})

test('пользователь подсказку про габарит не видит', async () => {
  setup()
  await screen.findByLabelText('Прибор')
  expect(screen.queryByText(/Добавьте габарит/)).toBeNull()
})

test('карточка прибора: список калибровок с файлами; пусто — ничего', async () => {
  setup()
  const { unmount } = render(<CalibrationList equipmentId={1} />)
  expect(await screen.findAllByText(/Кожух…145/)).not.toHaveLength(0)
  unmount()
  server.use(http.get('/api/calibrations', () => HttpResponse.json([])))
  const { container } = render(<CalibrationList equipmentId={9} />)
  await new Promise(r => setTimeout(r, 20))
  expect(container.textContent).toBe('')
})
