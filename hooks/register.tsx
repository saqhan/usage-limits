import type { Register, SessionRateLimit } from 'claude-code'

const NAMES: Record<string, string> = {
  five_hour: '5ч',
  seven_day: 'нед',
  spend_limit: 'траты',
}

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const pad = (n: number) => String(n).padStart(2, '0')

// Сброс в пределах суток — только время, дальше — день недели и время.
function resetLabel(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isSoon = d.getTime() - now < 24 * 3600 * 1000
  return isSoon ? ` до ${time}` : ` до ${DAYS[d.getDay()]} ${time}`
}

function line(list: SessionRateLimit[], now: number): string | undefined {
  if (list.length === 0) return undefined
  return list
    .map(l => {
      const warn = l.percentUsed >= 80 ? '⚠ ' : ''
      return `${warn}${NAMES[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%${resetLabel(l.resetsAt, now)}`
    })
    .join(' · ')
}

// Окно, чей сброс уже прошёл, показываем как 0% без времени:
// сохранённая цифра для него больше не верна.
function freshen(list: SessionRateLimit[], now: number): SessionRateLimit[] {
  return list.map(l => {
    const resetAt = l.resetsAt ? new Date(l.resetsAt).getTime() : NaN
    return resetAt <= now ? { kind: l.kind, percentUsed: 0 } : l
  })
}

const LAST = 'last'

export const register: Register = on => {
  // Новая сессия цифр не знает до первого ответа API, поэтому
  // при старте показываем последние сохранённые (они общие для всех сессий).
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()
    const usage = await $.session.usage()
    const saved = (await $.store.get(LAST)) as SessionRateLimit[] | undefined
    const list = usage.rateLimits.length > 0 ? usage.rateLimits : freshen(saved ?? [], now)
    $.ui.status(line(list, now))
    return r
  })

  // Движок сам присылает новые цифры после хода и при сдвиге окна на пункт.
  // Пустой список не стирает строку: оставляем последнее известное.
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      await $.store.set(LAST, e.rateLimits)
      $.ui.status(line(e.rateLimits, await $.clock.now()))
    }
    return next(e)
  })
}
