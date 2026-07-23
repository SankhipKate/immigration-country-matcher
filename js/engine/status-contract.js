export const ROUTE_STATUSES = Object.freeze({
  SUITABLE: 'SUITABLE',
  PRELIMINARY_SUITABLE: 'PRELIMINARY_SUITABLE',
  SUITABLE_WITH_CONDITIONS: 'SUITABLE_WITH_CONDITIONS',
  UNSUITABLE: 'UNSUITABLE',
  INSUFFICIENT_COUNTRY_DATA: 'INSUFFICIENT_COUNTRY_DATA',
  INDIVIDUAL_REVIEW_REQUIRED: 'INDIVIDUAL_REVIEW_REQUIRED',
});

export const STATUS_LABELS_RU = Object.freeze({
  SUITABLE: 'Подходит',
  PRELIMINARY_SUITABLE: 'Предварительно подходит',
  SUITABLE_WITH_CONDITIONS: 'Подходит с условиями',
  UNSUITABLE: 'Не подходит',
  INSUFFICIENT_COUNTRY_DATA: 'Есть неподтверждённые условия',
  INDIVIDUAL_REVIEW_REQUIRED: 'Нужна проверка',
});

export const COUNTRY_GROUP_LABELS_RU = Object.freeze({
  SUITABLE: 'Подходит',
  PRELIMINARY: 'Предварительный результат',
  REQUIRES_REVIEW: 'Требует дополнительной проверки',
  LEGAL_BUT_PRACTICALLY_UNSUITABLE: 'Юридически доступна, но не проходит практические условия',
  UNSUITABLE: 'Не подходит',
});

export const CONFLICT_SEVERITY_RANK = Object.freeze({
  UNSUITABLE: 6,
  INDIVIDUAL_REVIEW_REQUIRED: 5,
  INSUFFICIENT_COUNTRY_DATA: 4,
  PRELIMINARY_SUITABLE: 3,
  SUITABLE_WITH_CONDITIONS: 2,
  SUITABLE: 1,
});

export const SELECTION_PREFERENCE_RANK = Object.freeze({
  SUITABLE: 6,
  SUITABLE_WITH_CONDITIONS: 5,
  PRELIMINARY_SUITABLE: 4,
  INSUFFICIENT_COUNTRY_DATA: 3,
  INDIVIDUAL_REVIEW_REQUIRED: 2,
  UNSUITABLE: 1,
});

export function resolveStatusConflict(statuses) {
  if (!Array.isArray(statuses) || statuses.length === 0) return ROUTE_STATUSES.PRELIMINARY_SUITABLE;
  return statuses.reduce((strictest, current) =>
    CONFLICT_SEVERITY_RANK[current] > CONFLICT_SEVERITY_RANK[strictest] ? current : strictest
  );
}
