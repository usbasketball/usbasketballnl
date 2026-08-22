import { afterEach, describe, expect, it, vi } from "vitest";

const headersMock = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: () => headersMock,
}));

const prismaMock = vi.hoisted(() => ({
  interestSubmission: {
    create: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

const emailMock = vi.hoisted(() => ({
  sendInterestConfirmation: vi.fn().mockResolvedValue(undefined),
  sendInterestNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/email", () => emailMock);

const sentryMock = vi.hoisted(() => ({
  logger: { warn: vi.fn() },
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => sentryMock);

import { submitInterest } from "@/lib/actions/interest";

const fetchMock = vi.fn<typeof globalThis.fetch>();

function buildFormData(
  overrides: Partial<Record<string, string>> = {}
): FormData {
  const data = new FormData();
  data.set("locale", overrides.locale ?? "en");
  data.set("name", overrides.name ?? "Jane Doe");
  data.set("email", overrides.email ?? "jane@example.com");
  data.set("birthDate", overrides.birthDate ?? "1990-06-15");
  data.set("position", overrides.position ?? "guard");
  data.set("interest", overrides.interest ?? "compete");
  data.set("gender", overrides.gender ?? "man");
  data.set("lastLevel", overrides.lastLevel ?? "3");
  data.set("lastSeason", overrides.lastSeason ?? "");
  data.set("background", overrides.background ?? "");
  data.set(
    "cf-turnstile-response",
    overrides["cf-turnstile-response"] ?? "valid-token-abc"
  );
  return data;
}

const stubSubmission = {
  id: "1",
  name: "Jane Doe",
  email: "jane@example.com",
  birthDate: new Date("1990-06-15"),
  position: "guard",
  interest: "compete",
  gender: "man",
  lastLevel: "3",
  lastSeason: null,
  background: null,
  locale: "en",
  createdAt: new Date(),
};

describe("submitInterest", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    prismaMock.interestSubmission.create.mockReset();
    emailMock.sendInterestConfirmation.mockReset();
    emailMock.sendInterestConfirmation.mockResolvedValue(undefined);
    emailMock.sendInterestNotification.mockReset();
    emailMock.sendInterestNotification.mockResolvedValue(undefined);
    globalThis.fetch = originalFetch;
    process.env.TURNSTILE_SECRET = "";
    process.env.TURNSTILE_HOSTNAMES = "";
  });

  describe("validation", () => {
    it("returns missing_fields when required fields are absent", async () => {
      const formData = buildFormData({ name: "" });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "missing_fields" });
    });

    it("returns missing_fields for invalid locale", async () => {
      const formData = buildFormData({ locale: "fr" });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "missing_fields" });
    });

    it("returns invalid_email for bad email", async () => {
      const formData = buildFormData({ email: "not-an-email" });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "invalid_email" });
    });

    it("returns invalid_birth_date for unparseable date", async () => {
      const formData = buildFormData({ birthDate: "not-a-date" });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "invalid_birth_date" });
    });

    it("returns underage for users under 18", async () => {
      const recent = new Date();
      recent.setFullYear(recent.getFullYear() - 10);
      const dateStr = recent.toISOString().slice(0, 10);
      const formData = buildFormData({ birthDate: dateStr });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "underage" });
    });

    it("returns missing_fields for invalid position", async () => {
      const formData = buildFormData({ position: "bench" });
      const result = await submitInterest({}, formData);
      expect(result).toEqual({ error: "missing_fields" });
    });
  });

  describe("captcha verification", () => {
    it("bypasses verification when TURNSTILE_SECRET is not set", async () => {
      process.env.TURNSTILE_SECRET = "";
      process.env.TURNSTILE_HOSTNAMES = "";
      globalThis.fetch = fetchMock;

      prismaMock.interestSubmission.create.mockResolvedValue(stubSubmission);

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ success: true });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects when TURNSTILE_HOSTNAMES is not configured", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "";
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects when token is empty", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      globalThis.fetch = fetchMock;

      const formData = buildFormData({ "cf-turnstile-response": "" });
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects when Cloudflare returns success:false", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: false,
          action: "interest_form",
          hostname: "example.com",
        }),
      } as Response);
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("rejects when action does not match", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          action: "wrong_action",
          hostname: "example.com",
        }),
      } as Response);
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
    });

    it("rejects when hostname does not match", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          action: "interest_form",
          hostname: "evil.com",
        }),
      } as Response);
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
    });

    it("rejects when fetch fails", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockRejectedValue(new Error("network error"));
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
    });

    it("rejects when Cloudflare returns non-OK HTTP status", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
      globalThis.fetch = fetchMock;

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "captcha_failed" });
    });

    it("succeeds when Cloudflare verification passes", async () => {
      process.env.TURNSTILE_SECRET = "sec";
      process.env.TURNSTILE_HOSTNAMES = "example.com";
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          action: "interest_form",
          hostname: "example.com",
        }),
      } as Response);
      globalThis.fetch = fetchMock;
      prismaMock.interestSubmission.create.mockResolvedValue(stubSubmission);

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ success: true });
    });
  });

  describe("happy path", () => {
    it("creates submission and sends emails", async () => {
      process.env.TURNSTILE_SECRET = "";
      prismaMock.interestSubmission.create.mockResolvedValue(stubSubmission);

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ success: true });
      expect(prismaMock.interestSubmission.create).toHaveBeenCalledOnce();
      expect(emailMock.sendInterestConfirmation).toHaveBeenCalledOnce();
      expect(emailMock.sendInterestNotification).toHaveBeenCalledOnce();
    });

    it("still returns success if email sending fails", async () => {
      process.env.TURNSTILE_SECRET = "";
      prismaMock.interestSubmission.create.mockResolvedValue(stubSubmission);
      emailMock.sendInterestConfirmation.mockRejectedValue(
        new Error("email down")
      );

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ success: true });
    });

    it("returns generic error when database insert fails", async () => {
      process.env.TURNSTILE_SECRET = "";
      prismaMock.interestSubmission.create.mockRejectedValue(
        new Error("db error")
      );

      const formData = buildFormData();
      const result = await submitInterest({}, formData);

      expect(result).toEqual({ error: "generic" });
    });
  });
});
