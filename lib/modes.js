// Режимы матчей. Значения из истории матчей и метаданных (поля game_mode, match_mode).
// Подтверждено данными kkuzya (1207 матчей): game_mode 1 — обычные 6×6; game_mode 4 — у этих матчей
// заполнены brawl_score_team0/1 и brawl_avg_round_time_s, это Street Brawl.
// match_mode: подписи по перечислению Valve (ECitadelMatchMode). В данных встречаются 1, 4, 7.
// Проверено на 10 метаданных kkuzya: match_mode 4 всегда с ranked_type 1 (рейтинговый),
// match_mode 1 всегда с ranked_type 0 (без рейтинга). Подпись для 7 не проверена.

export const GAME_MODES = {
  1: { key: 'normal', label: 'Обычный 6×6', confirmed: true },
  4: { key: 'brawl', label: 'Street Brawl', confirmed: true },
};

export const MATCH_MODES = {
  1: { label: 'Без рейтинга', confirmed: true },
  4: { label: 'Рейтинговый', confirmed: true },
  7: { label: 'Hero Labs', confirmed: false },
};

/** Описание режима матча. Неизвестные значения не угадываются. */
export function describeMode(gameMode, matchMode) {
  const g = GAME_MODES[gameMode];
  const m = MATCH_MODES[matchMode];
  return {
    gameMode: gameMode ?? null,
    matchMode: matchMode ?? null,
    kind: g ? g.key : 'unknown',
    gameLabel: g ? g.label : gameMode == null ? 'Режим не указан' : `Режим ${gameMode} (неизвестен)`,
    matchLabel: m ? m.label : matchMode == null ? null : `Тип ${matchMode} (неизвестен)`,
    matchLabelConfirmed: m ? m.confirmed : false,
  };
}

/** По умолчанию в анализ входят только обычные матчи 6×6. */
export const isNormalMatch = (gameMode) => gameMode === 1;
