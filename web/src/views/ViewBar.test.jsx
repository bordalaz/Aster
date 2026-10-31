import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import TableView from '../grid/TableView.jsx'

const QTY = 'f_fld00000000000002'
const NAME = 'f_fld00000000000001'
const admin = { id: 1, role: 'admin' }
const user = { id: 3, role: 'user' }

const views = [
  { id: 10, title: 'Много', shared: true, mine: false, config: { filters: [{ col: QTY, op: 'gt', value: '6' }] } },
  { id: 11, title: 'Из Airtable', shared: true, mine: false, config: { columns: [QTY], source: 'airtable' } },
  { id: 12, title: 'Мой', shared: false, mine: true, config: {} },
]

function setup(u = admin, vs = views) {
  const posted = []
  server.use(
    http.get('/api/tables/1/views', () => HttpResponse.json(vs)),
    http.post('/api/tables/1/views', async ({ request }) => { posted.push(await request.json()); return HttpResponse.json({ id: 99 }) }),
  )
  render(<TableView tableId={1} primaryField={NAME} user={u} />)
  return posted
}

test('выбор вида применяет его фильтры', async () => {
  setup()
  await screen.findByText('2 записи', { exact: false })
  await userEvent.selectOptions(screen.getByLabelText('Вид'), '10')
  expect(await screen.findByText('1 запись', { exact: false })).toBeInTheDocument()
  expect(screen.queryByText('не сохранено')).toBeNull()
})

test('вид из Airtable: колонки применены, предупреждение про фильтры', async () => {
  setup()
  await screen.findByText('2 записи', { exact: false })
  await userEvent.selectOptions(screen.getByLabelText('Вид'), '11')
  expect(screen.getByText(/Фильтры и сортировку Airtable не отдаёт/)).toBeInTheDocument()
  expect(screen.getByTestId('col-order').textContent).toBe(`${NAME},${QTY}`)
})

test('фильтр из панели меняет строки и отмечает «не сохранено»', async () => {
  setup()
  await screen.findByText('2 записи', { exact: false })
  await userEvent.click(screen.getByRole('button', { name: 'Фильтры' }))
  await userEvent.click(screen.getByRole('button', { name: '+ условие' }))
  await userEvent.type(screen.getByLabelText('Значение фильтра'), 'втул')
  expect(await screen.findByText('1 запись', { exact: false })).toBeInTheDocument()
  expect(screen.getByText('не сохранено')).toBeInTheDocument()
})

test('скрытие колонки из панели', async () => {
  setup()
  await screen.findByText('2 записи', { exact: false })
  await userEvent.click(screen.getByRole('button', { name: 'Колонки' }))
  await userEvent.click(screen.getByLabelText('Кол-во'))
  expect(screen.getByTestId('col-order').textContent).not.toContain(QTY)
  expect(screen.getByTestId('col-order').textContent.startsWith(NAME)).toBe(true)
})

test('«Сохранить как» — админ может сделать общий; копия вида Airtable уже не «из Airtable»', async () => {
  const posted = setup()
  await screen.findByText('2 записи', { exact: false })
  await userEvent.selectOptions(screen.getByLabelText('Вид'), '11')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }))
  await userEvent.type(screen.getByLabelText('Название вида'), 'Копия')
  await userEvent.click(screen.getByLabelText('общий'))
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  await screen.findByLabelText('Вид')
  expect(posted).toEqual([{ title: 'Копия', shared: true, config: { columns: [QTY] } }])
})

test('пользователь: общий вид не правит, «общий» не предлагается', async () => {
  setup(user)
  await screen.findByText('2 записи', { exact: false })
  await userEvent.selectOptions(screen.getByLabelText('Вид'), '10')
  expect(screen.queryByRole('button', { name: 'Удалить вид' })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить как…' }))
  expect(screen.queryByLabelText('общий')).toBeNull()
  await userEvent.selectOptions(screen.getByLabelText('Вид'), '12')
  expect(screen.getByRole('button', { name: 'Удалить вид' })).toBeInTheDocument()
})
