export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function doBoxesIntersect(a: BoundingBox, b: BoundingBox): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function isPointInBox(px: number, py: number, box: BoundingBox): boolean {
  return (
    px >= box.x &&
    px <= box.x + box.width &&
    py >= box.y &&
    py <= box.y + box.height
  );
}

export function getBoundingBox(objects: BoundingBox[]): BoundingBox | null {
  if (objects.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const obj of objects) {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + obj.width);
    maxY = Math.max(maxY, obj.y + obj.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
