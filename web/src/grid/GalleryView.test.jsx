import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import GalleryView from './GalleryView.jsx'

const fields = [
  { column_name: 'pn', title: 'P/N', kind: 'singleLineText' },
  { column_name: 'name', title: 'Наименование', kind: 'singleLineText' },
  { column_name: 'shelf', title: 'Полка', kind: 'singleSelect', options: { choices: [{ name: '2', color: 'purpleLight1' }] } },
  { column_name: 'foto', title: 'Фото', kind: 'multipleAttachments' },
]
const rows = [
  { id: 1, pn: '10235', name: 'Клапан', shelf: '2', foto: [{ id: 'a', name: 'a.jpg', mime: 'image/jpeg' }] },
  { id: 2, pn: '10255', name: 'Заглушка', shelf: null, foto: [] },
  { id: 3, pn: '99999', name: 'Скрыт фильтром', shelf: '2', foto: [] },
]
const config = { columns: ['pn', 'name', 'shelf'], cover: 'foto', rowOrder: [2, 1, 3], filters: [{ col: 'pn', op: 'contains', value: '102' }] }

describe('вид-галерея', () => {
  it('карточки: обложка, заголовок, поля с подписями; фильтр и ручной порядок вида; щелчок открывает запись', async () => {
    const onOpen = vi.fn()
    render(<GalleryView fields={fields} rows={rows} primaryField="pn" config={config} onOpen={onOpen} />)
    const names = screen.getAllByRole('button', { name: /^10/ }).map(b => b.textContent)
    expect(names).toEqual(['10255', '10235'])   // rowOrder; 99999 отфильтрована
    const card = screen.getByRole('button', { name: '10235' }).closest('article')
    expect(within(card).getByRole('img', { name: 'a.jpg' })).toBeInTheDocument()
    expect(within(card).getByText('Наименование')).toBeInTheDocument()
    expect(within(card).getByText('2')).toBeInTheDocument()
    expect(screen.getByLabelText('Полка: пусто')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '10235' }))
    expect(onOpen).toHaveBeenCalledWith(rows[0], [2, 1])
  })
  it('поиск из панели вида', () => {
    render(<GalleryView fields={fields} rows={rows} primaryField="pn" config={config} search="клапан" onOpen={() => {}} />)
    expect(screen.getByRole('button', { name: '10235' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '10255' })).toBeNull()
  })
})
