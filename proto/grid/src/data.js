// ponytail: синтетика по форме Ведомости ЗИП; реальные данные — после скрипта переноса
export const STATUSES = ['Списано', 'Заказано', 'Получено', 'На складе', 'Брак']
export const cols = [
  { id: 'id', title: 'ID', width: 90 },
  { id: 'pn', title: 'P/N', width: 120 },
  { id: 'name', title: 'Наименование', width: 260 },
  { id: 'qty', title: 'Кол-во', width: 80, num: true },
  { id: 'date', title: 'Дата', width: 100 },
  { id: 'status', title: 'Статус', width: 110 },
  { id: 'spec', title: 'Спецификация', width: 160 },
  { id: 'rack', title: 'Стеллаж', width: 80 },
  { id: 'shelf', title: 'Полка', width: 70 },
]
const words = ['Уплотнение', 'Кольцо', 'Втулка', 'Плата', 'Датчик', 'Корпус', 'Пружина', 'Разъём', 'Вал', 'Подшипник']
export function makeRows(n = 13580) {
  const r = []
  for (let i = 0; i < n; i++) r.push({
    id: 'VZ-' + (i + 1),
    pn: 'PN' + ((i * 7919) % 99991),
    name: words[i % 10] + ' ' + words[(i * 3) % 10].toLowerCase() + ' ' + (i % 97),
    qty: (i * 13) % 50,
    date: new Date(2020, 0, 1 + (i % 2100)).toISOString().slice(0, 10),
    status: STATUSES[i % 5],
    spec: 'Ремонт ССК-Т №' + (i % 2513),
    rack: String.fromCharCode(65 + (i % 8)),
    shelf: (i % 6) + 1,
  })
  return r
}
