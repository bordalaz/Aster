// Две таблицы: обычное поле каждого типа + одно виртуальное (связь) для проверки, что его отбрасывают.
export const tables = [
  { id: 1, title: 'Ведомость ЗИП', primary_field: 'f_fld00000000000001' },
  { id: 2, title: 'Оборудование', primary_field: 'f_fld00000000000010' },
]

export const fields1 = [
  { id: 101, column_name: 'f_fld00000000000001', title: 'Наименование', kind: 'singleLineText', editable: true, options: {} },
  { id: 102, column_name: 'f_fld00000000000002', title: 'Кол-во', kind: 'number', editable: true, options: {} },
  { id: 103, column_name: 'f_fld00000000000003', title: 'На складе', kind: 'checkbox', editable: true, options: {} },
  { id: 104, column_name: 'f_fld00000000000004', title: 'Статус', kind: 'singleSelect', editable: true,
    options: { choices: [{ id: 's1', name: 'На складе', color: 'blue' }, { id: 's2', name: 'Брак', color: 'red' }] } },
  { id: 105, column_name: 'f_fld00000000000005', title: '№', kind: 'autoNumber', editable: false, options: {} },
  { id: 106, column_name: 'f_fld00000000000006', title: 'Связь', kind: 'multipleRecordLinks', editable: false, options: { virtual: true } },
]

export const records1 = [
  { id: 1, updated_at: '2026-10-31T10:00:00+00:00', f_fld00000000000001: 'Кольцо', f_fld00000000000002: 5, f_fld00000000000003: true, f_fld00000000000004: 'На складе', f_fld00000000000005: 1 },
  { id: 2, updated_at: '2026-10-31T10:05:00+00:00', f_fld00000000000001: 'Втулка', f_fld00000000000002: 7, f_fld00000000000003: false, f_fld00000000000004: 'Брак', f_fld00000000000005: 2 },
]

export const me = { id: 1, login: 'ivan', name: 'Иван', role: 'admin' }
