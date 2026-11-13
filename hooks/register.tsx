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

export const register: Register = on => {
  // Первое значение — сразу при старте, не дожидаясь хода.
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    const usage = await $.session.usage()
    $.ui.status(line(usage.rateLimits, await $.clock.now()))
    return r
  })

  // Движок сам присылает новые цифры после хода и при сдвиге окна на пункт.
  on('session.measure', async ($, e, next) => {
    $.ui.status(line(e.rateLimits, await $.clock.now()))
    return next(e)
  })
}
