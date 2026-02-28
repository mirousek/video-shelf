export const VIDEO_COLORS = [
  "#6c5ce7",
  "#00b894",
  "#e17055",
  "#0984e3",
  "#fdcb6e",
  "#e84393",
  "#00cec9",
  "#d63031",
];

export function colorForVideo(videoIndex: number): string {
  return VIDEO_COLORS[videoIndex % VIDEO_COLORS.length];
}
