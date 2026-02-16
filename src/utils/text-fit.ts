/**
 * Calculate the best font size to fit text within a container.
 * Uses a simple heuristic based on character count and container area.
 */
export function calculateFontSize(
  text: string,
  containerWidth: number,
  containerHeight: number,
  padding: number = 20,
  minFontSize: number = 10,
  maxFontSize: number = 48
): number {
  if (!text || text.length === 0) return 14; // default

  const availableWidth = containerWidth - padding * 2;
  const availableHeight = containerHeight - padding * 2;

  if (availableWidth <= 0 || availableHeight <= 0) return minFontSize;

  const area = availableWidth * availableHeight;
  const charCount = text.length;

  // Approximate: each character takes roughly fontSize * fontSize * 0.6 area
  // Solve for fontSize: fontSize = sqrt(area / (charCount * 0.6))
  let fontSize = Math.sqrt(area / (charCount * 0.65));

  // Also constrain by width: the longest line shouldn't overflow
  const lines = text.split("\n");
  const longestLine = Math.max(...lines.map((l) => l.length));
  if (longestLine > 0) {
    const maxByWidth = availableWidth / (longestLine * 0.58);
    fontSize = Math.min(fontSize, maxByWidth);
  }

  // Constrain by height: total line count * lineHeight shouldn't overflow
  const estimatedLineHeight = fontSize * 1.4;
  const estimatedWrappedLines = lines.reduce((total, line) => {
    const charsPerLine = Math.max(1, Math.floor(availableWidth / (fontSize * 0.58)));
    return total + Math.max(1, Math.ceil(line.length / charsPerLine));
  }, 0);
  const totalTextHeight = estimatedWrappedLines * estimatedLineHeight;

  if (totalTextHeight > availableHeight) {
    fontSize *= availableHeight / totalTextHeight;
  }

  // Clamp
  fontSize = Math.max(minFontSize, Math.min(maxFontSize, fontSize));

  return Math.round(fontSize * 10) / 10; // round to 1 decimal
}
