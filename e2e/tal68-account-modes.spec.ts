import { expect, test } from "@playwright/test";
import { allowedModes, canUseAdminMode, isAllowedMode, landingPath } from "../src/lib/account-modes";

/**
 * TAL-68 — tests unitarios (sin navegador) de las reglas de modos del menú
 * de la cuenta y del aterrizaje tras el login (`src/lib/account-modes.ts`).
 */
const superAdmin = { isSuperAdmin: true };
const admin = { isSuperAdmin: false };
const guest = { isSuperAdmin: false };

test.describe("allowedModes", () => {
  test("Super Admin: Usuario, Admin y Super Admin (aunque no administre nada)", () => {
    expect(allowedModes(superAdmin, 0)).toEqual(["user", "admin", "superadmin"]);
    expect(allowedModes(superAdmin, 3)).toEqual(["user", "admin", "superadmin"]);
  });
  test("Admin normal: Usuario y Admin, nunca Super Admin", () => {
    expect(allowedModes(admin, 2)).toEqual(["user", "admin"]);
  });
  test("invitado puro: solo Usuario (el menú no pinta la sección Modo)", () => {
    expect(allowedModes(guest, 0)).toEqual(["user"]);
  });
});

test("isAllowedMode: superadmin solo para el Super Admin; admin solo si puede usar el modo Admin", () => {
  expect(isAllowedMode("superadmin", superAdmin, 0)).toBe(true);
  expect(isAllowedMode("superadmin", admin, 5)).toBe(false);
  expect(isAllowedMode("superadmin", guest, 0)).toBe(false);
  expect(isAllowedMode("admin", admin, 1)).toBe(true);
  expect(isAllowedMode("admin", guest, 0)).toBe(false);
  expect(isAllowedMode("user", guest, 0)).toBe(true);
});

test("canUseAdminMode (TAL-59) sigue igual tras moverse a account-modes.ts", () => {
  expect(canUseAdminMode(superAdmin, 0)).toBe(true);
  expect(canUseAdminMode(admin, 1)).toBe(true);
  expect(canUseAdminMode(guest, 0)).toBe(false);
});

test.describe("landingPath", () => {
  test("Super Admin que recordó Super Admin → /superadmin", () => {
    expect(landingPath({ ...superAdmin, preferredMode: "superadmin" }, 0)).toBe("/superadmin");
  });
  test("ex Super Admin con «superadmin» guardado que administra calendarios → /admin (no /unauthorized)", () => {
    expect(landingPath({ ...admin, preferredMode: "superadmin" }, 2)).toBe("/admin");
  });
  test("ex Super Admin con «superadmin» guardado sin calendarios → /c", () => {
    expect(landingPath({ ...guest, preferredMode: "superadmin" }, 0)).toBe("/c");
  });
  test("modo Usuario recordado → /c (Admin o Super Admin)", () => {
    expect(landingPath({ ...admin, preferredMode: "user" }, 1)).toBe("/c");
    expect(landingPath({ ...superAdmin, preferredMode: "user" }, 0)).toBe("/c");
  });
  test("sin modo recordado: Admin → /admin; invitado → /c", () => {
    expect(landingPath({ ...admin, preferredMode: null }, 1)).toBe("/admin");
    expect(landingPath({ ...superAdmin, preferredMode: null }, 0)).toBe("/admin");
    expect(landingPath({ ...guest, preferredMode: null }, 0)).toBe("/c");
  });
  test("«admin» recordado por quien ya no administra nada → /c", () => {
    expect(landingPath({ ...guest, preferredMode: "admin" }, 0)).toBe("/c");
  });
});
