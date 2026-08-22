"use server";

import { headers } from "next/headers";
import * as Sentry from "@sentry/nextjs";

import {
  sendInterestConfirmation,
  sendInterestNotification,
} from "@/lib/email";
import { prisma } from "@/lib/prisma";

export type ActionState = {
  error?: string;
  success?: boolean;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_POSITIONS = new Set([
  "guard",
  "forward",
  "center",
  "not_applicable",
  "other",
]);
const VALID_INTERESTS = new Set(["compete", "training_only", "undecided"]);
const VALID_GENDERS = new Set(["man", "vrouw"]);
const VALID_LOCALES = new Set(["en", "nl"]);

const TURNSTILE_ACTION = "interest_form";

async function getClientIp(): Promise<string | undefined> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || undefined;
}

async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return true;
  if (!token || token.length > 2048) {
    return false;
  }

  const expectedHostnames = new Set(
    (process.env.TURNSTILE_HOSTNAMES ?? "")
      .split(",")
      .map((hostname) => hostname.trim())
      .filter(Boolean)
  );
  if (expectedHostnames.size === 0) {
    Sentry.logger.warn("turnstile.missing_hostnames");
    return false;
  }

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const body = new URLSearchParams({ secret, response: token });
    const ip = await getClientIp();
    if (ip) body.set("remoteip", ip);
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(10_000),
        body,
      }
    );
    if (!res.ok) return false;
    result = (await res.json()) as typeof result;
  } catch (error) {
    Sentry.captureException(error);
    return false;
  }

  return (
    result.success === true &&
    result.action === TURNSTILE_ACTION &&
    expectedHostnames.has(result.hostname ?? "")
  );
}

function isAtLeast18(birthDate: Date): boolean {
  const now = new Date();
  const cutoff = new Date(
    now.getFullYear() - 18,
    now.getMonth(),
    now.getDate()
  );
  return birthDate <= cutoff;
}

export async function submitInterest(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  const locale = String(formData.get("locale") ?? "nl").toLowerCase();
  if (!VALID_LOCALES.has(locale)) {
    return { error: "missing_fields" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const birthDate = String(formData.get("birthDate") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim();
  const interest = String(formData.get("interest") ?? "").trim();
  const gender = String(formData.get("gender") ?? "").trim();
  const lastLevel = String(formData.get("lastLevel") ?? "").trim() || null;
  const lastSeason = String(formData.get("lastSeason") ?? "").trim() || null;
  const background = String(formData.get("background") ?? "").trim() || null;

  if (
    !name ||
    !email ||
    !birthDate ||
    !position ||
    !interest ||
    !gender ||
    !lastLevel
  ) {
    return { error: "missing_fields" };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { error: "invalid_email" };
  }
  const birth = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(birth.getTime())) {
    return { error: "invalid_birth_date" };
  }
  if (!isAtLeast18(birth)) {
    return { error: "underage" };
  }
  if (
    !VALID_POSITIONS.has(position) ||
    !VALID_INTERESTS.has(interest) ||
    !VALID_GENDERS.has(gender)
  ) {
    return { error: "missing_fields" };
  }

  const turnstileToken = String(
    formData.get("cf-turnstile-response") ?? ""
  ).trim();
  if (!(await verifyTurnstile(turnstileToken))) {
    Sentry.logger.warn("interest.captcha_failed", {
      hasToken: !!turnstileToken,
    });
    return { error: "captcha_failed" };
  }

  let submission;
  try {
    submission = await prisma.interestSubmission.create({
      data: {
        name,
        email,
        birthDate: birth,
        position,
        interest,
        gender,
        lastLevel,
        lastSeason,
        background,
        locale,
      },
    });
  } catch (error) {
    Sentry.captureException(error);
    return { error: "generic" };
  }

  const emailData = {
    name: submission.name,
    email: submission.email,
    birthDate: submission.birthDate,
    position: submission.position,
    interest: submission.interest,
    gender: submission.gender,
    lastLevel: submission.lastLevel,
    lastSeason: submission.lastSeason,
    background: submission.background,
    locale: submission.locale,
  };

  const results = await Promise.allSettled([
    sendInterestConfirmation(emailData),
    sendInterestNotification(emailData),
  ]);

  for (const [, result] of results.entries()) {
    if (result.status === "rejected") {
      Sentry.captureException(result.reason);
    }
  }

  return { success: true };
}
