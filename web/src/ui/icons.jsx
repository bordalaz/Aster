// Иконки Phosphor (тот же набор, что в интерфейсе Airtable). SVG из пакета, перекрашиваются через currentColor.
import aa from '@phosphor-icons/core/assets/regular/text-a-underline.svg?raw'
import target from '@phosphor-icons/core/assets/regular/target.svg?raw'
import textLeft from '@phosphor-icons/core/assets/regular/text-align-left.svg?raw'
import hash from '@phosphor-icons/core/assets/regular/hash.svg?raw'
import clock from '@phosphor-icons/core/assets/regular/clock.svg?raw'
import fn from '@phosphor-icons/core/assets/regular/function.svg?raw'
import caretCircle from '@phosphor-icons/core/assets/regular/caret-circle-down.svg?raw'
import listBullets from '@phosphor-icons/core/assets/regular/list-bullets.svg?raw'
import checkSquare from '@phosphor-icons/core/assets/regular/check-square.svg?raw'
import calendar from '@phosphor-icons/core/assets/regular/calendar-blank.svg?raw'
import paperclip from '@phosphor-icons/core/assets/regular/paperclip.svg?raw'
import link from '@phosphor-icons/core/assets/regular/link.svg?raw'
import at from '@phosphor-icons/core/assets/regular/at.svg?raw'
import phone from '@phosphor-icons/core/assets/regular/phone.svg?raw'
import binoculars from '@phosphor-icons/core/assets/regular/binoculars.svg?raw'
import sigma from '@phosphor-icons/core/assets/regular/sigma.svg?raw'
import numbers from '@phosphor-icons/core/assets/regular/list-numbers.svg?raw'
import percent from '@phosphor-icons/core/assets/regular/percent.svg?raw'
import star from '@phosphor-icons/core/assets/regular/star.svg?raw'
import rub from '@phosphor-icons/core/assets/regular/currency-rub.svg?raw'
import user from '@phosphor-icons/core/assets/regular/user.svg?raw'
import search from '@phosphor-icons/core/assets/regular/magnifying-glass.svg?raw'
import eyeSlash from '@phosphor-icons/core/assets/regular/eye-slash.svg?raw'
import funnel from '@phosphor-icons/core/assets/regular/funnel.svg?raw'
import list from '@phosphor-icons/core/assets/regular/list.svg?raw'
import rows from '@phosphor-icons/core/assets/regular/rows.svg?raw'
import sort from '@phosphor-icons/core/assets/regular/arrows-down-up.svg?raw'
import caretDown from '@phosphor-icons/core/assets/regular/caret-down.svg?raw'
import table from '@phosphor-icons/core/assets/regular/table.svg?raw'
import download from '@phosphor-icons/core/assets/regular/download-simple.svg?raw'
import floppy from '@phosphor-icons/core/assets/regular/floppy-disk.svg?raw'
import trash from '@phosphor-icons/core/assets/regular/trash.svg?raw'
import copy from '@phosphor-icons/core/assets/regular/copy.svg?raw'
import plus from '@phosphor-icons/core/assets/regular/plus.svg?raw'
import x from '@phosphor-icons/core/assets/regular/x.svg?raw'
import check from '@phosphor-icons/core/assets/regular/check.svg?raw'
import expand from '@phosphor-icons/core/assets/regular/arrows-out-simple.svg?raw'
import collapse from '@phosphor-icons/core/assets/regular/arrows-in-simple.svg?raw'
import expandV from '@phosphor-icons/core/assets/regular/arrows-out-line-vertical.svg?raw'
import collapseV from '@phosphor-icons/core/assets/regular/arrows-in-line-vertical.svg?raw'
import database from '@phosphor-icons/core/assets/regular/database.svg?raw'
import signOut from '@phosphor-icons/core/assets/regular/sign-out.svg?raw'
import key from '@phosphor-icons/core/assets/regular/key.svg?raw'
import users from '@phosphor-icons/core/assets/regular/users.svg?raw'
import textbox from '@phosphor-icons/core/assets/regular/textbox.svg?raw'

export const ICONS = {
  aa, target, textLeft, hash, clock, fn, caretCircle, listBullets, checkSquare, calendar, paperclip, link, at, phone,
  binoculars, sigma, numbers, percent, star, rub, user, search, eyeSlash, funnel, list, rows, sort, caretDown,
  table, download, floppy, trash, copy, plus, x, check, expand, collapse, expandV, collapseV, database, signOut, key, users, textbox,
}

// Значок типа поля — как в заголовках Airtable.
const BY_KIND = {
  singleLineText: 'aa', multilineText: 'textLeft', richText: 'textLeft', number: 'hash', currency: 'rub',
  percent: 'percent', rating: 'star', duration: 'clock', autoNumber: 'numbers', formula: 'fn',
  singleSelect: 'caretCircle', multipleSelects: 'listBullets', checkbox: 'checkSquare', date: 'calendar',
  dateTime: 'calendar', createdTime: 'calendar', lastModifiedTime: 'calendar', multipleAttachments: 'paperclip',
  multipleRecordLinks: 'list', email: 'at', url: 'link', phoneNumber: 'phone', multipleLookupValues: 'binoculars',
  rollup: 'target', count: 'numbers', singleCollaborator: 'user', multipleCollaborators: 'user',
  createdBy: 'user', lastModifiedBy: 'user', barcode: 'textbox',
}
export const fieldIcon = kind => BY_KIND[kind] ?? 'aa'

// Для заголовков Glide: {имя: ({fgColor}) => svg}.
export const headerIcons = Object.fromEntries(Object.keys(ICONS).map(k => [
  `i-${k}`, ({ fgColor }) => ICONS[k].replace('<svg ', '<svg width="20" height="20" ').replace('fill="currentColor"', `fill="${fgColor}"`),
]))

// SVG из пакета (доверенный источник при сборке), не из данных.
export function Icon({ name, size = 16, style, ...rest }) {
  return (
    <span aria-hidden="true" {...rest}
      style={{ display: 'inline-flex', width: size, height: size, flex: 'none', ...style }}
      dangerouslySetInnerHTML={{ __html: ICONS[name].replace('<svg ', `<svg width="${size}" height="${size}" `) }} />
  )
}
