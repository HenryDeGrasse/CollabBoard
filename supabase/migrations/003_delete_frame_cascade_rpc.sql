-- Atomic frame deletion (frame + contained objects)
-- Keeps collaborator state consistent by applying a single transactional operation.

CREATE OR REPLACE FUNCTION public.delete_frame_cascade(
  p_board_id UUID,
  p_frame_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- Delete objects currently contained in this frame.
  DELETE FROM public.objects
  WHERE board_id = p_board_id
    AND parent_frame_id = p_frame_id;

  -- Delete the frame itself.
  DELETE FROM public.objects
  WHERE board_id = p_board_id
    AND id = p_frame_id
    AND type = 'frame';
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_frame_cascade(UUID, UUID) TO authenticated;
