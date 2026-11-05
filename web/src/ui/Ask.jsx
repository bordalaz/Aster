import { useState } from 'react'

// Вопрос перед действием, как в хороших интерфейсах: «Да / Нет» и мелко «Больше не спрашивать».
// Отказ от вопроса помнится в браузере (aster.ask.*); вернуть — «Сбросить настройки» в меню профиля.
// Без storeKey — без галочки (вопрос, который нельзя отключать).
export const askOff = k => { try { return localStorage.getItem(k) === 'off' } catch { return false } }
export default function Ask({ title, children, yes, no, storeKey, onYes, onNo }) {
  const [quiet, setQuiet] = useState(false)
  const ok = () => { if (quiet && storeKey) try { localStorage.setItem(storeKey, 'off') } catch { /* приватный режим */ } onYes() }
  return (
    <div className="card-backdrop card-stacked" onMouseDown={e => { if (e.target === e.currentTarget) onNo() }}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onNo() } }}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{children}</p>
        {storeKey && <label className="ask-quiet"><input type="checkbox" checked={quiet} onChange={e => setQuiet(e.target.checked)} />Больше не спрашивать</label>}
        <div className="send-foot">
          <button type="button" className="btn" onClick={onNo}>{no}</button>
          <button type="button" className="btn primary" autoFocus onClick={ok}>{yes}</button>
        </div>
      </div>
    </div>
  )
}
