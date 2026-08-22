"use client";

import { useActionState, useRef, useState, startTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { submitInterest, type ActionState } from "@/lib/actions/interest";
import {
  TurnstileWidget,
  type TurnstileHandle,
} from "@/components/turnstile";
import {
  buttonClass,
  errorTextClass,
  inputClass,
  labelClass,
} from "@/lib/field-styles";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

const initialState: ActionState = {};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAtLeast18(birthDate: Date): boolean {
  const now = new Date();
  const cutoff = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  return birthDate <= cutoff;
}

type ErrorKey = "invalid_email" | "invalid_birth_date" | "underage";

type FieldErrors = {
  email?: ErrorKey;
  birthDate?: ErrorKey;
};

function validateForm(formData: FormData): FieldErrors {
  const errors: FieldErrors = {};

  const email = String(formData.get("email") ?? "").trim();
  if (email && !EMAIL_REGEX.test(email)) {
    errors.email = "invalid_email";
  }

  const birthDate = String(formData.get("birthDate") ?? "");
  if (birthDate) {
    const dob = new Date(`${birthDate}T00:00:00`);
    if (Number.isNaN(dob.getTime())) {
      errors.birthDate = "invalid_birth_date";
    } else if (!isAtLeast18(dob)) {
      errors.birthDate = "underage";
    }
  }

  return errors;
}

const positions = [
  { value: "guard", label: "positionGuard" },
  { value: "forward", label: "positionForward" },
  { value: "center", label: "positionCenter" },
  { value: "not_applicable", label: "positionNotApplicable" },
  { value: "other", label: "positionOther" },
] as const;
const interests = [
  { value: "compete", label: "interestCompete" },
  { value: "training_only", label: "interestTrainingOnly" },
  { value: "undecided", label: "interestUndecided" },
] as const;
const genders = [
  { value: "man", label: "genderMan" },
  { value: "vrouw", label: "genderVrouw" },
] as const;

type Option = { value: string; label: string };

function RadioGroup({
  legend,
  name,
  options,
}: {
  legend: string;
  name: string;
  options: readonly Option[];
}) {
  const t = useTranslations("Signup");
  return (
    <fieldset>
      <legend className={labelClass}>{legend} *</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {options.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-ink"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              required
              className="size-4 accent-brand"
            />
            <span>{t(option.label)}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function InterestForm() {
  const t = useTranslations("Signup");
  const locale = useLocale();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [token, setToken] = useState("");
  const [captchaError, setCaptchaError] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);
  const [state, formAction, isPending] = useActionState(
    submitInterest,
    initialState
  );

  const hasErrors = Boolean(errors.email || errors.birthDate);

  if (state?.success) {
    return (
      <div className="space-y-3">
        <h2 className="font-display text-xl uppercase tracking-wide text-ink">
          {t("success.title")}
        </h2>
        <p className="leading-relaxed text-ink-muted">{t("success.text")}</p>
      </div>
    );
  }

  function handleChange(event: React.FormEvent<HTMLFormElement>) {
    setErrors(validateForm(new FormData(event.currentTarget)));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const nextErrors = validateForm(formData);
    if (nextErrors.email || nextErrors.birthDate) {
      setErrors(nextErrors);
      event.preventDefault();
      return;
    }
    event.preventDefault();
    setErrors({});
    if (TURNSTILE_SITE_KEY && !token) {
      setCaptchaError(t("errors.captcha_failed"));
      return;
    }
    setCaptchaError(null);
    formData.set("cf-turnstile-response", token);
    startTransition(() => {
      formAction(formData);
    });
    turnstileRef.current?.reset();
  }

  return (
    <form
      onChange={handleChange}
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      <input type="hidden" name="locale" value={locale} />
      <div>
        <label htmlFor="name" className={labelClass}>
          {t("name")} *
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="name"
          placeholder={t("namePlaceholder")}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="email" className={labelClass}>
          {t("email")} *
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className={inputClass}
        />
        {errors.email ? (
          <p className="mt-2 text-sm text-red-700">
            {t(`errors.${errors.email}`)}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="birthDate" className={labelClass}>
          {t("birthDate")} *
        </label>
        <input
          id="birthDate"
          name="birthDate"
          type="date"
          required
          max={new Date().toISOString().slice(0, 10)}
          className={inputClass}
        />
        {errors.birthDate ? (
          <p className="mt-2 text-sm text-red-700">
            {t(`errors.${errors.birthDate}`)}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="lastLevel" className={labelClass}>
          {t("lastLevel")} *
        </label>
        <input
          id="lastLevel"
          name="lastLevel"
          type="text"
          required
          placeholder={t("lastLevelPlaceholder")}
          className={inputClass}
        />
      </div>

      <RadioGroup
        legend={t("position")}
        name="position"
        options={positions}
      />
      <p className="-mt-3 text-xs text-ink-muted">{t("positionNote")}</p>

      <div>
        <label htmlFor="lastSeason" className={labelClass}>
          {t("lastSeason")}
        </label>
        <input
          id="lastSeason"
          name="lastSeason"
          type="text"
          placeholder={t("lastSeasonPlaceholder")}
          className={inputClass}
        />
      </div>

      <RadioGroup
        legend={t("interest")}
        name="interest"
        options={interests}
      />

      <RadioGroup
        legend={t("gender")}
        name="gender"
        options={genders}
      />

      <div>
        <label htmlFor="background" className={labelClass}>
          {t("background")}
        </label>
        <textarea
          id="background"
          name="background"
          rows={5}
          placeholder={t("backgroundPlaceholder")}
          className={inputClass}
        />
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        {t("privacyNote")}
      </p>

      {state?.error ? (
        <p className={errorTextClass}>{t(`errors.${state.error}`)}</p>
      ) : null}

      {TURNSTILE_SITE_KEY ? (
        <div className="flex min-h-[65px] items-center justify-center">
          <TurnstileWidget
            ref={turnstileRef}
            siteKey={TURNSTILE_SITE_KEY}
            onToken={(newToken) => {
              setToken(newToken);
              setCaptchaError(null);
            }}
            onExpire={() => setToken("")}
          />
        </div>
      ) : null}
      {captchaError ? (
        <p className="text-sm text-red-700">{captchaError}</p>
      ) : null}

      <button
        type="submit"
        disabled={isPending || hasErrors}
        className={buttonClass}
      >
        {isPending ? "..." : t("submit")}
      </button>
    </form>
  );
}
