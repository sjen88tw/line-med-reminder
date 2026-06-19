// dose_event 狀態機。CONFIRMED 與 MISSED 是終態。
//
//   SCHEDULED ──► REMINDED ──► CONFIRMED            (按「已服藥」)
//       │            │   └────► ESCALATED ──► CONFIRMED   (逾時升級後才按)
//       └──► MISSED  └──► MISSED         └──► MISSED       (當餐結束未確認)
//
// 冪等規則靠 confirm 服務的 SQL 守(status IN ('REMINDED','ESCALATED'));
// 這裡是純粹的轉移合法性,給服務層在轉移前 assert。

export type DoseStatus = 'SCHEDULED' | 'REMINDED' | 'CONFIRMED' | 'ESCALATED' | 'MISSED';

const TRANSITIONS: Record<DoseStatus, DoseStatus[]> = {
  SCHEDULED: ['REMINDED', 'MISSED'],
  REMINDED: ['CONFIRMED', 'ESCALATED', 'MISSED'],
  ESCALATED: ['CONFIRMED', 'MISSED'],
  CONFIRMED: [],
  MISSED: [],
};

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: DoseStatus,
    public readonly to: DoseStatus,
  ) {
    super(`Illegal dose transition: ${from} -> ${to}`);
    this.name = 'IllegalTransitionError';
  }
}

export function canTransition(from: DoseStatus, to: DoseStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DoseStatus, to: DoseStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

export function isTerminal(status: DoseStatus): boolean {
  return TRANSITIONS[status]?.length === 0;
}
