const artModules = import.meta.glob("./*_*.webm", {
  eager: true,
  import: "default",
  query: "?url",
}) as Record<string, string>;

export type OperatorArtOrientation = "Vertical" | "Horizontal";

const orientationOverrides: Partial<
  Record<string, Partial<Record<OperatorArtOrientation, OperatorArtOrientation>>>
> = {
  塔露拉: { Horizontal: "Vertical" },
};

export function getOperatorArt(
  operatorName: string,
  orientation: OperatorArtOrientation,
) {
  const resolvedOrientation =
    orientationOverrides[operatorName]?.[orientation] ?? orientation;
  return artModules[`./${operatorName}_${resolvedOrientation}.webm`] ?? null;
}
