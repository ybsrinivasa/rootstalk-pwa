"use client";
import { useTranslations } from "next-intl";

// Renders a backend-translated string with an optional "translation
// pending" indicator below. Used wherever a field carries `is_pending`
// from the API (PENDING auto-translation served while the Subject
// Expert hasn't yet reviewed it). The indicator must be subtle and
// non-alarming per Localisation Strategy §9.4: small grey italic.
//
// Source-of-truth English is always available via `englishFallback`
// for the case where a multi-lingual relative needs to verify a
// machine translation of high-stakes advisory copy (e.g. FarmPundit
// responses — see Strategy §2 nuance).
export function TranslatableText({
  text,
  isPending = false,
  englishFallback,
  className,
}: {
  text: string;
  isPending?: boolean;
  englishFallback?: string;
  className?: string;
}) {
  const t = useTranslations("common");
  return (
    <span className={className}>
      {text}
      {isPending && (
        <span className="block text-[10px] italic text-[#7A8C7E] mt-0.5">
          {t("translationPending")}
          {englishFallback && englishFallback !== text && (
            <span className="ml-1 text-[#9aa49b]">· {englishFallback}</span>
          )}
        </span>
      )}
    </span>
  );
}
