import React from "react";
import { StickyNote } from "./StickyNote";
import { Shape } from "./Shape";
import { LineObject } from "./LineTool";
import type { BoardObject } from "../../types/board";

export interface BoardObjectRendererProps {
  object: BoardObject;
  isSelected: boolean;
  editingObjectId: string | null;
  isLockedByOther: boolean;
  lockedBy?: string;
  lockedByColor?: string;
  isArrowHover: boolean;
  interactable: boolean;
  draftText?: string;
  onSelect: (id: string, multi?: boolean) => void;
  onDragStart: (e: any) => void;
  onDragMove: (e: any) => void;
  onDragEnd: (e: any) => void;
  onDoubleClick: (id: string) => void;
  onUpdateObject: (id: string, updates: Partial<BoardObject>) => void;
  onRotateStart: (id: string) => void;
  onRotateMove: (id: string, angle: number) => void;
  onRotateEnd: (id: string, angle: number) => void;
}

export function BoardObjectRenderer({
  object: obj,
  isSelected,
  editingObjectId,
  isLockedByOther,
  lockedBy,
  lockedByColor,
  isArrowHover,
  interactable,
  draftText,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDoubleClick,
  onUpdateObject,
  onRotateStart,
  onRotateMove,
  onRotateEnd,
}: BoardObjectRendererProps) {
  if (obj.type === "line") {
    return (
      <LineObject
        object={obj}
        isSelected={isSelected}
        onSelect={onSelect}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onUpdateObject={onUpdateObject}
      />
    );
  }

  if (obj.type === "rectangle" || obj.type === "circle") {
    return (
      <Shape
        object={obj}
        isSelected={isSelected}
        isEditing={editingObjectId === obj.id}
        isLockedByOther={isLockedByOther}
        lockedByColor={lockedByColor}
        isArrowHover={isArrowHover}
        interactable={interactable}
        draftText={draftText}
        onSelect={onSelect}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDoubleClick={onDoubleClick}
        onUpdateObject={onUpdateObject}
        onRotateStart={onRotateStart}
        onRotateMove={onRotateMove}
        onRotateEnd={onRotateEnd}
      />
    );
  }

  if (obj.type === "sticky") {
    return (
      <StickyNote
        object={obj}
        isSelected={isSelected}
        isEditing={editingObjectId === obj.id}
        isLockedByOther={isLockedByOther}
        lockedByName={lockedBy}
        lockedByColor={lockedByColor}
        draftText={draftText}
        isArrowHover={isArrowHover}
        interactable={interactable}
        onSelect={onSelect}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDoubleClick={onDoubleClick}
        onUpdateObject={onUpdateObject}
        onRotateStart={onRotateStart}
        onRotateMove={onRotateMove}
        onRotateEnd={onRotateEnd}
      />
    );
  }

  return null;
}
