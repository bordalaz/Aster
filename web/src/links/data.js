import { api } from '../api.js'

// Данные для связей, кешируются на сессию вкладки; новая запись из выбора связи сбрасывает названия своей таблицы.
const once = (map, key, load) => {
  if (!map.has(key)) map.set(key, load().catch(e => { map.delete(key); throw e }))
  return map.get(key)
}

// Названия записей таблицы (первичное поле) — для поиска связанной записи и вставки связей из Excel.
const names = new Map()
const ready = new Map()   // уже загруженные — вставке нужен ответ сразу
export const linkNames = tableId => once(names, tableId, () => api(`/api/tables/${tableId}/names`).then(ns => { ready.set(tableId, ns); return ns }))
export const forgetNames = tableId => { names.delete(tableId); ready.delete(tableId) }

// Вставка в связь, как в Airtable: названия записей через запятую → [{id, name}]; не нашлось хоть одно — undefined
// (ячейку не трогаем). Название целиком с запятой внутри — тоже находится. Одна запись в поле — не больше одной.
export function matchLinkPaste(field, text) {
  const ns = ready.get(field.link_table)
  if (!ns) return undefined
  const s = String(text ?? '').trim()
  if (!s) return []
  const by = new Map()
  for (const n of ns) if (!by.has(n.name)) by.set(n.name, n)
  const parts = by.has(s) ? [s] : s.split(/\s*,\s*/).filter(Boolean)
  const found = parts.map(p => by.get(p))
  if (found.some(x => !x)) return undefined
  const list = [...new Map(found.map(n => [n.id, { id: n.id, name: n.name }])).values()]
  return field.options?.prefersSingleRecordLink && list.length > 1 ? undefined : list
}

// Поля мини-карточки, как в Airtable: первые 4 поля первого табличного вида связанной таблицы (без первичного).
const meta = new Map()
export const tableMeta = tableId => once(meta, tableId, () =>
  Promise.all([api('/api/tables'), api(`/api/tables/${tableId}/fields`), api(`/api/tables/${tableId}/views`)])
    .then(([tables, fields, views]) => {
      const primary = tables.find(t => t.id === tableId)?.primary_field
      // первый табличный вид (как в Airtable); у таймлайна/календаря колонок нет — мини-карточки были бы пустыми
      const v = views.find(x => x.kind === 'grid' && x.config?.source === 'airtable') ?? views.find(x => x.kind === 'grid') ?? views[0]
      const order = v?.config?.columns?.length ? v.config.columns : fields.map(f => f.column_name)
      return order.filter(c => c !== primary).map(c => fields.find(f => f.column_name === c)).filter(Boolean).slice(0, 4)
    }))

// «Создать запись» из выбора связи, как в Airtable: новая запись в связанной таблице; первичное поле — текст поиска,
// если его можно править (у формул — нет). Карточка новой записи открывается поверх (links/RecordHost.jsx).
export async function createLinked(field, query) {
  const t = field.link_table
  const { id, updated_at } = await api(`/api/tables/${t}/records`, { method: 'POST' })
  const [tables, fields] = await Promise.all([api('/api/tables'), api(`/api/tables/${t}/fields`)])
  const primary = fields.find(f => f.column_name === tables.find(x => x.id === t)?.primary_field)
  const name = query.trim()
  if (name && primary?.editable && primary.kind === 'singleLineText') {
    await api(`/api/tables/${t}/records/${id}`, { method: 'PATCH', body: { updated_at, values: { [primary.column_name]: name } } })
  }
  forgetNames(t)
  return { id, name: primary?.editable ? name : '' }
}

// Открыть карточку записи другой таблицы поверх текущего экрана; после закрытия таблицы перечитываются.
export const openRecord = (tableId, id) => window.dispatchEvent(new CustomEvent('aster:open-record', { detail: { tableId, id } }))
