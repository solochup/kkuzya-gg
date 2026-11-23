// Компактный отчёт в Markdown. Сам отчёт можно целиком вставить в чат.
import { round } from './util.js';

const f = (x, d = 1) => (x == null || !Number.isFinite(x) ? 'н/д' : (+x).toFixed(d));
const pc = (x) => (x == null ? 'н/д' : `${Math.round(x * 100)}%`);
const kb = (b) => (b == null ? 'н/д' : (b / 1024).toFixed(b > 102400 ? 0 : 1));
const utc = (s) => (s ? new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ') : 'н/д');
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const short = (u) => u.replace(/^https:\/\//, '').replace(/\d{9,}/g, (m) => (m.length > 8 ? m : m));

function table(head, rows) {
  const line = (r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '/')).join(' | ')} |`;
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n');
}

export function renderReport(R) {
  const L = [];
  const p = (s = '') => L.push(s);
  p('# Отчёт проверки Deadlock API');
  p(`Создан: ${R.startedAt} | Node ${R.node} | инструмент ${R.version}`);
  p(`Игрок: SteamID64 ${R.steamInput} -> Account ID **${R.accountId}** ${R.idCheck}`);
  p();

  p('## 1. Запросы');
  p(table(['что', 'статус', 'мс', 'КБ', 'важные заголовки'], R.requests.map((e) => [
    e.label || short(e.url).slice(0, 40), e.status ?? e.error ?? '?', e.ms ?? '', kb(e.bytes),
    Object.entries(e.headers).filter(([k]) => /ratelimit|retry|cache|age|etag|access-control/.test(k)).map(([k, v]) => `${k}: ${v}`).join('; ') || '-',
  ])));
  const acao = [...new Set(R.requests.map((e) => e.headers['access-control-allow-origin']).filter(Boolean))];
  p(`Всего запросов: ${R.requests.length}, из них ошибок: ${R.requests.filter((e) => e.error || (e.status && e.status >= 400)).length}. Пауза между запросами ${R.delayMs} мс.`);
  p(acao.length
    ? `CORS: сервер вернул access-control-allow-origin: ${acao.join(', ')}. Это значение на запрос с чужим Origin; браузерный вызов всё равно лучше проверить отдельно.`
    : 'CORS: заголовка access-control-allow-origin в ответах нет. Скорее всего, напрямую из браузера вызывать нельзя, нужна функция-посредник (это не подтверждено проверкой в браузере).');
  const limitHdr = R.requests.flatMap((e) => Object.keys(e.headers)).filter((k) => /ratelimit|retry-after/.test(k));
  p(limitHdr.length ? `Заголовки лимитов: ${[...new Set(limitHdr)].join(', ')} (значения в таблице выше).` : 'Заголовков с лимитами запросов в ответах нет: лимит по ним определить нельзя, его надо искать по ответам 429.');
  for (const x of R.dns || []) p(`DNS ${x.host}: ${x.ok ? 'найден ' + x.addrs.join(', ') : 'НЕ найден (' + x.error + ')'}`);
  p();

  p('## 2. История матчей');
  if (!R.history) p('История не получена. Дальше проверять нечего.');
  else if (!R.history.ok) p(`Не удалось разобрать: ${R.history.error}. Верхние ключи ответа: ${(R.history.topKeys || []).join(', ') || 'н/д'}`);
  else {
    const h = R.history;
    p(`Записей: ${h.total}. Найденные поля: id=\`${h.fields.id}\`, начало=\`${h.fields.start}\`, длительность=\`${h.fields.duration}\`, герой=\`${h.fields.hero}\`.`);
    p(`Все поля первой записи: ${h.firstRecordKeys.join(', ')}`);
    const newest = h.rows[0], oldest = h.rows[h.rows.length - 1];
    p(`Самый новый матч в истории: ${newest.matchId}, начало ${utc(newest.startTime)} UTC. Самый старый: ${utc(oldest.startTime)} UTC.`);
    if (R.newestAgeMin != null) p(`С конца самого нового матча до этого запроса прошло ${f(R.newestAgeMin, 0)} мин, и матч уже был в истории. Значит, задержка публикации **не больше** этого числа. Настоящую задержку измеряет watch.mjs.`);
  }
  p();

  if (R.history && R.history.ok) {
    p(`Режимы по всей истории: game_mode: ${R.historyModes.gameMode}; match_mode: ${R.historyModes.matchMode}.`);
    p('Первые две записи истории целиком (чтобы проверить смысл полей):');
    p('```');
    for (const r of R.firstRaw) p(JSON.stringify(r));
    p('```');
    if (R.cross.length) {
      p('Сверка истории с метаданными тех же матчей:');
      p(table(['матч', 'герой', 'KDA', 'длит.', 'net_worth', 'player_team', 'match_result', 'outcome', 'победа по метаданным', 'game_mode', 'match_mode', 'abandoned'], R.cross.map((c) => [
        c.matchId, c.heroOk ? 'да' : 'НЕТ', c.kdaOk ? 'да' : 'НЕТ', c.durOk ? 'да' : 'НЕТ', c.netWorthOk == null ? '-' : c.netWorthOk ? 'да' : 'НЕТ',
        c.playerTeam, c.matchResult, c.outcome, c.wonMeta == null ? '?' : c.wonMeta ? 'да' : 'нет', c.gameMode, c.matchMode, c.abandoned])));
      if (R.winRules) p(`Правила победы по истории (совпало с метаданными из ${R.winRules.total}): ${Object.entries(R.winRules).filter(([k]) => k !== 'total').map(([k, v]) => `\`${k}\`: ${v}`).join('; ')}.`);
    }
  }
  p();

  p('## 3. Матчи');
  p(table(['матч', 'начало UTC', 'длит.', 'герой', 'итог', 'K/D/A', 'КБ', 'мс', 'убийства=итог', 'позиции', 'предметы (магаз./спос.)', 'флаги'], R.matches.map((m) => m.error
    ? [m.matchId, '', '', '', '', '', kb(m.bytes), m.ms ?? '', '', '', '', `**ошибка: ${m.error}**`]
    : [m.matchId, utc(m.d.startTime), mmss(m.d.durationS), R.heroName(m.d.heroId), m.d.won == null ? '?' : m.d.won ? 'победа' : 'поражение',
      `${m.d.totals.kills}/${m.d.totals.deaths}/${m.d.totals.assists}`, kb(m.bytes), m.ms ?? '',
      m.d.killTimes.length === m.d.totals.kills ? 'да' : `нет (${m.d.killTimes.length})`,
      !m.d.positions ? 'нет данных' : m.d.positions.usable ? `ок (${m.d.positions.target.within3}/${m.d.positions.target.checked})` : 'нет',
      `${m.kinds.shop}/${m.kinds.ability}`, m.flags.join('; ') || '-'])));
  p();

  const ok = R.matches.filter((m) => !m.error).map((m) => m.d);
  p(`## 4. Что подтверждено (из ${ok.length} загруженных матчей)`);
  const cnt = (fn) => ok.filter(fn).length;
  const patterns = new Map();
  for (const d of ok) { const k = d.snapshotTimes.slice(0, -1).join(','); patterns.set(k, (patterns.get(k) || 0) + 1); }
  p(table(['что', 'матчей', 'комментарий'], [
    ['Снимки статистики по времени', cnt((d) => d.snapshots.length > 0), `расписаний (без последнего снимка): ${patterns.size}`],
    ['Убийства (из смертей врагов) = итоговые', cnt((d) => d.killTimes.length === d.totals.kills), 'точное время'],
    ['Смерти с временем и позицией', cnt((d) => d.deathEvents.length === d.totals.deaths), ''],
    ['Позиции раз в секунду', cnt((d) => !!d.positions), ''],
    ['Позиции пригодны (путь игрока сходится со смертями, надёжны >=8 из 11 остальных)', cnt((d) => d.positions && d.positions.usable), `сверка по смертям после калибровки: ${pc(ok.filter((d) => d.positions).reduce((s, d) => s + (d.positions.overall.share ?? 0), 0) / Math.max(1, ok.filter((d) => d.positions).length))} в среднем`],
    ['Список предметов', cnt((d) => d.items.length > 0), ''],
    ['Время продажи предметов (sold_time_s > 0 хотя бы раз)', cnt((d) => d.items.some((i) => i.sold > 0)), ''],
    ['ID опубликованного билда (hero_build_ids)', cnt((d) => d.buildId != null), 'это не покупки'],
  ]));
  const top = [...patterns.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) p(`Расписание снимков (секунды, последний снимок всегда равен концу матча): ${top[0]} (${top[1]} из ${ok.length} матчей). Окна нерегулярные, расчёт делит прирост на длину окна.`);
  p();

  p('## 5. Предметы');
  const c = R.classification;
  p(`Справочник предметов: ${R.itemsIndex ? `загружен, записей ${R.itemsIndex.size}, ключ ID \`${R.itemsIndex.idKey}\`, найдено в нём ${c.found} из ${c.total} записей игрока (${pc(c.coverage)})` : '**не получен**, классификация только по гипотезе'}.`);
  if (R.itemsIndex) p(`Поля записи справочника: ${R.itemsIndex.sampleKeys.join(', ')}`);
  p(`Гипотеза: upgrade_id = 1 это покупка в магазине, иначе улучшение способности.`);
  p(table(['гипотеза | справочник', 'записей'], c.pairs.map(([k, v]) => [k, v])));
  p(c.agreement == null ? 'Сравнить гипотезу со справочником не с чем.' : `Совпадение гипотезы со справочником: **${pc(c.agreement)}** на ${c.comparable} записях.`);
  if (c.missingSample.length) p(`ID без записи в справочнике (топ): ${c.missingSample.map((x) => `${x.id}×${x.n}`).join(', ')}`);
  const ai = R.itemAgg;
  p(`Покупок в магазине за матч (мин/макс): ${Math.min(...ai.perMatch.shop)}/${Math.max(...ai.perMatch.shop)}; записей способностей: ${Math.min(...ai.perMatch.ability)}/${Math.max(...ai.perMatch.ability)}; проданных: ${Math.min(...ai.perMatch.soldShop)}/${Math.max(...ai.perMatch.soldShop)}; в финальном инвентаре: ${Math.min(...ai.perMatch.finalShop)}/${Math.max(...ai.perMatch.finalShop)}.`);
  p(`Предметы, купленные почти всегда (>=80% матчей): ${ai.almostAlways}.`);
  p(table(['предмет', 'матчей', 'ср. время покупки, мин', 'продан в матчах'], ai.top.map((r) => [r.name ? `${r.name} (${r.id})` : r.id, `${r.matches}/${ok.length}`, f(r.avgMin), r.soldMatches])));
  p();

  p('## 6. Предварительные показатели (НЕ официальные рейтинги)');
  const A = R.scores;
  p(`Использовано матчей: ${A.used} (${f(A.minutes, 0)} мин), с признаками по позициям: ${A.positionMatches}. Исключено: ${A.excluded.length ? A.excluded.map((e) => `${e.matchId} (${e.reason})`).join(', ') : 'нет'}.`);
  p('Метод: процентиль признака среди 12 игроков того же матча, затем среднее по матчам с весом по длительности. Сравнение идёт со случайной группой лобби, а не с героем или ролью.');
  p(table(['показатель', 'итог 0-100', 'составляющие (0-100)'], Object.entries(A.scores).map(([k, v]) => [k, v.score ?? 'н/д', Object.entries(v.parts).map(([a, b]) => `${a}: ${b ?? 'н/д'}`).join('; ')])));
  if (A.raw) p(`Сырые значения (суммы по времени): урон по героям ${f(A.raw.dmgPerMin, 0)}/мин, крипы+нейтралы ${f(A.raw.creepsPerMin)}/мин, души с крипов ${f(A.raw.goldCreepsPerMin, 0)}/мин, убийства ${f(A.raw.killsPerMin, 2)}/мин, ассисты ${f(A.raw.assistsPerMin, 2)}/мин, смерти ${f(A.raw.deathsPerMin, 2)}/мин, KDA ${f(A.raw.kda, 2)}, доля убитых из возможных крипов ${pc(A.raw.creepEfficiency)}.`);
  p();

  p('## 7. Таймлайн по 5 минутам (усреднение по матчам)');
  p(`Матч входит в корзину только для полностью прошедших минут. Урон, крипы и полученный урон равномерно распределены внутри окна снимка (3 мин до 15-й, затем 5). Убийства, смерти и позиции точные.`);
  p(table(['минуты', 'матчей', 'с позиц.', 'урон/мин', 'крипы/мин', 'получ./мин', 'убийства/10м', 'смерти/10м', 'рядом союзник', 'рядом враг', 'в бою'],
    R.timeline.map((b) => [`${b.from}-${b.to}`, b.n, b.nPos, f(b.dmgPerMin, 0), f(b.creepsPerMin), f(b.takenPerMin, 0), f(b.killsPer10), f(b.deathsPer10), pc(b.allyShare), pc(b.enemyShare), pc(b.combatShare)])));
  p(`Радиус «рядом»: ${R.radius} игровых единиц (предварительный). Значения combat_type и move_type не расшифрованы, колонка «в бою» = доля секунд с combat_type > 0, смысл не подтверждён.`);
  p();

  p('## 8. Время путей и смерти');
  p('Путь игрока (позиции раз в секунду) может быть растянут относительно игрового времени. Время приводится к игровому по смертям (момент смерти и момент, когда в пути здоровье падает до 0), проверка идёт без подглядывания.');
  if (R.pathSummary && R.pathSummary.length) {
    p(table(['матч', 'смертей (все игроки)', 'переходов здоровья в 0 / смертей', 'сдвиг без поправки в пределах ±3 с', 'сдвиг ±15 с', 'медианный сдвиг, с', 'после калибровки в пределах ±3 с', 'игроки с длинным путём (слот:разница, с)'],
      R.pathSummary.map((x) => { const d = ok.find((m) => m.matchId === x.matchId); return [x.matchId, x.deaths, x.zeroVsDeaths, `${x.within3}/${x.deaths}`, `${x.within15}/${x.deaths}`, x.medianOffset, d && d.positions ? pc(d.positions.overall.share) : 'н/д', x.longPaths.join(', ') || '-']; })));
    p('Подробности по каждой смерти: файл `paths-diagnostics.json`.');
  } else p('Нет данных.');
  p();

  p('## 9. Предупреждения');
  if (!R.warnings.length) p('Нет.');
  for (const w of R.warnings) p(`- ${w}`);
  p();
  p('Файлы рядом с отчётом: `report.json` (то же в машинном виде), `digests.json` (сводки матчей без больших массивов).');
  return L.join('\n');
}
