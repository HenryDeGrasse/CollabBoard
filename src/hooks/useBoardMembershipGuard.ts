import { useEffect, useRef } from "react";
import { supabase } from "../services/supabase";

interface Params {
  boardId: string;
  userId: string;
  onRemoved: () => void;
  pollMs?: number;
}

/**
 * Kicks a user back out of a board if their membership is removed.
 * Uses realtime + polling fallback for reliability.
 */
export function useBoardMembershipGuard({ boardId, userId, onRemoved, pollMs = 3000 }: Params) {
  const kickedRef = useRef(false);
  const wasMemberRef = useRef(false);

  useEffect(() => {
    if (!boardId || !userId) return;

    kickedRef.current = false;
    wasMemberRef.current = false;

    const checkMembership = async () => {
      if (kickedRef.current) return;

      const { data } = await supabase
        .from("board_members")
        .select("role")
        .eq("board_id", boardId)
        .eq("user_id", userId)
        .maybeSingle();

      if (data) {
        wasMemberRef.current = true;
      } else if (wasMemberRef.current) {
        kickedRef.current = true;
        onRemoved();
      }
    };

    const channel = supabase
      .channel(`board-membership-${boardId}-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "board_members",
          filter: `board_id=eq.${boardId}`,
        },
        () => {
          void checkMembership();
        }
      )
      .subscribe();

    const timer = setInterval(() => {
      void checkMembership();
    }, pollMs);

    const onFocus = () => {
      void checkMembership();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [boardId, userId, onRemoved, pollMs]);
}
