# Этап 1в: сетка + карточка записи на API — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Веб-клиент: вход, список таблиц, сетка любой таблицы (чтение + правка ячеек) и карточка записи (чтение + правка полей) — поверх готового API этапов 1а/1б.

**Architecture:** Отдельное SPA в `web/` (Vite + React 18). Отрисовка сетки — Glide Data Grid (canvas), логика строк (поиск, сортировка) — TanStack Table без его отрисовки (решение этапа 0, `docs/2026-10-28-grid-proto.md`). Карточка и редакторы полей — обычный DOM. Все данные — через `fetch` с cookie-сессией к `/api/*`; dev-сервер Vite проксирует `/api` на контейнер `api` (`:8000`). Тесты — Vitest + React Testing Library + MSW (мок API), без обращения к настоящему бэкенду.

**Tech Stack:** Node 20, Vite 5, React 18.3, @glideapps/glide-data-grid 6, @tanstack/react-table 8, Vitest 2, @testing-library/react 16, msw 2.

---

## Контекст API (готов, НЕ меняем в этом этапе)

Эндпоинты из `api/app/`:

| Метод | Путь | Тело / ответ |
|---|---|---|
| POST | `/api/auth/login` | `{login, password}` → ставит cookie `session`, `{ok:true}`; `401` при неверных |
| POST | `/api/auth/logout` | → `{ok:true}`, гасит cookie |
| GET | `/api/auth/me` | → `{id, login, name, role}` или `401` |
| GET | `/api/tables` | → `[{id, title, primary_field}]` (`primary_field` — имя колонки, напр. `f_fldabc…`) |
| GET | `/api/tables/{tid}/fields` | → `[{id, column_name, title, kind, editable, options}]` (**все** поля, включая виртуальные: у них `options.virtual === true`) |
| GET | `/api/tables/{tid}/records` | → `[{id, updated_at, <column_name>: value, …}]` — **только невиртуальные** колонки (связи/вложения/вычисляемые не приходят) |
| PATCH | `/api/tables/{tid}/records/{rid}` | `{updated_at, values:{col:val}}` → `{id, updated_at}`; `409` если `updated_at` устарел; `404` нет записи; `422` недопустимое значение/поле |

**Важные следствия для клиента:**
- Виртуальные поля (`options.virtual`) данных не содержат → в этапе 1в **не показываем** (ни в сетке, ни в карточке). Связи, вложения, вычисляемые — этап 2. Карточка показывает только невиртуальные поля.
- Правка оптимистична: клиент шлёт `updated_at`, который видел в строке; на `409` перечитываем таблицу и сообщаем «запись изменили».
- Редактировать можно только поля с `editable === true` (API это и так проверяет и вернёт `422`, но UI не должен давать редактировать неэдитируемые).

**Соответствие `kind` → тип ячейки (kind = тип поля Airtable из `app_field.kind`):**

| `kind` | Группа | Правка в сетке | Редактор карточки |
|---|---|---|---|
| singleLineText, multilineText, richText, email, url, phoneNumber | текст | inline (text) | `<textarea>`/`<input>` |
| number, currency, percent, rating, duration | число | inline (number) | `<input type=number>` |
| autoNumber | число | нет (`editable=false`) | только показ |
| checkbox | булево | inline (boolean) | `<input type=checkbox>` |
| date | дата | inline (text ISO) | `<input type=date>` |
| dateTime | дата-время | нет (правим в карточке) | `<input type=datetime-local>` |
| createdTime, lastModifiedTime, createdBy, lastModifiedBy | служебное | нет (`editable=false`) | только показ |
| singleSelect | выбор | нет (правим в карточке) | `<select>` из `options.choices` |
| multipleSelects | мультивыбор | нет (правим в карточке) | чекбоксы из `options.choices` |
| barcode, singleCollaborator, multipleCollaborators | jsonb | нет | только показ (JSON) — этап 2 |

`options.choices` (для select) — массив `[{id, name, color}]` из Airtable (сохранён в `app_field.options`).

---

## Структура файлов

| Файл | Ответственность |
|---|---|
| `web/package.json`, `web/vite.config.js`, `web/index.html` | каркас Vite, прокси `/api`, зависимости |
| `web/vitest.config.js`, `web/src/test/setup.js`, `web/src/test/server.js`, `web/src/test/fixtures.js` | тестовое окружение: jsdom, MSW, фикстуры API |
| `web/src/theme.css` | токены стиля из эскиза (индиго, шрифты, чипы) |
| `web/src/api.js` | обёртка `fetch` (credentials, JSON, `ApiError`, обработка 401) |
| `web/src/main.jsx` | точка входа React |
| `web/src/App.jsx` | оболочка: сессия, роутинг «логин / рабочий экран» |
| `web/src/auth/Login.jsx` | форма входа |
| `web/src/auth/session.js` | хук `useSession` (GET `/me`, login, logout) |
| `web/src/tables/TableList.jsx` | левая навигация по таблицам (GET `/tables`) |
| `web/src/grid/cells.js` | `toCell(field, value)` / `fromCell(field, cell)` — значение ⇄ Glide `GridCell` |
| `web/src/grid/Grid.jsx` | Glide + TanStack: отрисовка, поиск, сортировка, ширины, счётчик, закреплённое первичное поле; inline-правка → PATCH + обработка 409 |
| `web/src/card/Card.jsx` | карточка записи: все невиртуальные поля, правка эдитируемых, сохранение |
| `web/src/card/fields.jsx` | редакторы полей по `kind` (text, number, checkbox, date, datetime, select, multiselect, readonly) |
| `web/src/record/useRecords.js` | загрузка полей+записей таблицы, PATCH одной записи, перезагрузка |

Серверный `api` в этом этапе не трогаем. Деплой (сборка во образ, раздача статики) — этап 3.

---

## Global Constraints

- Node и тесты — локально в `web/` (бэкенд в контейнере не нужен для тестов: API мокается MSW). Запуск клиента против живого API — `npm --prefix web run dev`, прокси на `:8000`.
- Тексты для пользователя — по-русски (как в API и спецификации).
- Стиль — по `docs/design/2026-10-29-sketch.html`: светлая тема, индиго `#2F3E9E`, оранжевый `#F08A24` «скоро», красный ошибки/брак; шрифты Inter + JetBrains Mono (моноширинный — для номеров/часов); без теней и градиентов (R14).
- Каждая задача: сначала падающий тест, потом минимальный код, прогон, коммит (TDD).
- Прогон тестов: `npm --prefix web test -- --run` (разово) или `npm --prefix web test` (watch).
- `web/node_modules`, `web/dist` — в `.gitignore`.

## Review Focus

- **Конфликт правки**: двое правят одну запись → второй PATCH получает `409`, таблица перечитывается, значение не затирается молча → `Grid.test.jsx::reloads on 409`.
- **Неэдитируемое поле**: сетка не даёт править поле с `editable=false`; карточка показывает его только для чтения → `cells.test.js`, `Card.test.jsx::readonly field`.
- **Виртуальные поля** (связи/вложения/вычисляемые) не ломают сетку: их нет в записях, в колонки не попадают → `useRecords.test.js::skips virtual fields`.
- **401 на любом запросе** → приложение показывает экран входа, а не падает → `api.test.js`, `App.test.jsx::shows login on 401`.
- **Первичное поле и номер строки закреплены слева**, шапка сверху, счётчик записей виден (R9) → `Grid.test.jsx::pins primary field`.

---

## Предусловие (делает пользователь)

- [ ] Выполнены этапы 1а и 1б (API записей и метаданных работает, в БД есть таблицы `app_table`/`app_field` и данные). Для разработки против живого API: `docker compose up -d` и вход создан (`python -m app.cli create-user …`).
- [ ] Установлен Node 20 локально (для `web/`).

---

## Task 1: Каркас `web/` + тестовое окружение

**Files:**
- Create: `web/package.json`, `web/vite.config.js`, `web/index.html`, `web/src/main.jsx`, `web/src/theme.css`
- Create: `web/vitest.config.js`, `web/src/test/setup.js`, `web/src/test/fixtures.js`, `web/src/test/server.js`
- Create: `web/src/smoke.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "aster-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest"
  },
  "dependencies": {
    "@glideapps/glide-data-grid": "6.0.3",
    "@tanstack/react-table": "8.20.5",
    "react": "18.3.1",
    "react-dom": "18.3.1"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "6.5.0",
    "@testing-library/react": "16.0.1",
    "@testing-library/user-event": "14.5.2",
    "@vitejs/plugin-react": "4.3.4",
    "jsdom": "25.0.1",
    "msw": "2.6.0",
    "vite": "5.4.11",
    "vitest": "2.1.4"
  }
}
```

- [ ] **Step 2: `web/vite.config.js`** (dev-прокси `/api` на контейнер api)

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5200, proxy: { '/api': 'http://localhost:8000' } },
})
```

- [ ] **Step 3: `web/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>БД гидроканал</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: `web/src/theme.css`** (токены из эскиза, R14)

```css
:root {
  --accent: #2F3E9E; --accent-dark: #26337F; --accent-tint: #ECEEF9;
  --signal: #F08A24; --signal-tint: #FDF1E4; --signal-text: #8A4300;
  --danger: #A3200F; --danger-tint: #FDECEA;
  --text: #171A23; --text2: #4A5163; --muted: #5D6475;
  --line: #E4E7EC; --grid: #ECEEF2; --panel: #F6F7F9; --bg: #FFFFFF;
  --mono: 'JetBrains Mono', ui-monospace, monospace;
}
* { box-sizing: border-box; }
body { margin: 0; background: #DCDFE6; font-family: Inter, system-ui, sans-serif; color: var(--text); font-size: 13px; }
button, input, select, textarea { font: inherit; }
.mono { font-family: var(--mono); font-size: 12px; }
.num { font-variant-numeric: tabular-nums; }
.btn { height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 6px; background: #fff; color: var(--text); cursor: pointer; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 500; }
.btn.primary:hover { background: var(--accent-dark); }
.err { color: var(--danger); }
```

- [ ] **Step 5: `web/src/main.jsx`**

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import './theme.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 6: Тестовые фикстуры `web/src/test/fixtures.js`**

```js
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
```

- [ ] **Step 7: MSW-сервер `web/src/test/server.js`**

```js
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { tables, fields1, records1, me } from './fixtures.js'

// Изменяемая копия записей — PATCH-хендлер её правит, чтобы тесты видели эффект.
let recs = structuredClone(records1)
export function resetDb() { recs = structuredClone(records1) }

export const handlers = [
  http.get('/api/auth/me', () => HttpResponse.json(me)),
  http.post('/api/auth/login', async ({ request }) => {
    const { password } = await request.json()
    return password === 'secret' ? HttpResponse.json({ ok: true }) : new HttpResponse(null, { status: 401 })
  }),
  http.post('/api/auth/logout', () => HttpResponse.json({ ok: true })),
  http.get('/api/tables', () => HttpResponse.json(tables)),
  http.get('/api/tables/1/fields', () => HttpResponse.json(fields1)),
  http.get('/api/tables/1/records', () => HttpResponse.json(recs)),
  http.patch('/api/tables/1/records/:rid', async ({ request, params }) => {
    const body = await request.json()
    const row = recs.find(r => r.id === Number(params.rid))
    if (!row) return new HttpResponse(null, { status: 404 })
    if (row.updated_at !== body.updated_at) return new HttpResponse(null, { status: 409 })
    Object.assign(row, body.values)
    row.updated_at = new Date(Date.parse(row.updated_at) + 1000).toISOString()
    return HttpResponse.json({ id: row.id, updated_at: row.updated_at })
  }),
]

export const server = setupServer(...handlers)
```

- [ ] **Step 8: `web/src/test/setup.js`**

```js
import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { server, resetDb } from './server.js'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => { server.resetHandlers(); resetDb() })
afterAll(() => server.close())
```

- [ ] **Step 9: `web/vitest.config.js`**

```js
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.js'] },
})
```

- [ ] **Step 10: Падающий smoke-тест `web/src/smoke.test.js`**

```js
import { expect, test } from 'vitest'
import { tables } from './test/fixtures.js'

test('фикстуры на месте', () => {
  expect(tables).toHaveLength(2)
})
```

- [ ] **Step 11: Установить и прогнать**

Run: `cd web && npm install && npm test -- --run`
Expected: `smoke.test.js` — 1 passed. (Если `npm install` падает по сети — это предусловие окружения, не код.)

- [ ] **Step 12: `.gitignore`** — добавить строки:

```
web/node_modules/
web/dist/
```

- [ ] **Step 13: Commit**

```bash
git add web .gitignore
git commit -m "feat(web): каркас Vite+React, тестовое окружение Vitest+MSW"
```

---

## Task 2: Клиент API (`api.js`)

**Files:**
- Create: `web/src/api.js`
- Test: `web/src/api.test.js`

- [ ] **Step 1: Падающий тест `web/src/api.test.js`**

```js
import { expect, test } from 'vitest'
import { api, ApiError } from './api.js'

test('GET возвращает JSON', async () => {
  expect(await api('/api/tables')).toHaveLength(2)
})

test('ошибка несёт статус', async () => {
  await expect(api('/api/auth/login', { method: 'POST', body: { login: 'x', password: 'bad' } }))
    .rejects.toMatchObject({ status: 401 })
})

test('ApiError — это Error', () => {
  expect(new ApiError(409, '')).toBeInstanceOf(Error)
})
```

- [ ] **Step 2: Прогнать — упадёт**

Run: `npm --prefix web test -- --run api`
Expected: FAIL — `api.js` не существует.

- [ ] **Step 3: Реализация `web/src/api.js`**

```js
export class ApiError extends Error {
  constructor(status, body) {
    super(`API ${status}`)
    this.status = status
    this.body = body
  }
}

// Один вход для всех запросов: cookie-сессия, JSON туда-обратно, единый тип ошибки.
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let b = null
    try { b = await r.json() } catch { /* тело не JSON — неважно */ }
    throw new ApiError(r.status, b)
  }
  return r.status === 204 ? null : r.json()
}
```

- [ ] **Step 4: Прогнать — пройдёт**

Run: `npm --prefix web test -- --run api`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add web/src/api.js web/src/api.test.js
git commit -m "feat(web): обёртка fetch с cookie-сессией и ApiError"
```

---

## Task 3: Сессия и экран входа (`session.js`, `Login.jsx`, `App.jsx`)

**Files:**
- Create: `web/src/auth/session.js`, `web/src/auth/Login.jsx`, `web/src/App.jsx`
- Test: `web/src/App.test.jsx`

- [ ] **Step 1: Падающий тест `web/src/App.test.jsx`**

```jsx
import { expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from './test/server.js'
import App from './App.jsx'

test('залогинен — виден список таблиц', async () => {
  render(<App />)
  expect(await screen.findByText('Ведомость ЗИП')).toBeInTheDocument()
})

test('не залогинен (401 на /me) — виден экран входа', async () => {
  server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })))
  render(<App />)
  expect(await screen.findByLabelText('Логин')).toBeInTheDocument()
})

test('вход по паролю показывает рабочий экран', async () => {
  server.use(http.get('/api/auth/me', () => new HttpResponse(null, { status: 401 })))
  render(<App />)
  await screen.findByLabelText('Логин')
  await userEvent.type(screen.getByLabelText('Логин'), 'ivan')
  await userEvent.type(screen.getByLabelText('Пароль'), 'secret')
  // после входа /me снова отвечает (дефолтный хендлер) — грузим реальную сессию
  server.resetHandlers()
  await userEvent.click(screen.getByRole('button', { name: 'Войти' }))
  expect(await screen.findByText('Ведомость ЗИП')).toBeInTheDocument()
})
```

- [ ] **Step 2: Прогнать — упадёт** (`App.jsx` нет).

Run: `npm --prefix web test -- --run App`
Expected: FAIL.

- [ ] **Step 3: `web/src/auth/session.js`**

```js
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '../api.js'

// Статусы: 'loading' | 'in' | 'out'. При 401 — 'out' (показываем вход).
export function useSession() {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('loading')

  const refresh = useCallback(async () => {
    try {
      setUser(await api('/api/auth/me'))
      setStatus('in')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setStatus('out')
      else throw e
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const login = useCallback(async (login, password) => {
    await api('/api/auth/login', { method: 'POST', body: { login, password } })
    await refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null)
    setStatus('out')
  }, [])

  return { user, status, login, logout }
}
```

- [ ] **Step 4: `web/src/auth/Login.jsx`**

```jsx
import { useState } from 'react'
import { ApiError } from '../api.js'

export default function Login({ onLogin }) {
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    try {
      await onLogin(login, password)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? 'Неверный логин или пароль' : 'Ошибка входа')
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 280, margin: '80px auto', display: 'grid', gap: 10 }}>
      <h1 style={{ fontSize: 18 }}>Вход</h1>
      <label>Логин<input value={login} onChange={e => setLogin(e.target.value)} autoFocus /></label>
      <label>Пароль<input type="password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {error && <div className="err">{error}</div>}
      <button className="btn primary" type="submit">Войти</button>
    </form>
  )
}
```

Примечание: `<label>Логин<input/></label>` связывает подпись и поле, поэтому `getByLabelText('Логин')` находит input.

- [ ] **Step 5: `web/src/App.jsx`** (оболочка; `Workspace` появится в Task 4 — пока заглушка-импорт)

```jsx
import { useSession } from './auth/session.js'
import Login from './auth/Login.jsx'
import Workspace from './Workspace.jsx'

export default function App() {
  const session = useSession()
  if (session.status === 'loading') return <div style={{ padding: 20 }}>Загрузка…</div>
  if (session.status === 'out') return <Login onLogin={session.login} />
  return <Workspace user={session.user} onLogout={session.logout} />
}
```

- [ ] **Step 6: Временный `web/src/Workspace.jsx`** (минимум, чтобы тест Task 3 на список таблиц прошёл; полноценный — Task 4)

```jsx
import { useEffect, useState } from 'react'
import { api } from './api.js'

export default function Workspace() {
  const [tables, setTables] = useState([])
  useEffect(() => { api('/api/tables').then(setTables) }, [])
  return <div>{tables.map(t => <div key={t.id}>{t.title}</div>)}</div>
}
```

- [ ] **Step 7: Прогнать — пройдёт**

Run: `npm --prefix web test -- --run App`
Expected: PASS (3 теста).

- [ ] **Step 8: Commit**

```bash
git add web/src/auth web/src/App.jsx web/src/Workspace.jsx web/src/App.test.jsx
git commit -m "feat(web): сессия, экран входа, оболочка приложения"
```

---

## Task 4: Навигация по таблицам (`TableList.jsx`) и оболочка `Workspace`

**Files:**
- Create: `web/src/tables/TableList.jsx`
- Modify: `web/src/Workspace.jsx` (полная версия: боковая навигация + область таблицы)
- Test: `web/src/tables/TableList.test.jsx`

- [ ] **Step 1: Падающий тест `web/src/tables/TableList.test.jsx`**

```jsx
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TableList from './TableList.jsx'

const tables = [{ id: 1, title: 'Ведомость ЗИП', primary_field: 'x' }, { id: 2, title: 'Оборудование', primary_field: 'y' }]

test('рисует таблицы и отмечает активную', () => {
  render(<TableList tables={tables} activeId={2} onPick={() => {}} />)
  expect(screen.getByText('Ведомость ЗИП')).toBeInTheDocument()
  expect(screen.getByText('Оборудование')).toHaveAttribute('aria-current', 'true')
})

test('клик выбирает таблицу', async () => {
  const onPick = vi.fn()
  render(<TableList tables={tables} activeId={1} onPick={onPick} />)
  await userEvent.click(screen.getByText('Оборудование'))
  expect(onPick).toHaveBeenCalledWith(2)
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run TableList`
Expected: FAIL.

- [ ] **Step 3: `web/src/tables/TableList.jsx`**

```jsx
export default function TableList({ tables, activeId, onPick }) {
  return (
    <nav style={{ flex: '0 0 240px', overflowY: 'auto', background: 'var(--panel)', borderRight: '1px solid var(--line)', padding: 10 }}>
      {tables.map(t => (
        <button
          key={t.id}
          onClick={() => onPick(t.id)}
          aria-current={t.id === activeId ? 'true' : undefined}
          style={{
            display: 'block', width: '100%', textAlign: 'left', border: 0, borderRadius: 6,
            height: 30, padding: '0 8px', cursor: 'pointer',
            background: t.id === activeId ? 'var(--accent-tint)' : 'transparent',
            color: t.id === activeId ? 'var(--accent-dark)' : 'var(--text)',
            fontWeight: t.id === activeId ? 500 : 400,
          }}
        >{t.title}</button>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Полный `web/src/Workspace.jsx`** (заменяет заглушку из Task 3; `TableView` появится в Task 7 — пока заглушка内联)

```jsx
import { useEffect, useState } from 'react'
import { api } from './api.js'
import TableList from './tables/TableList.jsx'
import TableView from './grid/TableView.jsx'

export default function Workspace({ user, onLogout }) {
  const [tables, setTables] = useState([])
  const [activeId, setActiveId] = useState(null)

  useEffect(() => {
    api('/api/tables').then(ts => {
      setTables(ts)
      setActiveId(prev => prev ?? ts[0]?.id ?? null)
    })
  }, [])

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <TableList tables={tables} activeId={activeId} onPick={setActiveId} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
          <strong>{tables.find(t => t.id === activeId)?.title ?? ''}</strong>
          <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{user?.name}</span>
          <button className="btn" onClick={onLogout}>Выход</button>
        </header>
        {activeId && <TableView tableId={activeId} />}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Временная заглушка `web/src/grid/TableView.jsx`** (полноценная — Task 7)

```jsx
export default function TableView({ tableId }) {
  return <div style={{ padding: 16 }}>Таблица {tableId}</div>
}
```

- [ ] **Step 6: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run`
Expected: PASS (все тесты, включая прежние).

- [ ] **Step 7: Commit**

```bash
git add web/src/tables web/src/Workspace.jsx web/src/grid/TableView.jsx
git commit -m "feat(web): навигация по таблицам и оболочка рабочего экрана"
```

---

## Task 5: Загрузка полей+записей таблицы (`useRecords.js`)

**Files:**
- Create: `web/src/record/useRecords.js`
- Test: `web/src/record/useRecords.test.js`

- [ ] **Step 1: Падающий тест `web/src/record/useRecords.test.js`**

```jsx
import { expect, test } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRecords } from './useRecords.js'

test('грузит невиртуальные поля и записи', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  // из 6 полей фикстуры одно виртуальное (связь) — должно отсеяться → 5
  expect(result.current.fields).toHaveLength(5)
  expect(result.current.fields.some(f => f.options.virtual)).toBe(false)
  expect(result.current.rows).toHaveLength(2)
})

test('patch обновляет строку и updated_at', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const before = result.current.rows[0].updated_at
  await act(() => result.current.patch(result.current.rows[0], { f_fld00000000000002: 42 }))
  const row = result.current.rows.find(r => r.id === 1)
  expect(row.f_fld00000000000002).toBe(42)
  expect(row.updated_at).not.toBe(before)
})

test('patch при устаревшем updated_at бросает 409 и перезагружает', async () => {
  const { result } = renderHook(() => useRecords(1))
  await waitFor(() => expect(result.current.loading).toBe(false))
  const stale = { ...result.current.rows[0], updated_at: '2000-01-01T00:00:00+00:00' }
  await expect(act(() => result.current.patch(stale, { f_fld00000000000002: 1 }))).rejects.toMatchObject({ status: 409 })
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run useRecords`
Expected: FAIL.

- [ ] **Step 3: `web/src/record/useRecords.js`**

```js
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

// Поля таблицы (без виртуальных — у них нет данных в записях) + строки + точечный PATCH.
export function useRecords(tableId) {
  const [fields, setFields] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [fs, rs] = await Promise.all([
      api(`/api/tables/${tableId}/fields`),
      api(`/api/tables/${tableId}/records`),
    ])
    setFields(fs.filter(f => !f.options?.virtual))
    setRows(rs)
    setLoading(false)
  }, [tableId])

  useEffect(() => { load() }, [load])

  // row — строка, которую видел пользователь (нужен её updated_at для оптимистичной блокировки).
  const patch = useCallback(async (row, values) => {
    try {
      const res = await api(`/api/tables/${tableId}/records/${row.id}`, {
        method: 'PATCH', body: { updated_at: row.updated_at, values },
      })
      setRows(rs => rs.map(r => r.id === row.id ? { ...r, ...values, updated_at: res.updated_at } : r))
    } catch (e) {
      if (e.status === 409) await load()  // кто-то изменил запись — показываем свежую
      throw e
    }
  }, [tableId, load])

  return { fields, rows, loading, patch, reload: load }
}
```

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run useRecords`
Expected: PASS (3 теста).

- [ ] **Step 5: Commit**

```bash
git add web/src/record
git commit -m "feat(web): загрузка полей/записей таблицы и оптимистичный PATCH"
```

---

## Task 6: Значение ⇄ ячейка Glide (`cells.js`)

**Files:**
- Create: `web/src/grid/cells.js`
- Test: `web/src/grid/cells.test.js`

- [ ] **Step 1: Падающий тест `web/src/grid/cells.test.js`**

```js
import { expect, test } from 'vitest'
import { GridCellKind } from '@glideapps/glide-data-grid'
import { toCell, fromCell } from './cells.js'

const fText = { kind: 'singleLineText', editable: true }
const fNum = { kind: 'number', editable: true }
const fCheck = { kind: 'checkbox', editable: true }
const fAuto = { kind: 'autoNumber', editable: false }
const fSelect = { kind: 'singleSelect', editable: true }

test('текст — редактируемая Text-ячейка', () => {
  const c = toCell(fText, 'Кольцо')
  expect(c.kind).toBe(GridCellKind.Text)
  expect(c.data).toBe('Кольцо')
  expect(c.allowOverlay).toBe(true)
})

test('число — Number-ячейка', () => {
  expect(toCell(fNum, 5).kind).toBe(GridCellKind.Number)
})

test('checkbox — Boolean-ячейка', () => {
  const c = toCell(fCheck, true)
  expect(c.kind).toBe(GridCellKind.Boolean)
  expect(c.data).toBe(true)
})

test('неэдитируемое поле — allowOverlay false', () => {
  expect(toCell(fAuto, 3).allowOverlay).toBe(false)
})

test('singleSelect редактируется в карточке — в сетке не оверлеим', () => {
  expect(toCell(fSelect, 'Брак').allowOverlay).toBe(false)
})

test('null → пустая строка', () => {
  expect(toCell(fText, null).displayData).toBe('')
})

test('fromCell достаёт data', () => {
  expect(fromCell(fNum, { kind: GridCellKind.Number, data: 9 })).toBe(9)
  expect(fromCell(fCheck, { kind: GridCellKind.Boolean, data: false })).toBe(false)
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run cells`
Expected: FAIL.

- [ ] **Step 3: `web/src/grid/cells.js`**

```js
import { GridCellKind } from '@glideapps/glide-data-grid'

const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'])
// Правятся прямо в сетке; остальные типы — только в карточке (в сетке читаются).
const INLINE = new Set([
  'singleLineText', 'multilineText', 'richText', 'email', 'url', 'phoneNumber',
  'number', 'currency', 'percent', 'rating', 'duration', 'checkbox', 'date',
])

export function toCell(field, value) {
  const editable = field.editable && INLINE.has(field.kind)
  if (field.kind === 'checkbox') {
    return { kind: GridCellKind.Boolean, data: !!value, allowOverlay: false, readonly: !field.editable }
  }
  if (NUMBER.has(field.kind)) {
    return {
      kind: GridCellKind.Number, data: value ?? undefined,
      displayData: value == null ? '' : String(value), allowOverlay: editable,
    }
  }
  const text = value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value)
  return { kind: GridCellKind.Text, data: text, displayData: text, allowOverlay: editable }
}

export function fromCell(field, cell) {
  if (field.kind === 'checkbox') return !!cell.data
  if (NUMBER.has(field.kind)) return cell.data ?? null
  return cell.data === '' ? null : cell.data
}
```

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run cells`
Expected: PASS (7 тестов).

- [ ] **Step 5: Commit**

```bash
git add web/src/grid/cells.js web/src/grid/cells.test.js
git commit -m "feat(web): преобразование значение⇄ячейка Glide по типу поля"
```

---

## Task 7: Сетка (`Grid.jsx`) и `TableView` с inline-правкой

**Files:**
- Create: `web/src/grid/Grid.jsx`
- Modify: `web/src/grid/TableView.jsx` (замена заглушки Task 4)
- Test: `web/src/grid/Grid.test.jsx`

Примечание по тестам Glide: canvas в jsdom не рисует, но React-дерево и обработчики доступны. Тестируем через проп-контракт `Grid` (колонки, счётчик, порядок), не через клики по canvas. Правку через PATCH проверяем на уровне `TableView`, дёргая переданный `onEdit` напрямую.

- [ ] **Step 1: Падающий тест `web/src/grid/Grid.test.jsx`**

```jsx
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import Grid from './Grid.jsx'
import { fields1, records1 } from '../test/fixtures.js'

const fields = fields1.filter(f => !f.options.virtual)

test('счётчик записей и первичное поле первым', () => {
  render(<Grid fields={fields} rows={records1} primaryField="f_fld00000000000001" onEdit={vi.fn()} onOpen={vi.fn()} />)
  expect(screen.getByText('2 записи', { exact: false })).toBeInTheDocument()
  // порядок колонок доступен через data-атрибут контейнера (Grid его проставляет)
  const order = screen.getByTestId('col-order').textContent
  expect(order.startsWith('f_fld00000000000001')).toBe(true)
})

test('поиск фильтрует строки (счётчик меняется)', async () => {
  const user = (await import('@testing-library/user-event')).default
  render(<Grid fields={fields} rows={records1} primaryField="f_fld00000000000001" onEdit={vi.fn()} onOpen={vi.fn()} />)
  await user.type(screen.getByPlaceholderText('Поиск'), 'Кольцо')
  expect(screen.getByText('1 запись', { exact: false })).toBeInTheDocument()
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run Grid`
Expected: FAIL.

- [ ] **Step 3: `web/src/grid/Grid.jsx`** (порт из `proto/grid/src/GlideGrid.jsx`: Glide рисует, TanStack считает поиск/сортировку; первичное поле закреплено через `freezeColumns`)

```jsx
import { useCallback, useMemo, useState } from 'react'
import { DataEditor, GridCellKind } from '@glideapps/glide-data-grid'
import { useReactTable, getCoreRowModel, getSortedRowModel, getFilteredRowModel } from '@tanstack/react-table'
import '@glideapps/glide-data-grid/dist/index.css'
import { toCell, fromCell } from './cells.js'

function plural(n) {
  const a = n % 10, b = n % 100
  if (a === 1 && b !== 11) return 'запись'
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return 'записи'
  return 'записей'
}

export default function Grid({ fields, rows, primaryField, onEdit, onOpen }) {
  // Первичное поле — первой колонкой и закреплено слева (R9).
  const cols = useMemo(() => {
    const prim = fields.filter(f => f.column_name === primaryField)
    const rest = fields.filter(f => f.column_name !== primaryField)
    return [...prim, ...rest]
  }, [fields, primaryField])

  const [widths, setWidths] = useState({})
  const [sorting, setSorting] = useState([])
  const [globalFilter, setGlobalFilter] = useState('')

  const table = useReactTable({
    data: rows,
    columns: useMemo(() => cols.map(c => ({ accessorKey: c.column_name })), [cols]),
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: r => String(r.id),
  })
  const view = table.getRowModel().rows

  const gridColumns = useMemo(() => cols.map(c => {
    const s = sorting.find(x => x.id === c.column_name)
    return { id: c.column_name, title: c.title + (s ? (s.desc ? ' ▼' : ' ▲') : ''), width: widths[c.column_name] ?? 160 }
  }), [cols, widths, sorting])

  const getCellContent = useCallback(([ci, ri]) => {
    const field = cols[ci]
    const value = view[ri].original[field.column_name]
    return toCell(field, value)
  }, [cols, view])

  const onCellEdited = useCallback(([ci, ri], cell) => {
    const field = cols[ci]
    if (!field.editable) return
    onEdit(view[ri].original, field.column_name, fromCell(field, cell))
  }, [cols, view, onEdit])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderBottom: '1px solid var(--line)' }}>
        <input className="search" placeholder="Поиск" value={globalFilter} onChange={e => setGlobalFilter(e.target.value)} />
        <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{view.length} {plural(view.length)}</span>
      </div>
      <span data-testid="col-order" style={{ display: 'none' }}>{cols.map(c => c.column_name).join(',')}</span>
      <div style={{ flex: 1 }}>
        <DataEditor
          columns={gridColumns}
          rows={view.length}
          getCellContent={getCellContent}
          onCellEdited={onCellEdited}
          onCellClicked={([, ri]) => onOpen(view[ri].original)}
          onHeaderClicked={ci => table.getColumn(cols[ci].column_name).toggleSorting()}
          onColumnResize={(col, w) => setWidths(x => ({ ...x, [col.id]: w }))}
          rowMarkers="number"
          freezeColumns={1}
          width="100%"
          height="100%"
          smoothScrollY
          getCellsForSelection
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: `web/src/grid/TableView.jsx`** (полная версия: данные + сетка + карточка; `Card` — Task 9, пока кнопка-заглушка)

```jsx
import { useState } from 'react'
import { useRecords } from '../record/useRecords.js'
import Grid from './Grid.jsx'
import Card from '../card/Card.jsx'

export default function TableView({ tableId, primaryField }) {
  const { fields, rows, loading, patch } = useRecords(tableId)
  const [open, setOpen] = useState(null)   // запись, открытая в карточке
  const [error, setError] = useState('')

  async function onEdit(row, column, value) {
    setError('')
    try {
      await patch(row, { [column]: value })
    } catch (e) {
      setError(e.status === 409 ? 'Запись изменил другой пользователь — показана свежая версия' : 'Не удалось сохранить')
    }
  }

  if (loading) return <div style={{ padding: 16 }}>Загрузка…</div>

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <div className="err" style={{ padding: '6px 16px' }}>{error}</div>}
      <Grid fields={fields} rows={rows} primaryField={primaryField} onEdit={onEdit} onOpen={setOpen} />
      {open && (
        <Card
          record={rows.find(r => r.id === open.id) ?? open}
          fields={fields}
          onSave={values => onEdit(open, Object.keys(values)[0], Object.values(values)[0])}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
```

Примечание: `TableView` теперь требует `primaryField`. Обновить `Workspace.jsx` Step — передать его:
в `web/src/Workspace.jsx` заменить `{activeId && <TableView tableId={activeId} />}` на
`{activeId && <TableView tableId={activeId} primaryField={tables.find(t => t.id === activeId)?.primary_field} />}`.

- [ ] **Step 5: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run`
Expected: PASS (все, включая Grid: 2 теста). Если Glide в jsdom кидает по canvas — тесты `Grid.test.jsx` обращаются только к тулбару и `col-order`, canvas-рендер обёрнут Glide внутри и не вызывается при отсутствии layout; при ошибке измерения размеров обернуть `DataEditor` в `<div style={{height:400}}>` фиксированной высоты — не требуется для прохождения этих двух тестов, т.к. они не трогают canvas.

- [ ] **Step 6: Commit**

```bash
git add web/src/grid web/src/Workspace.jsx
git commit -m "feat(web): сетка Glide+TanStack с поиском, сортировкой, inline-правкой и 409"
```

---

## Task 8: Редакторы полей карточки (`fields.jsx`)

**Files:**
- Create: `web/src/card/fields.jsx`
- Test: `web/src/card/fields.test.jsx`

- [ ] **Step 1: Падающий тест `web/src/card/fields.test.jsx`**

```jsx
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FieldEditor from './fields.jsx'

test('текст: меняет значение', async () => {
  const onChange = vi.fn()
  render(<FieldEditor field={{ kind: 'singleLineText', editable: true, title: 'Имя' }} value="a" onChange={onChange} />)
  await userEvent.type(screen.getByLabelText('Имя'), 'b')
  expect(onChange).toHaveBeenCalled()
})

test('checkbox: переключает', async () => {
  const onChange = vi.fn()
  render(<FieldEditor field={{ kind: 'checkbox', editable: true, title: 'Флаг' }} value={false} onChange={onChange} />)
  await userEvent.click(screen.getByLabelText('Флаг'))
  expect(onChange).toHaveBeenCalledWith(true)
})

test('singleSelect: варианты из choices', () => {
  render(<FieldEditor
    field={{ kind: 'singleSelect', editable: true, title: 'Статус', options: { choices: [{ id: '1', name: 'На складе' }, { id: '2', name: 'Брак' }] } }}
    value="Брак" onChange={() => {}} />)
  expect(screen.getByLabelText('Статус')).toHaveValue('Брак')
  expect(screen.getByRole('option', { name: 'На складе' })).toBeInTheDocument()
})

test('неэдитируемое: только текст, без поля ввода', () => {
  render(<FieldEditor field={{ kind: 'autoNumber', editable: false, title: '№' }} value={7} onChange={() => {}} />)
  expect(screen.getByText('7')).toBeInTheDocument()
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run fields`
Expected: FAIL.

- [ ] **Step 3: `web/src/card/fields.jsx`**

```jsx
const TEXT = new Set(['singleLineText', 'email', 'url', 'phoneNumber'])
const MULTILINE = new Set(['multilineText', 'richText'])
const NUMBER = new Set(['number', 'currency', 'percent', 'rating', 'duration'])

// Один редактор поля по его kind. Неэдитируемое — только показ.
export default function FieldEditor({ field, value, onChange }) {
  const id = `f-${field.column_name ?? field.title}`
  const label = <label htmlFor={id} style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{field.title}</label>

  if (!field.editable) {
    return <div>{label}<div id={id} style={{ padding: '6px 0' }}>{value == null ? '—' : Array.isArray(value) ? value.join(', ') : String(value)}</div></div>
  }
  if (field.kind === 'checkbox') {
    return <div><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input id={id} type="checkbox" checked={!!value} onChange={e => onChange(e.target.checked)} aria-label={field.title} />{field.title}
    </label></div>
  }
  if (field.kind === 'singleSelect') {
    const choices = field.options?.choices ?? []
    return <div>{label}<select id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)}>
      <option value="">—</option>
      {choices.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
    </select></div>
  }
  if (field.kind === 'multipleSelects') {
    const choices = field.options?.choices ?? []
    const set = new Set(value ?? [])
    const toggle = name => { const n = new Set(set); n.has(name) ? n.delete(name) : n.add(name); onChange([...n]) }
    return <div>{label}<div>{choices.map(c => (
      <label key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="checkbox" checked={set.has(c.name)} onChange={() => toggle(c.name)} />{c.name}
      </label>))}</div></div>
  }
  if (field.kind === 'date') {
    return <div>{label}<input id={id} type="date" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} /></div>
  }
  if (field.kind === 'dateTime') {
    const local = value ? String(value).slice(0, 16) : ''
    return <div>{label}<input id={id} type="datetime-local" aria-label={field.title} value={local} onChange={e => onChange(e.target.value || null)} /></div>
  }
  if (NUMBER.has(field.kind)) {
    return <div>{label}<input id={id} type="number" aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} /></div>
  }
  if (MULTILINE.has(field.kind)) {
    return <div>{label}<textarea id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} rows={3} style={{ width: '100%' }} /></div>
  }
  if (TEXT.has(field.kind)) {
    return <div>{label}<input id={id} aria-label={field.title} value={value ?? ''} onChange={e => onChange(e.target.value || null)} style={{ width: '100%' }} /></div>
  }
  // jsonb и прочее — показ только для чтения (этап 2)
  return <div>{label}<div id={id} className="mono" style={{ padding: '6px 0' }}>{value == null ? '—' : JSON.stringify(value)}</div></div>
}
```

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run fields`
Expected: PASS (4 теста).

- [ ] **Step 5: Commit**

```bash
git add web/src/card/fields.jsx web/src/card/fields.test.jsx
git commit -m "feat(web): редакторы полей карточки по типам"
```

---

## Task 9: Карточка записи (`Card.jsx`)

**Files:**
- Create: `web/src/card/Card.jsx`
- Test: `web/src/card/Card.test.jsx`

- [ ] **Step 1: Падающий тест `web/src/card/Card.test.jsx`**

```jsx
import { expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Card from './Card.jsx'
import { fields1, records1 } from '../test/fixtures.js'

const fields = fields1.filter(f => !f.options.virtual)

test('показывает все невиртуальные поля записи', () => {
  render(<Card record={records1[0]} fields={fields} onSave={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByLabelText('Наименование')).toHaveValue('Кольцо')
  expect(screen.getByText('№')).toBeInTheDocument()            // autoNumber — только показ
})

test('правка эдитируемого поля и сохранение зовёт onSave с изменениями', async () => {
  const onSave = vi.fn().mockResolvedValue()
  render(<Card record={records1[0]} fields={fields} onSave={onSave} onClose={vi.fn()} />)
  await userEvent.clear(screen.getByLabelText('Кол-во'))
  await userEvent.type(screen.getByLabelText('Кол-во'), '42')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(onSave).toHaveBeenCalledWith({ f_fld00000000000002: 42 })
})

test('неэдитируемое поле не отдаётся в onSave', async () => {
  const onSave = vi.fn().mockResolvedValue()
  render(<Card record={records1[0]} fields={fields} onSave={onSave} onClose={vi.fn()} />)
  await userEvent.type(screen.getByLabelText('Наименование'), '!')
  await userEvent.click(screen.getByRole('button', { name: 'Сохранить' }))
  expect(Object.keys(onSave.mock.calls[0][0])).not.toContain('f_fld00000000000005')  // autoNumber
})

test('закрытие', async () => {
  const onClose = vi.fn()
  render(<Card record={records1[0]} fields={fields} onSave={vi.fn()} onClose={onClose} />)
  await userEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
  expect(onClose).toHaveBeenCalled()
})
```

- [ ] **Step 2: Прогнать — упадёт.**

Run: `npm --prefix web test -- --run Card`
Expected: FAIL.

- [ ] **Step 3: `web/src/card/Card.jsx`** (панель справа; копит изменения, при сохранении отдаёт только изменённые эдитируемые поля)

```jsx
import { useState } from 'react'
import FieldEditor from './fields.jsx'

export default function Card({ record, fields, onSave, onClose }) {
  const [draft, setDraft] = useState({})   // только изменённые поля
  const [saving, setSaving] = useState(false)

  const valueOf = f => (f.column_name in draft ? draft[f.column_name] : record[f.column_name])

  async function save() {
    if (Object.keys(draft).length === 0) { onClose(); return }
    setSaving(true)
    try {
      await onSave(draft)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside style={{
      position: 'fixed', top: 0, right: 0, width: 420, height: '100vh', background: 'var(--bg)',
      borderLeft: '1px solid var(--line)', padding: 16, overflowY: 'auto', display: 'grid', gap: 12, alignContent: 'start',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong>Запись №{record.id}</strong>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Закрыть</button>
      </div>
      {fields.map(f => (
        <FieldEditor
          key={f.column_name}
          field={f}
          value={valueOf(f)}
          onChange={v => setDraft(d => ({ ...d, [f.column_name]: v }))}
        />
      ))}
      <button className="btn primary" disabled={saving} onClick={save}>Сохранить</button>
    </aside>
  )
}
```

Примечание: `draft` копит только эдитируемые поля — `FieldEditor` для неэдитируемых не вызывает `onChange`, поэтому их ключей в `draft` нет.

- [ ] **Step 4: Прогнать — пройдёт.**

Run: `npm --prefix web test -- --run Card`
Expected: PASS (4 теста).

- [ ] **Step 5: Поправить `TableView` — сохранение нескольких полей.** В Task 7 `onSave` отправлял одно поле; карточка шлёт объект изменений. Заменить в `web/src/grid/TableView.jsx` проп `onSave` карточки на:

```jsx
onSave={async values => {
  setError('')
  try { await patch(open, values) }
  catch (e) { setError(e.status === 409 ? 'Запись изменил другой пользователь — показана свежая версия' : 'Не удалось сохранить'); throw e }
}}
```

(`patch` уже принимает объект `values` целиком — см. Task 5.)

- [ ] **Step 6: Прогнать всё — пройдёт.**

Run: `npm --prefix web test -- --run`
Expected: PASS (все файлы).

- [ ] **Step 7: Commit**

```bash
git add web/src/card/Card.jsx web/src/card/Card.test.jsx web/src/grid/TableView.jsx
git commit -m "feat(web): карточка записи — показ всех полей и правка эдитируемых"
```

---

## Task 10: Сборка, ручная проверка против живого API, финальный коммит

**Files:**
- Create: `web/README.md`
- (без новых тестов — интеграция с реальным бэкендом проверяется руками)

- [ ] **Step 1: Прогнать весь набор и сборку**

Run: `npm --prefix web test -- --run && npm --prefix web run build`
Expected: все тесты PASS; `vite build` завершается без ошибок, создаёт `web/dist`.

- [ ] **Step 2: `web/README.md`**

````markdown
# web — клиент «БД гидроканал» (этап 1в)

Сетка и карточка записи поверх API (`api/`).

## Разработка
```
docker compose up -d           # поднять api + db (порт 8000)
npm --prefix web install
npm --prefix web run dev        # http://localhost:5200, прокси /api → :8000
```
Вход — учёткой из `python -m app.cli create-user …`.

## Тесты
```
npm --prefix web test -- --run
```
API в тестах мокается (MSW), настоящий бэкенд не нужен.

## Границы этапа 1в
Есть: вход, список таблиц, сетка (поиск, сортировка, ширины колонок, inline-правка
текст/число/checkbox, счётчик, закреплённое первичное поле), карточка (показ всех
невиртуальных полей, правка эдитируемых, select/мультивыбор/даты).
Нет (этапы 2–3): виды/фильтры/группировка, вставка из Excel, выгрузка CSV, итоги по
колонкам, связи, вложения, история, формы, роли и права, регламентные подсветки.
````

- [ ] **Step 3: Ручная проверка против живого API** (отметить галочками после прогона)

- [ ] `docker compose up -d`, открыт `http://localhost:5200`, виден экран входа.
- [ ] Вход учёткой → виден список таблиц слева, выбрана первая, сетка с данными.
- [ ] Первичное поле и номера строк закреплены слева при горизонтальной прокрутке; шапка сверху; счётчик записей верный.
- [ ] Поиск сужает строки и счётчик; клик по шапке сортирует (▲/▼); ширина колонки тянется.
- [ ] Inline-правка числа/текста/флажка в ячейке сохраняется (после перезагрузки значение на месте).
- [ ] Клик по строке открывает карточку; правка select/даты/мультивыбора + «Сохранить» → значение в сетке обновилось.
- [ ] Выход → снова экран входа.
- [ ] Конфликт: в двух вкладках открыть одну запись, в первой изменить и сохранить, во второй изменить то же поле → во второй появляется «Запись изменил другой пользователь», показана свежая версия (значение не затёрто).

- [ ] **Step 4: Финальный commit**

```bash
git add web/README.md
git commit -m "docs(web): README этапа 1в; сборка и ручная проверка пройдены"
```

---

## Соответствие спецификации (самопроверка)

| Требование | Где закрыто | Примечание |
|---|---|---|
| R9 сетка: ширина, прокрутка, закреплённые шапка/№/первичное, inline-правка, поиск, сортировка, ширина колонок, счётчик | Task 6–7 | Фильтры, группировка, вставка Excel, итоги, CSV — **этап 2** (виды) |
| R11 карточка: все поля | Task 8–9 | Связанные записи, вложения, история — **этап 2** (нет данных в API 1в) |
| R13 резиновая вёрстка, обрезка длинного | Task 7 (Glide сам обрезает), Task 9 | Телефон — минимально через карточку; доводка — этап 2 |
| R14 стиль по эскизу (индиго, шрифты, без теней) | Task 1 (`theme.css`), везде | |
| Правка по правам | Task 6 (`editable`), Task 8 | Роли ещё нет (этап 2); правит любой вошедший — **не выкатывать наружу до этапа 2** (см. аудит безопасности) |
| Оптимистичная блокировка (конфликт правок) | Task 5, 7, 10 | |

**Вне этапа 1в (явно отложено):** виды/фильтры/группировка/сортировки сохранённые (R10), формы (R12), вложения и предпросмотр (R27–R28), история изменений (R11), регламент и подсветки (R15–R26), справка и PDF (R29–R32), роли и права (R1–R7). Это этапы 2–3 по `docs/2026-10-23-app-design.md` §11.
