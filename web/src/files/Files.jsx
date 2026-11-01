import { useState } from 'react'
import { ApiError, uploadFile } from '../api.js'

const PREVIEW = /^(image\/(png|jpeg|gif|webp)|application\/pdf)$/
const size = n => (n == null ? '' : n < 1024 ? `${n} Б` : n < 1048576 ? `${(n / 1024).toFixed(0)} КБ` : `${(n / 1048576).toFixed(1)} МБ`)
const MAX = 50 * 1024 * 1024

// Список вложений (R27, R28): имя → скачать под исходным именем; картинки и PDF — «открыть» в новой вкладке.
// onUpload — добавить файлы (получает загруженные [{id, name, size}]); onRemove — убрать файл.
export default function Files({ title, files, onUpload, onRemove, bare = false }) {   // bare — подпись рисует владелец (карточка)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function pick(e) {
    const list = [...e.target.files]
    e.target.value = ''
    const big = list.find(f => f.size > MAX)
    if (big) { setError(`«${big.name}» больше 50 МБ`); return }
    setError(''); setBusy(true)
    try {
      const done = []
      for (const f of list) done.push(await uploadFile(f))
      await onUpload(done)
    } catch (err) {
      setError(err instanceof ApiError && typeof err.body?.detail === 'string' ? err.body.detail : 'Не удалось загрузить файл')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {!bare && <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{title}</div>}
      {(files ?? []).length === 0 && !onUpload && <div style={{ padding: '6px 0' }}>—</div>}
      <div style={{ display: 'grid', gap: 2 }}>
        {(files ?? []).map(f => (
          <div key={f.id} style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
            <a href={`/api/attachments/${f.id}`} download={f.name} title={f.name}
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</a>
            <span style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap' }}>{size(f.size)}</span>
            {PREVIEW.test(f.mime ?? '') &&
              <a href={`/api/attachments/${f.id}?inline=1`} target="_blank" rel="noreferrer" style={{ fontSize: 11 }}>открыть</a>}
            {onRemove && <button type="button" className="btn" aria-label={`Убрать файл ${f.name}`} onClick={() => onRemove(f)}>×</button>}
          </div>
        ))}
      </div>
      {onUpload && (
        <label className="btn" style={{ display: 'inline-block', marginTop: 4, opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Загрузка…' : 'Добавить файлы'}
          <input type="file" multiple hidden disabled={busy} aria-label={`Файлы: ${title}`} onChange={pick} />
        </label>
      )}
      {error && <div className="err" role="alert">{error}</div>}
    </div>
  )
}
