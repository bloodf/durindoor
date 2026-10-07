import React from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import MfaCard from "./MfaCard.jsx";

const secret = "JBSWY3DPEHPK3PXP";
// Generated from the same otpauth URI shape as /api/auth/mfa/setup.
const qrCodeDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAklEQVR4AewaftIAAAQgSURBVNXBS6ojQRDAQMn0/a+scYITisbvNztH2BMf7MGHu3hR+U7Fb6isiqWyKlRGxVIZFUPlOxUXh4p3VO5UKlT+okKlQmWpVKicKt5RGRc3KqeKdypUKk4qFUOlYlTcVawKlXdUThXr4j+oLJVVcapQGRUnlVExVEbFXzz4cA/+Q8WoeEdFRaWi4lRxV1Gh8hcXNxXfUamoGBVDReVOZVQslYqh8pOKr1wcVH5LpUJlVKhUqIwKlQqVUbFUKoZKhcpJ5Tv2xH9QqVgqdxVLZVS8o1LxVw8+3IMXlaWiMlRUlopKhco7FRUqq6JCRUXlVKEyVFSGyncuDiqjYqhUDJVRobJUVoXKncpdxVBZFV9RGRVDpeLiUDFUTiqnCpVTxahQWSoVKqNiqawKlYqfqCx74qBSMVQqhso7FUNlVXxFZVWojIql8pWK08WLyqhQGRUqo2KojAqVuwqVVaFyqnhHZVQMlYo7lVHx4MM9OFSoLJWKilXxTsVvVKgMlaVSMVRUTioqKhXrwU1FRcVQUVkqq0JFZVSonFQq7lQqvlMxVCoqhsq6eENlVQyVUTFU7lQqlsqqGCqjQqViqVSoLJVTxcmeeFEZFUNlVQyVUfEbKqPipDIqhkqFSsVXVFbFgw938aIyKlRGxVIZFUPlVDFUVsVSWRWjQuVUoTIqVL5z8UbFUhkVQ2VUqJxU7ireqbhTqbirWCqni5eKoVJxqlAZFUOlQmWoVJxURsVSGRUqFUtFpWKoDJWKVaEyLl5URsWdSsVS+YrKqlgqq0JlqJwq3lEZFaNiPPhwD14qhoqKisqoUFFRGRUqq0Kl4qTyTsWpokLlruJOZdgTTyoVKqtiqFQslXcqhsqqUKn4jkrFSeWuQqVi2BMvKhUqo+JOZVT8RKXipFKh8lsVJ5VRcXGjUnFSqfiJSsWqGCqrQmVUqKyKk0rFUBkVp4ubCpVRoVKhMioGSsWpQuVUUaFyqnhHpeK3Hny4ixeVirsKlYqlUjFUVkXFUhkqFatiqFQslYp3KoZKhcq4eKlQuVOpOFUMlYqlMipOFSrvqNypjAqVUbFUlj3xpDIqVFaFSsVSGRUqo0KlYqmMiqUyKlQqlspfVNgTf6AyKlQqlsqoWCoVKqNiqIyKoVKhUnFSqVgqFePBh7MnnlS+U7FURsVJ5VShUqGyKobKOxVDpULlVLEuDhXvqCyVijuVCpWlMlRWhcpdxVBZFatiqJwublROFacKlQqVVaFSofKdCpUKlTuVO5VRoTIqHvyRyqpYKkNlVayKilUxKipUVkVFxU8efLgHf1Txk4qKUfEbFSp3FaOiQqViXdxU/IZKxapYKqNCZaicKobKqlBRGRUqQ2VUjIpxcVD5icpSuVNZKqNCZVWojIpTxVJZFUtlVNgTH+wfZKGyndMp2s0AAAAASUVORK5CYII=";
const setupSuccess = { secret, qrCodeDataUri };
const backupCodes = ["backup-amber", "backup-copper", "backup-ivory"];

const baseFixture = { scenario: "default", pathname: "/dashboard/profile" };

async function openEnrollment(canvas) {
  await userEvent.click(await canvas.findByRole("button", { name: "Enable two-factor" }));
  return within(await within(document.body).findByRole("dialog", { name: "Enable two-factor authentication" }));
}

export default {
  title: "Production/profile/MfaCard",
  component: MfaCard,
  args: { mfaEnabled: false, mfaBackupCodesRemaining: 0, onChanged: () => {} },
  parameters: { storyFixture: baseFixture },
};

export const SetupApiError = {
  parameters: { storyFixture: { ...baseFixture, routes: { "POST /api/auth/mfa/setup": { status: 401, body: { error: "Invalid password" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const dialog = await openEnrollment(canvas);
    await userEvent.type(dialog.getByLabelText("Current password"), "wrong-password");
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
    await expect(await dialog.findByText("Invalid password")).toBeVisible();
  },
};

export const EnrollmentShowsBackupCodes = {
  parameters: {
    storyFixture: {
      ...baseFixture,
      routes: {
        "POST /api/auth/mfa/setup": { body: setupSuccess },
        "POST /api/auth/mfa/enable": { body: { success: true, backupCodes } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let dialog = await openEnrollment(canvas);
    await userEvent.type(dialog.getByLabelText("Current password"), "current-password");
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));

    dialog = within(await within(document.body).findByRole("dialog", { name: "Enable two-factor authentication" }));
    const qr = await dialog.findByRole("img", { name: "Authenticator QR code" });
    await expect(qr).toBeVisible();
    await waitFor(() => {
      expect(qr.complete).toBe(true);
      expect(qr.naturalWidth).toBeGreaterThan(0);
      expect(qr.naturalHeight).toBeGreaterThan(0);
    });
    await expect(dialog.getByText(secret)).toBeVisible();
    await userEvent.type(dialog.getByLabelText("6-digit code"), "123456");
    await userEvent.click(dialog.getByRole("button", { name: "Verify and enable" }));

    for (const backupCode of backupCodes) await expect(await dialog.findByText(backupCode)).toBeVisible();
    await expect(dialog.getByText(/shown only this one time/i)).toBeVisible();
  },
};

export const VerificationApiError = {
  parameters: {
    storyFixture: {
      ...baseFixture,
      routes: {
        "POST /api/auth/mfa/setup": { body: setupSuccess },
        "POST /api/auth/mfa/enable": { status: 401, body: { error: "Invalid code. Check your authenticator and try again." } },
      },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    let dialog = await openEnrollment(canvas);
    await userEvent.type(dialog.getByLabelText("Current password"), "current-password");
    await userEvent.click(dialog.getByRole("button", { name: "Continue" }));
    dialog = within(await within(document.body).findByRole("dialog", { name: "Enable two-factor authentication" }));
    const qr = await dialog.findByRole("img", { name: "Authenticator QR code" });
    await expect(qr).toBeVisible();
    await waitFor(() => {
      expect(qr.complete).toBe(true);
      expect(qr.naturalWidth).toBeGreaterThan(0);
    });
    await userEvent.type(dialog.getByLabelText("6-digit code"), "000000");
    await userEvent.click(dialog.getByRole("button", { name: "Verify and enable" }));
    await expect(await dialog.findByText("Invalid code. Check your authenticator and try again.")).toBeVisible();
  },
};

export const Enabled = {
  args: { mfaEnabled: true, mfaBackupCodesRemaining: 4 },
  parameters: { storyFixture: baseFixture },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/4 backup codes remaining/i)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Disable two-factor" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Disable two-factor authentication" }));
    await expect(dialog.getByLabelText("Current password")).toBeVisible();
    await expect(dialog.getByLabelText("Authentication or backup code")).toBeVisible();
  },
};

export const DisableApiError = {
  args: { mfaEnabled: true, mfaBackupCodesRemaining: 1 },
  parameters: { storyFixture: { ...baseFixture, routes: { "POST /api/auth/mfa/disable": { status: 401, body: { error: "Invalid code. 4 attempt(s) left before lockout." } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Disable two-factor" }));
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole("dialog", { name: "Disable two-factor authentication" }));
    await userEvent.type(dialog.getByLabelText("Current password"), "current-password");
    await userEvent.type(dialog.getByLabelText("Authentication or backup code"), "123456");
    await userEvent.click(dialog.getByRole("button", { name: "Disable two-factor" }));
    await expect(await dialog.findByText("Invalid code. 4 attempt(s) left before lockout.")).toBeVisible();
  },
};
