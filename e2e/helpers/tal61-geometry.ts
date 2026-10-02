import { expect, type Locator, type Page } from "@playwright/test";

/**
 * TAL-61 — medidas de los controles que el estilo base NO debe tocar
 * (puertas, casillas, cierres ✕, miniatura de la vista previa, muestras de
 * skin, segmentados). Se usan dos veces: para tomar las medidas de
 * referencia ANTES del cambio (sobre TAL-64, 1339e52) y para compararlas
 * después en `tal61-estilo-base.spec.ts`.
 */
export type Box = { w: number; h: number; padding: string; radius: string };
export type Geometry = Record<string, Box | number>;

async function box(locator: Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  const b = (await locator.boundingBox())!;
  const style = await locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { padding: s.padding, radius: s.borderRadius };
  });
  return { w: Math.round(b.width), h: Math.round(b.height), ...style };
}

async function gridColumns(locator: Locator): Promise<number> {
  return await locator.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
}

/**
 * Puertas del invitado y cierre del modal del vídeo, en `/c/<id>`.
 * `stableDoor`: una puerta abierta sin vídeo (su estado no cambia entre
 * pasadas). `videoDoor`: una con vídeo, que se abre para medir el cierre
 * (pasa a "ya visto", por eso no se usa para medir la puerta).
 */
export async function measureGuestCalendar(page: Page, calendarId: string, stableDoor: RegExp, videoDoor: RegExp): Promise<Geometry> {
  await page.goto(`/c/${calendarId}`);
  const door = page.getByRole("button", { name: stableDoor });
  const doorBox = await box(door);
  const columns = await gridColumns(door.locator(".."));
  await page.getByRole("button", { name: videoDoor }).click();
  const close = page.getByRole("dialog").getByRole("button", { name: "Cerrar" });
  const closeBox = await box(close);
  await close.click();
  return { door: doorBox, doorColumns: columns, doorModalClose: closeBox };
}

/** Casillas del editor, diálogo de día (cierre + segmentados), vista previa, selector de icono y muestras. */
export async function measureEditor(page: Page, calendarId: string): Promise<Geometry> {
  await page.goto(`/admin/${calendarId}`);
  const cell = page.locator('button[aria-label$=" — sin vídeo"], button[aria-label$=" — vídeo asignado"]').first();
  const cellBox = await box(cell);
  const cellColumns = await gridColumns(cell.locator(".."));

  await cell.click();
  const dayDialog = page.getByRole("dialog", { name: /^Editar día/ });
  const dayClose = await box(dayDialog.getByRole("button", { name: "Cerrar" }));
  const segLink = await box(dayDialog.getByRole("button", { name: "Link externo" }));
  const segUpload = await box(dayDialog.getByRole("button", { name: "Subir archivo" }));
  await dayDialog.getByRole("button", { name: "Cerrar" }).click();

  const previewTrigger = page.getByRole("button", { name: "Ver vista previa a tamaño completo" });
  const preview = await box(previewTrigger);
  await previewTrigger.click();
  const previewDialog = page.getByRole("dialog", { name: "Vista previa del calendario" });
  const previewClose = await box(previewDialog.getByRole("button", { name: "Cerrar" }));
  await previewDialog.getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("button", { name: "Icono" }).click();
  const iconDialog = page.getByRole("dialog", { name: "Elegir icono de portada" });
  const iconClose = await box(iconDialog.getByRole("button", { name: "Cerrar" }));
  await iconDialog.getByRole("button", { name: "Cerrar" }).click();

  const swatch = await box(page.locator(".skin-swatch").first());

  return {
    cell: cellBox,
    cellColumns,
    dayDialogClose: dayClose,
    segmentedLink: segLink,
    segmentedUpload: segUpload,
    previewThumbnail: preview,
    previewDialogClose: previewClose,
    iconPickerClose: iconClose,
    skinSwatch: swatch,
  };
}
