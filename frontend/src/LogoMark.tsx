import { usePublicTheme } from "./PublicTheme";

export function LogoMark({ tone = "theme" }: { tone?: "theme" | "brand" }) {
  const { theme } = usePublicTheme();
  return (
    <img
      src={
        tone === "theme" && theme === "dark"
          ? "/brand/cdmento-mark-reverse.svg"
          : "/brand/cdmento-mark.svg"
      }
      alt=""
      width={704}
      height={507}
      className="cdmento-logo-mark"
      draggable={false}
    />
  );
}
