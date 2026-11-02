import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { parseDateText } from '../grid/cells.js'
import DatePicker from './DatePicker.jsx'

const local = { dateFormat: { name: 'local' } }
const day = { kind: 'date', title: 'Дата', options: local }
const utc = { kind: 'dateTime', title: 'Начало', options: { ...local, timeFormat: { name: '24hour' }, timeZone: 'utc' } }

describe('выбор даты', () => {
  it('дата: ввод «5.3.2018» и Enter — сохранить; щелчок по дню — выбрать и закрыть', async () => {
    const onDone = vi.fn()
    render(<DatePicker field={day} value="2018-03-23" onChange={() => {}} onDone={onDone} />)
    expect(screen.getByRole('textbox', { name: 'Дата' })).toHaveValue('23.3.2018')
    expect(screen.getByRole('button', { name: '23 Март 2018' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: '7 Март 2018' }))
    expect(onDone).toHaveBeenLastCalledWith('2018-03-07')
    await userEvent.clear(screen.getByRole('textbox', { name: 'Дата' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Дата' }), '5.3.2018{Enter}')
    expect(onDone).toHaveBeenLastCalledWith('2018-03-05')
  })
  it('неверная дата подсвечивается и не сохраняется; стрелка листает месяц', async () => {
    const onDone = vi.fn()
    render(<DatePicker field={day} value={null} onChange={() => {}} onDone={onDone} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Дата' }), '31.2.2018{Enter}')
    expect(screen.getByRole('textbox', { name: 'Дата' })).toHaveAttribute('aria-invalid', 'true')
    expect(onDone).not.toHaveBeenCalled()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Дата' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Дата' }), '1.12.2018')
    await userEvent.click(screen.getByRole('button', { name: 'Следующий месяц' }))
    expect(screen.getByRole('grid', { name: 'Январь 2019' })).toBeInTheDocument()
  })
  it('дата со временем в UTC: правка времени и Enter → ISO', async () => {
    const onDone = vi.fn()
    render(<DatePicker field={utc} value="2018-03-23T20:30:00.000Z" onChange={() => {}} onDone={onDone} />)
    const time = screen.getByRole('textbox', { name: 'Время' })
    expect(time).toHaveValue('20:30')
    await userEvent.clear(time)
    await userEvent.type(time, '21:05{Enter}')
    expect(onDone).toHaveBeenLastCalledWith('2018-03-23T21:05:00.000Z')
  })
  it('вставка из Excel разбирает формат поля', () => {
    expect(parseDateText(day, '23.3.2018')).toBe('2018-03-23')
    expect(parseDateText(utc, '23.3.2018 20:30')).toBe('2018-03-23T20:30:00.000Z')
    expect(parseDateText(day, 'вчера')).toBeUndefined()
    expect(parseDateText(day, '')).toBeNull()
  })
})
