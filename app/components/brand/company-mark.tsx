// 合同会社多元現実の会社マーク（04F-1）。
// 形状の正本は plural-reality/website の client/public/brand/mark.svg。パスの幾何・比率は変えない。
// viewBox は -16 -16 352 256（幅:高さ = 1.375:1）。塗りは currentColor。
export const COMPANY_MARK_VIEW_BOX = "-16 -16 352 256";

export const COMPANY_MARK_PATHS = [
  "M 0.0000 12.0000 A 12 12 0 0 1 12.0000 0.0000 L 147.0294 0.0000 A 12 12 0 0 1 155.5147 20.4853 L 83.5147 92.4853 A 12 12 0 0 1 75.0294 96.0000 L 12.0000 96.0000 A 12 12 0 0 1 0.0000 84.0000 Z",
  "M 0.0000 128.0000 A 12 12 0 0 1 12.0000 116.0000 L 83.3137 116.0000 A 12 12 0 0 0 91.7990 112.4853 L 192.7696 11.5147 A 12 12 0 0 1 201.2548 8.0000 L 308.0000 8.0000 A 12 12 0 0 1 320.0000 20.0000 L 320.0000 96.0000 A 12 12 0 0 1 308.0000 108.0000 L 236.6863 108.0000 A 12 12 0 0 0 228.2010 111.5147 L 127.2304 212.4853 A 12 12 0 0 1 118.7452 216.0000 L 12.0000 216.0000 A 12 12 0 0 1 0.0000 204.0000 Z",
  "M 320.0000 212.0000 A 12 12 0 0 1 308.0000 224.0000 L 172.9706 224.0000 A 12 12 0 0 1 164.4853 203.5147 L 236.4853 131.5147 A 12 12 0 0 1 244.9706 128.0000 L 308.0000 128.0000 A 12 12 0 0 1 320.0000 140.0000 Z",
] as const;

type CompanyMarkProps = Readonly<{
  className?: string;
  title?: string;
}>;

export function CompanyMark({ className, title }: CompanyMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={COMPANY_MARK_VIEW_BOX}
      fill="currentColor"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {COMPANY_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
