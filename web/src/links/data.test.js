import { expect, test } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../test/server.js'
import { linkNames, matchLinkPaste } from './data.js'

test('вставка в связь: названия через запятую → записи; не нашлось — ячейку не трогаем; одна запись — не больше одной', async () => {
  server.use(http.get('/api/tables/9/names', () => HttpResponse.json([
    { id: 1, name: 'Пенал_№_2' }, { id: 2, name: 'Корпус батареи_№_4288' }, { id: 3, name: 'Адаптер, длинный' }])))
  const f = { link_table: 9, options: {} }
  expect(matchLinkPaste(f, 'Пенал_№_2')).toBeUndefined()   // названия ещё не загружены
  await linkNames(9)
  expect(matchLinkPaste(f, 'Пенал_№_2, Корпус батареи_№_4288')).toEqual([{ id: 1, name: 'Пенал_№_2' }, { id: 2, name: 'Корпус батареи_№_4288' }])
  expect(matchLinkPaste(f, 'Адаптер, длинный')).toEqual([{ id: 3, name: 'Адаптер, длинный' }])   // запятая внутри названия
  expect(matchLinkPaste(f, 'Пенал_№_2, нет такого')).toBeUndefined()
  expect(matchLinkPaste(f, '')).toEqual([])
  expect(matchLinkPaste({ link_table: 9, options: { prefersSingleRecordLink: true } }, 'Пенал_№_2, Корпус батареи_№_4288')).toBeUndefined()
})
