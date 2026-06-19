// Minimal query surface satisfied by both pg.Pool and pg-mem's pg adapter.
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export interface Member {
  id: number;
  line_user_id: string;
  display_name: string | null;
  created_at: Date;
}

export function makeMemberService(db: Queryable) {
  return {
    // Idempotent on line_user_id: a repeated `follow` event updates the
    // display name but never creates a second row.
    async upsertByLineUserId(
      lineUserId: string,
      displayName: string | null,
    ): Promise<Member> {
      const { rows } = await db.query(
        `INSERT INTO member (line_user_id, display_name)
         VALUES ($1, $2)
         ON CONFLICT (line_user_id)
         DO UPDATE SET display_name = EXCLUDED.display_name
         RETURNING *`,
        [lineUserId, displayName],
      );
      return rows[0] as Member;
    },
  };
}

export type MemberService = ReturnType<typeof makeMemberService>;
