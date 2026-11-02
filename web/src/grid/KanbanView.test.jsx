import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import KanbanView from './KanbanView.jsx'

const fields = [
  { column_name: 'name', title: 'Рейс', kind: 'singleLineText', editable: true },
  { column_name: 'st', title: 'Статус', kind: 'singleSelect', editable: true,
    options: { choices: [{ name: 'Планируется', color: 'yellowLight2' }, { name: 'В работе', color: 'greenLight2' }, { name: 'Закончен', color: 'grayLight2' }] } },
]
const rows = [
  { id: 1, name: 'Р-1', st: 'Закончен' }, { id: 2, name: 'Р-2', st: 'Планируется' }, { id: 3, name: 'Р-3', st: 'Закончен' },
]
const col = name => screen.getByRole('group', { name })
const dt = { setData() {}, effectAllowed: '' }

describe('канбан', () => {
  it('колонки — варианты по порядку, первой «Без категории»; число карточек; hideEmpty скрывает пустые', () => {
    const { rerender } = render(<KanbanView fields={fields} rows={rows} primaryField="name" config={{ stack: 'st' }} onOpen={() => {}} />)
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Без категории', 'Планируется', 'В работе', 'Закончен'])
    expect(within(col('Закончен')).getByText('2')).toBeInTheDocument()
    expect(within(col('Закончен')).getAllByRole('button', { name: /^Р-/ }).map(b => b.textContent)).toEqual(['Р-1', 'Р-3'])
    rerender(<KanbanView fields={fields} rows={rows} primaryField="name" config={{ stack: 'st', hideEmpty: true }} onOpen={() => {}} />)
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Планируется', 'Закончен'])
  })
  it('перетаскивание в другую колонку меняет значение; с ручным порядком — встаёт перед карточкой', () => {
    const onMove = vi.fn()
    render(<KanbanView fields={fields} rows={rows} primaryField="name" config={{ stack: 'st', rowOrder: [1, 2, 3] }} onOpen={() => {}}
      canEdit canReorder onMove={onMove} />)
    const card = screen.getByRole('button', { name: 'Р-2' }).closest('article')
    const target = screen.getByRole('button', { name: 'Р-3' }).closest('article')
    fireEvent.dragStart(card, { dataTransfer: dt })
    fireEvent.dragOver(target, { dataTransfer: dt })
    fireEvent.drop(col('Закончен'), { dataTransfer: dt })
    expect(onMove).toHaveBeenCalledWith(rows[1], 'Закончен', [1, 2, 3])
    fireEvent.dragStart(card, { dataTransfer: dt })
    fireEvent.dragOver(col('В работе'), { dataTransfer: dt })
    fireEvent.drop(col('В работе'), { dataTransfer: dt })
    expect(onMove).toHaveBeenLastCalledWith(rows[1], 'В работе', null)
  })
  it('без прав — не перетаскивается; «Добавить запись» — в эту колонку', async () => {
    const onAdd = vi.fn()
    render(<KanbanView fields={fields} rows={rows} primaryField="name" config={{ stack: 'st' }} onOpen={() => {}} onAdd={onAdd} />)
    expect(screen.getByRole('button', { name: 'Р-2' }).closest('article')).not.toHaveAttribute('draggable')
    await userEvent.click(within(col('В работе')).getByRole('button', { name: 'Добавить запись' }))
    expect(onAdd).toHaveBeenCalledWith('В работе')
  })
})
