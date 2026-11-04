import { api } from '../api.js'

// Данные для связей, кешируются на сессию вкладки (новые записи увидит перезагрузка).
// ponytail: кеш без сброса — названия и поля таблиц меняются редко
const once = (map, key, load) => {
  if (!map.has(key)) map.set(key, load().catch(e => { map.delete(key); throw e }))
  return map.get(key)
}

// Названия записей таблицы (первичное поле) — для поиска связанной записи.
const names = new Map()
export const linkNames = tableId => once(names, tableId, () => api(`/api/tables/${tableId}/names`))

// Поля мини-карточки, как в Airtable: первые 4 поля первого общего вида связанной таблицы (без первичного).
const meta = new Map()
export const tableMeta = tableId => once(meta, tableId, () =>
  Promise.all([api('/api/tables'), api(`/api/tables/${tableId}/fields`), api(`/api/tables/${tableId}/views`)])
    .then(([tables, fields, views]) => {
      const primary = tables.find(t => t.id === tableId)?.primary_field
      const order = views[0]?.config?.columns ?? fields.map(f => f.column_name)
      return order.filter(c => c !== primary).map(c => fields.find(f => f.column_name === c)).filter(Boolean).slice(0, 4)
    }))
