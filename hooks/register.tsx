import type { Register, SessionRateLimit } from 'claude-code'

const NAMES: Record<string, string> = {
  five_hour: '5ч',
  seven_day: 'нед',
  spend_limit: 'траты',
}

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

const MINUTE = 60 * 1000
// Старше этого — пишем возраст цифр, чтобы было видно, что они могли отстать.
const STALE_AFTER = 10 * MINUTE

const pad = (n: number) => String(n).padStart(2, '0')

// Последнее известное показание, общее для всех сессий через $.store.
type Reading = { limits: SessionRateLimit[]; at: number }

const LAST = 'last'

// Сброс в пределах суток — только время, дальше — день недели и время.
function resetLabel(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isSoon = d.getTime() - now < 24 * 3600 * 1000
  return isSoon ? ` до ${time}` : ` до ${DAYS[d.getDay()]} ${time}`
}

function ageLabel(at: number, now: number): string {
  const age = now - at
  if (age < STALE_AFTER) return ''
  const minutes = Math.round(age / MINUTE)
  return minutes < 60 ? ` · ${minutes} мин назад` : ` · ${Math.round(minutes / 60)} ч назад`
}

// Окно, чей сброс уже прошёл, показываем как 0% без времени:
// сохранённая цифра для него больше не верна.
function freshen(list: SessionRateLimit[], now: number): SessionRateLimit[] {
  return list.map(l => {
    const resetAt = l.resetsAt ? new Date(l.resetsAt).getTime() : NaN
    return resetAt <= now ? { kind: l.kind, percentUsed: 0 } : l
  })
}

function line(r: Reading, now: number): string | undefined {
  if (r.limits.length === 0) return undefined
  const parts = freshen(r.limits, now).map(l => {
    const warn = l.percentUsed >= 80 ? '⚠ ' : ''
    return `${warn}${NAMES[l.kind] ?? l.kind} ${Math.round(l.percentUsed)}%${resetLabel(l.resetsAt, now)}`
  })
  return parts.join(' · ') + ageLabel(r.at, now)
}

// Версия 0.3 хранила голый массив без времени — считаем его очень старым.
function asReading(v: unknown): Reading | undefined {
  if (Array.isArray(v)) return { limits: v as SessionRateLimit[], at: 0 }
  if (v && typeof v === 'object' && Array.isArray((v as Reading).limits)) return v as Reading
  return undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const now = await $.clock.now()

    // Новая сессия цифр не знает до первого ответа API —
    // берём последние, которые получила любая сессия.
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) {
      await $.store.set(LAST, { limits: usage.rateLimits, at: now })
    }
    const saved = asReading(await $.store.get(LAST))
    if (saved) $.ui.status(line(saved, now))

    // Цифры приходят только с ответами API. Раз в минуту подхватываем то,
    // что получили другие сессии, и обновляем «N мин назад» и сбросы окон.
    $.clock.every(MINUTE, async () => {
      const latest = asReading(await $.store.get(LAST))
      if (latest) $.ui.status(line(latest, await $.clock.now()))
    })

    return r
  })

  // Движок сам присылает новые цифры после хода и при сдвиге окна на пункт.
  // Пустой список не стирает строку: остаётся последнее известное.
  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      const reading: Reading = { limits: e.rateLimits, at: await $.clock.now() }
      await $.store.set(LAST, reading)
      $.ui.status(line(reading, reading.at))
    }
    return next(e)
  })
}
